import type { SourceTier } from '../core/types'

/**
 * Deterministic source classification. Authority is a *prior* about the kind
 * of publisher, never a claim that the publisher is right: the evidence judge
 * still has to find text that actually supports or contradicts the claim.
 */

export type SourceClass = { tier: SourceTier; authority: number; domain: string; publisher: string }

export const tierAuthority: Record<SourceTier, number> = { primary: 95, reputable: 85, reference: 60, unverified: 30 }
export const tierRank: Record<SourceTier, number> = { primary: 3, reputable: 2, reference: 1, unverified: 0 }

const PRIMARY_DOMAINS = [
  /(^|\.)gov(\.[a-z]{2,3})?$/,
  /(^|\.)gob\.[a-z]{2}$/,
  /(^|\.)go\.(jp|kr|id|th|ke|tz|ug)$/,
  /(^|\.)mil$/,
  /(^|\.)un\.org$/,
  /(^|\.)who\.int$/,
  /(^|\.)europa\.eu$/,
  /(^|\.)worldbank\.org$/,
  /(^|\.)imf\.org$/,
  /(^|\.)nic\.in$/,
]

const REPUTABLE_DOMAINS = [
  'reuters.com', 'apnews.com', 'bbc.com', 'bbc.co.uk', 'npr.org', 'pbs.org', 'nytimes.com', 'washingtonpost.com',
  'wsj.com', 'theguardian.com', 'ft.com', 'economist.com', 'bloomberg.com', 'aljazeera.com', 'dw.com', 'france24.com',
  'abc.net.au', 'cbc.ca', 'thehindu.com', 'kathmandupost.com', 'afp.com', 'factcheck.afp.com', 'factcheck.org',
  'snopes.com', 'politifact.com', 'fullfact.org', 'boomlive.in', 'altnews.in', 'nature.com', 'science.org',
  'thelancet.com', 'nejm.org',
]

const REPUTABLE_PUBLISHERS = [
  'reuters', 'associated press', 'ap news', 'bbc news', 'bbc', 'npr', 'pbs newshour', 'the new york times',
  'the washington post', 'the wall street journal', 'the guardian', 'financial times', 'the economist', 'bloomberg',
  'al jazeera', 'dw', 'france 24', 'afp fact check', 'factcheck.org', 'snopes', 'politifact', 'full fact',
  'the hindu', 'the kathmandu post', 'nature', 'science', 'the lancet',
]

const REFERENCE_DOMAINS = [
  /(^|\.)wikipedia\.org$/, /(^|\.)britannica\.com$/, /(^|\.)doi\.org$/, /(^|\.)crossref\.org$/, /(^|\.)arxiv\.org$/,
  /(^|\.)edu$/, /(^|\.)ac\.[a-z]{2}$/,
]

const AGGREGATOR_DOMAINS = ['news.google.com']

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase()
  } catch {
    return ''
  }
}

function publisherMatches(publisher: string): boolean {
  const name = publisher.toLowerCase().trim()
  return REPUTABLE_PUBLISHERS.some((known) => new RegExp(`(^|[^a-z])${escapeRegExp(known)}([^a-z]|$)`).test(name))
}

export function classifySource(input: { url: string; publisher?: string }): SourceClass {
  const domain = domainOf(input.url)
  const publisher = input.publisher?.trim() || domain || 'Unknown publisher'
  const aggregated = AGGREGATOR_DOMAINS.includes(domain)

  let tier: SourceTier = 'unverified'
  if (!aggregated && PRIMARY_DOMAINS.some((pattern) => pattern.test(domain))) tier = 'primary'
  else if (!aggregated && REPUTABLE_DOMAINS.some((known) => domain === known || domain.endsWith(`.${known}`))) tier = 'reputable'
  else if (input.publisher && publisherMatches(input.publisher)) tier = 'reputable'
  else if (!aggregated && REFERENCE_DOMAINS.some((pattern) => pattern.test(domain))) tier = 'reference'

  return { tier, authority: tierAuthority[tier], domain: domain || 'unknown', publisher }
}
