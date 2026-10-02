import { z } from 'zod'
import { config } from '../core/config'

/**
 * Ingest: normalize every input modality into plain checkable text.
 *
 * Text passes through; URLs and media are fetched, size-capped, container-
 * parsed and (for images) vision-transcribed — all with clear truncation
 * notes so downstream stages can discount thin input.
 */

export const ingestSchema = z.object({
  inputType: z.enum(['text', 'image', 'video', 'audio', 'url']),
  inputText: z.string().max(200_000).optional(),
  sourceName: z.string().max(500).optional(),
  sourceUrl: z.string().max(2000).optional(),
  mediaBase64: z.string().max(40_000_000).optional(),
  mediaMime: z.string().max(120).optional(),
})
export type IngestRequest = z.infer<typeof ingestSchema>

export type IngestedInput = {
  inputType: 'text' | 'image' | 'video' | 'audio' | 'url'
  text: string
  sourceLabel: string
  url?: string
  mediaName?: string
  mediaBytes?: number
  mediaKind?: 'image' | 'video' | 'audio' | 'document' | 'unknown'
  truncated: boolean
  notes: string[]
}

const URL_RE = /^https?:\/\/[^\s/$.?#].[^\s]*$/i
const BLOCKED_HOSTS = ['localhost', '127.0.0.1', '0.0.0.0', '[::1]']

function blockedUrl(raw: string): string | undefined {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return 'URL could not be parsed.'
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'Only http(s) URLs can be fetched.'
  if (BLOCKED_HOSTS.some((h) => parsed.hostname === h || parsed.hostname.endsWith(`.${h}`))) {
    return 'Loopback / internal hosts cannot be fetched.'
  }
  return undefined
}

function decodeMedia(request: IngestRequest): { bytes: Uint8Array; mime: string } | { error: string } {
  if (!request.mediaBase64) return { error: 'No media payload was attached.' }
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(Buffer.from(request.mediaBase64, 'base64'))
  } catch {
    return { error: 'Media payload was not valid base64.' }
  }
  const ceiling = request.inputType === 'video' || request.inputType === 'audio' ? config.maxVideoBytes : config.maxImageBytes
  if (bytes.length > ceiling) {
    return { error: `Media is ${(bytes.length / 1_048_576).toFixed(1)} MB; the ${request.inputType} limit is ${(ceiling / 1_048_576).toFixed(0)} MB.` }
  }
  return { bytes, mime: request.mediaMime || 'application/octet-stream' }
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function validateIngest(raw: unknown): { ok: true; value: IngestRequest } | { ok: false; error: string } {
  const parsed = ingestSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid submission.' }
  const value = parsed.data
  if (value.inputType === 'text' && !value.inputText?.trim()) return { ok: false, error: 'Provide the text you want checked.' }
  if (value.inputType === 'url') {
    const candidate = value.sourceUrl || value.inputText || ''
    if (!candidate.trim()) return { ok: false, error: 'Provide the article URL you want checked.' }
    if (!URL_RE.test(candidate.trim())) return { ok: false, error: 'That does not look like an http(s) URL.' }
    const blocked = blockedUrl(candidate.trim())
    if (blocked) return { ok: false, error: blocked }
  }
  if ((value.inputType === 'image' || value.inputType === 'video' || value.inputType === 'audio') && !value.mediaBase64 && !value.inputText?.trim()) {
    return { ok: false, error: `Attach the ${value.inputType} file or describe what it shows.` }
  }
  return { ok: true, value }
}

export { blockedUrl, collapseWhitespace, decodeMedia }
export type { URL_RE as UrlPattern }
export const urlPattern = URL_RE
