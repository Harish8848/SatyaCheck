import { z } from 'zod'
import { config } from '../core/config'
import { log } from '../core/logger'
import { collapseWhitespace } from './ingest'

/**
 * URL extraction: fetch article pages with redirect/byte guards, then
 * readability-parse title, author, date and body text.
 */

export type ExtractedPage = {
  url: string
  finalUrl: string
  title?: string
  author?: string
  publishedAt?: string
  text: string
  extractedChars: number
  truncated: boolean
  notes: string[]
}

async function fetchWithGuards(url: string): Promise<{ bytes: Uint8Array; contentType: string; finalUrl: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.fetchTimeoutMs)
  try {
    let current = url
    for (let hop = 0; hop <= config.maxRedirects; hop += 1) {
      const response = await fetch(current, {
        signal: controller.signal,
        redirect: 'manual',
        headers: { 'user-agent': 'SatyaCheck/1.0 (+evidence-based verification)', accept: 'text/html,application/xhtml+xml' },
      })
      if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
        current = new URL(response.headers.get('location')!, current).toString()
        continue
      }
      if (!response.ok) throw new Error(`Page returned HTTP ${response.status}.`)
      const contentType = response.headers.get('content-type') ?? 'text/html'
      if (!/html|xml|text/i.test(contentType)) throw new Error(`Unsupported content type ${contentType}.`)
      const reader = response.body?.getReader()
      const chunks: Uint8Array[] = []
      let total = 0
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          if (value) {
            chunks.push(value)
            total += value.length
            if (total > config.maxRemoteBytes) break
          }
        }
      } else {
        const buffer = new Uint8Array(await response.arrayBuffer())
        chunks.push(buffer.subarray(0, config.maxRemoteBytes))
      }
      const merged = Buffer.concat(chunks.map((c) => Buffer.from(c)))
      return { bytes: new Uint8Array(merged.buffer, merged.byteOffset, merged.byteLength), contentType, finalUrl: current }
    }
    throw new Error('Too many redirects.')
  } finally {
    clearTimeout(timer)
  }
}

export async function extractPage(url: string): Promise<ExtractedPage> {
  const notes: string[] = []
  const { bytes, finalUrl } = await fetchWithGuards(url)
  const html = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, config.maxRemoteBytes))
  const { parseHTML } = await import('linkedom')
  const { document } = parseHTML(html)
  const { Readability } = await import('@mozilla/readability')
  const article = new Readability(document as unknown as Document, { charThreshold: 120 }).parse()
  const title = (article?.title || document.querySelector('meta[property="og:title"]')?.getAttribute('content') || document.title || '').trim() || undefined
  const author = (article?.byline || document.querySelector('meta[name="author"]')?.getAttribute('content') || '').trim() || undefined
  const publishedAt = document.querySelector('meta[property="article:published_time"]')?.getAttribute('content') || undefined
  const rawText = collapseWhitespace(article?.textContent ?? document.body?.textContent ?? '')
  const truncated = rawText.length >= 20_000
  const text = rawText.slice(0, 20_000)
  if (!text) log('warn', 'page extraction yielded no text', { url })
  if (finalUrl !== url) notes.push(`Followed redirects to ${finalUrl}.`)
  if (truncated) notes.push('Article body truncated to 20,000 characters for analysis.')
  return { url, finalUrl, title, author, publishedAt, text, extractedChars: rawText.length, truncated, notes }
}
