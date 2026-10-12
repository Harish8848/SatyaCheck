import { config } from '../core/config'
import { log } from '../core/logger'
import { fetchPublicPage } from '../core/public-fetch'
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
  linkedSources: string[]
  notes: string[]
}

export async function extractPage(url: string): Promise<ExtractedPage> {
  const notes: string[] = []
  const { bytes, finalUrl } = await fetchPublicPage(url)
  const html = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, config.maxRemoteBytes))
  const { parseHTML } = await import('linkedom')
  const { document } = parseHTML(html)
  const { Readability } = await import('@mozilla/readability')
  document.querySelectorAll('script,style,noscript,iframe,form').forEach(node => node.remove())
  const linkedSources = [...document.querySelectorAll('article a[href], main a[href]')].flatMap(node => {
    try { const link = new URL(node.getAttribute('href')!, finalUrl); return ['http:', 'https:'].includes(link.protocol) ? [link.toString()] : [] } catch { return [] }
  }).filter((v, i, all) => all.indexOf(v) === i).slice(0, 20)
  const article = new Readability(document.cloneNode(true) as unknown as Document, { charThreshold: 120 }).parse()
  const title = (article?.title || document.querySelector('meta[property="og:title"]')?.getAttribute('content') || document.title || '').trim() || undefined
  const author = (article?.byline || document.querySelector('meta[name="author"]')?.getAttribute('content') || '').trim() || undefined
  const publishedAt = document.querySelector('meta[property="article:published_time"]')?.getAttribute('content') || undefined
  if (/^(just a moment|access denied|sign in|log in|captcha|verify you are human)/i.test(title ?? '')) throw new Error('Page access is restricted. Paste the text or upload a copy.')
  const rawText = collapseWhitespace(article?.textContent ?? document.body?.textContent ?? '')
  if (/sign in to (?:view|read)|log in to (?:view|read)|subscription required|enable javascript and cookies|complete the captcha/i.test(rawText.slice(0, 600))) throw new Error('Page access is restricted. Paste the text or upload a copy.')
  const truncated = rawText.length >= 20_000
  const text = rawText.slice(0, 20_000)
  if (!text) log('warn', 'page extraction yielded no text')
  if (finalUrl !== url) notes.push(`Followed redirects to ${finalUrl}.`)
  if (truncated) notes.push('Article body truncated to 20,000 characters for analysis.')
  return { linkedSources, url, finalUrl, title, author, publishedAt, text, extractedChars: rawText.length, truncated, notes }
}
