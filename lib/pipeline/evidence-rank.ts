import { config } from '../core/config'
import type { ExtractedClaim } from '../core/types'
import type { ResearchSource } from './research-parse'

/** Pure ranking / verification helpers for the evidence stage (no I/O). */

const STOPWORDS = new Set(
  'the and for are but not you all any can had her was one our out has have from that this with they will been were which their there what when who how why about into than then them these those said says also over after before could would should very more most some such only other its his she him hers your yours ours just like new'.split(' '),
)

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word))
}

/** 0-100 lexical overlap between the claim (plus entities) and a source's title/snippet. */
export function relevanceScore(claim: Pick<ExtractedClaim, 'text' | 'entities'>, source: Pick<ResearchSource, 'title' | 'snippet'>): number {
  const wanted = new Set([...tokenize(claim.text), ...claim.entities.flatMap(tokenize)])
  if (!wanted.size) return 0
  const have = new Set(tokenize(`${source.title} ${source.snippet}`))
  let matched = 0
  for (const token of wanted) if (have.has(token)) matched += 1
  return Math.min(100, Math.round((matched / wanted.size) * 150))
}

function normalizeQuery(text: string): string {
  return text.replace(/["“”]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240)
}

export function planQueries(claim: Pick<ExtractedClaim, 'text' | 'entities' | 'verificationQuestion'>): string[] {
  const queries = [
    normalizeQuery(claim.text),
    claim.entities.length >= 2 ? normalizeQuery(claim.entities.slice(0, 5).join(' ')) : normalizeQuery(claim.verificationQuestion),
  ].filter(Boolean)
  const seen = new Set<string>()
  return queries
    .filter((query) => {
      const key = query.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, config.queriesPerClaim)
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

/** A quote is valid only if it is a verbatim span of the source text. */
export function verifyQuote(quote: string | undefined, sourceText: string): boolean {
  if (!quote) return false
  const needle = collapse(quote)
  return needle.length >= 8 && collapse(sourceText).includes(needle)
}

/** 100 for brand-new items, decaying linearly to 0 at one year; undefined when the date is unknown. */
export function recencyScore(publishedAt: string | undefined, now = Date.now()): number | undefined {
  if (!publishedAt) return undefined
  const time = new Date(publishedAt).getTime()
  if (Number.isNaN(time)) return undefined
  const ageDays = Math.max(0, (now - time) / 86_400_000)
  return Math.max(0, Math.round(100 - ageDays / 3.65))
}
