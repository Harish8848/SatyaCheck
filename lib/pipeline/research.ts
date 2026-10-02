import { describeError, log } from '../core/logger'
import { dedupeKey, fetchResearch, stripHtml, titleKey, toIso, USER_AGENT, type ResearchSource } from './research-parse'
import { searchGdelt, searchGoogleNews } from './research-news'

export type { ResearchSource } from './research-parse'
export { dedupeKey } from './research-parse'

/** Reference providers plus the parallel aggregator used by the evidence stage. */

type ResearchProvider = { name: string; search: (query: string) => Promise<ResearchSource[]> }

const MAX_SNIPPET = 1200
const MAX_PER_QUERY = 12

async function wikipediaExtract(title: string): Promise<string | undefined> {
  try {
    const response = await fetchResearch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/\s+/g, '_'))}`,
      { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT } },
    )
    if (!response.ok) return undefined
    const data = (await response.json()) as { extract?: string }
    return data.extract?.trim() || undefined
  } catch {
    return undefined
  }
}

async function searchWikipedia(query: string): Promise<ResearchSource[]> {
  const params = new URLSearchParams({ action: 'query', list: 'search', srsearch: query, srlimit: '4', format: 'json', origin: '*' })
  const response = await fetchResearch(`https://en.wikipedia.org/w/api.php?${params.toString()}`, {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
  })
  if (!response.ok) throw new Error(`Wikipedia search returned ${response.status}`)
  const data = (await response.json()) as { query?: { search?: Array<{ title?: string; snippet?: string }> } }
  const results = (data.query?.search ?? []).filter((item) => item.title)
  return Promise.all(
    results.map(async (item) => {
      const extract = await wikipediaExtract(item.title!)
      return {
        title: item.title!,
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title!.replace(/\s+/g, '_'))}`,
        snippet: extract ?? stripHtml(item.snippet ?? ''),
        evidenceBasis: extract ? 'article_content' as const : 'search_snippet' as const,
        publisher: 'Wikipedia',
        provider: 'Wikipedia',
      }
    }),
  )
}

async function searchCrossref(query: string): Promise<ResearchSource[]> {
  const params = new URLSearchParams({ query, rows: '3', select: 'title,DOI,URL,container-title,issued' })
  const response = await fetchResearch(`https://api.crossref.org/works?${params.toString()}`, {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
  })
  if (!response.ok) throw new Error(`Crossref returned ${response.status}`)
  const data = (await response.json()) as {
    message?: { items?: Array<{ title?: string[]; DOI?: string; URL?: string; 'container-title'?: string[]; issued?: { 'date-parts'?: number[][] } }> }
  }
  return (data.message?.items ?? []).flatMap((item): ResearchSource[] => {
    const title = stripHtml(item.title?.[0] ?? '')
    const url = item.URL?.trim() || (item.DOI ? `https://doi.org/${item.DOI}` : undefined)
    if (!title || !url) return []
    const journal = stripHtml(item['container-title']?.[0] ?? '')
    const year = item.issued?.['date-parts']?.[0]?.[0]
    const detail = [journal, year].filter(Boolean).join(', ')
    return [{ title, url, snippet: `${title}${detail ? ` (${detail})` : ''}`, evidenceBasis: 'search_snippet', publisher: journal || 'Crossref', publishedAt: year ? toIso(String(year)) : undefined, provider: 'Crossref' }]
  })
}

const providers: ResearchProvider[] = [
  { name: 'GDELT', search: searchGdelt },
  { name: 'Google News', search: searchGoogleNews },
  { name: 'Wikipedia', search: searchWikipedia },
  { name: 'Crossref', search: searchCrossref },
]

export const providerCount = providers.length

/**
 * Query every provider in parallel. Provider *errors* are reported separately
 * from empty results so callers can tell "nothing found" from "could not look".
 */
export async function searchAll(query: string): Promise<{ sources: ResearchSource[]; failures: string[] }> {
  const settled = await Promise.allSettled(providers.map((provider) => provider.search(query)))
  const failures: string[] = []
  const grouped = settled.map((result, index) => {
    if (result.status === 'fulfilled') return result.value
    failures.push(`${providers[index].name}: ${describeError(result.reason)}`)
    log('warn', 'research provider failed', { provider: providers[index].name, error: describeError(result.reason) })
    return [] as ResearchSource[]
  })

  const sources: ResearchSource[] = []
  const seenUrls = new Set<string>()
  const seenTitles = new Set<string>()
  const rounds = Math.max(0, ...grouped.map((group) => group.length))
  // Round-robin so one chatty provider cannot crowd out the others.
  for (let round = 0; round < rounds && sources.length < MAX_PER_QUERY; round += 1) {
    for (const group of grouped) {
      const source = group[round]
      if (!source || sources.length >= MAX_PER_QUERY) continue
      const urlId = dedupeKey(source.url)
      const titleId = titleKey(source.title)
      if (!urlId || seenUrls.has(urlId) || seenTitles.has(titleId)) continue
      seenUrls.add(urlId)
      seenTitles.add(titleId)
      sources.push({ ...source, snippet: source.snippet.slice(0, MAX_SNIPPET) })
    }
  }
  return { sources, failures }
}
