import { config } from '../core/config'

/** Shared types and parsing helpers for the web research providers. */

export type ResearchSource = {
  title: string
  url: string
  snippet: string
  publisher?: string
  /** ISO-8601 when the provider exposes a date. */
  publishedAt?: string
  provider: string
}

export const USER_AGENT = 'SatyaCheck/1.0 research bot'

export function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
}

export function decodeXmlEntities(value: string): string {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (/^#x/i.test(entity)) {
      const code = Number.parseInt(entity.slice(2), 16)
      return Number.isNaN(code) ? match : String.fromCodePoint(code)
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10)
      return Number.isNaN(code) ? match : String.fromCodePoint(code)
    }
    return named[entity.toLowerCase()] ?? match
  })
}

export function firstTag(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))
  if (!match) return undefined
  return decodeXmlEntities(match[1].replace(/^<!\[CDATA\[|\]\]>$/g, '').trim())
}

export function splitPublisher(headline: string): { headline: string; publisher?: string } {
  const separator = headline.lastIndexOf(' - ')
  if (separator <= 0) return { headline }
  const publisher = headline.slice(separator + 3).trim()
  return { headline: headline.slice(0, separator).trim(), publisher: publisher || undefined }
}

export function toIso(value: string | undefined): string | undefined {
  if (!value) return undefined
  const gdelt = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/)
  const date = new Date(gdelt ? `${gdelt[1]}-${gdelt[2]}-${gdelt[3]}T${gdelt[4]}:${gdelt[5]}:${gdelt[6]}Z` : value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

/** Stable key for de-duplicating the same page across providers. */
export function dedupeKey(url: string): string {
  try {
    const parsed = new URL(url)
    const host = parsed.host.replace(/^www\./i, '').toLowerCase()
    // Google News links are opaque ids in the path; keep the query to stay distinct.
    return `${host}${parsed.pathname.replace(/\/$/, '').toLowerCase()}${host === 'news.google.com' ? parsed.search : ''}`
  } catch {
    return url.trim().toLowerCase()
  }
}

export function titleKey(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/** One short-backoff retry recovers most cold-start timeouts without delaying requests noticeably. */
export async function fetchResearch(url: string, init: RequestInit): Promise<Response> {
  let lastError: unknown
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(config.providerTimeoutMs) })
      if (response.status !== 429 && response.status < 500) return response
      lastError = new Error(`${url.split('?')[0]} returned ${response.status}`)
    } catch (error) {
      lastError = error
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 400 * attempt))
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}
