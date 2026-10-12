import { fetchResearch, toIso, type ResearchSource } from './research-parse'

type ClaimSearchResponse = { claims?: Array<{
  text?: string
  claimReview?: Array<{ publisher?: { name?: string }; url?: string; title?: string; reviewDate?: string; textualRating?: string }>
}> }

/** Preserve publisher ratings verbatim; a matching review is not a new verdict. */
export function parseFactChecks(data: ClaimSearchResponse): ResearchSource[] {
  return (data.claims ?? []).flatMap(claim => (claim.claimReview ?? []).flatMap(review => {
    if (!review.url || !claim.text) return []
    try { if (!['https:', 'http:'].includes(new URL(review.url).protocol)) return [] } catch { return [] }
    return [{
      title: review.title || claim.text,
      url: review.url,
      snippet: `Reviewed claim: ${claim.text}\nPublisher's original rating: ${review.textualRating || 'Not provided'}`,
      evidenceBasis: 'search_snippet' as const,
      publisher: review.publisher?.name || 'Unknown fact-check publisher',
      publishedAt: toIso(review.reviewDate),
      provider: 'Google Fact Check',
    }]
  }))
}

const cache = new Map<string, { expires: number; sources: ResearchSource[] }>()
const cleanupTimer = setInterval(() => { for (const [key, value] of cache) if (value.expires <= Date.now()) cache.delete(key) }, 60_000)
cleanupTimer.unref()
export async function searchFactChecks(query: string): Promise<ResearchSource[]> {
  const key = process.env.GOOGLE_FACT_CHECK_API_KEY
  if (!key) return []
  const cached = cache.get(query)
  if (cached && cached.expires > Date.now()) return cached.sources
  const params = new URLSearchParams({ query, pageSize: '5' })
  // A header keeps the credential out of URLs and network error messages.
  const response = await fetchResearch(`https://factchecktools.googleapis.com/v1alpha1/claims:search?${params}`, {
    headers: { 'X-Goog-Api-Key': key, Accept: 'application/json' },
  })
  const sources = parseFactChecks(await response.json()).map(s => ({ ...s, retrievedAt: new Date().toISOString() }))
  if (cache.size >= 100) cache.delete(cache.keys().next().value!)
  cache.set(query, { expires: Date.now() + 15 * 60_000, sources })
  return sources
}
