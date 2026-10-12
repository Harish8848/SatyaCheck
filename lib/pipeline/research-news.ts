import { fetchResearch, firstTag, splitPublisher, toIso, USER_AGENT, type ResearchSource } from './research-parse'

/** News search providers. Return raw candidates only; no relation judgement happens here. */

export { searchGdelt } from './gdelt'

export async function searchGoogleNews(query: string): Promise<ResearchSource[]> {
  const params = new URLSearchParams({ q: query, hl: 'en-US', gl: 'US', ceid: 'US:en' })
  const response = await fetchResearch(`https://news.google.com/rss/search?${params.toString()}`, {
    headers: { Accept: 'application/rss+xml, application/xml', 'User-Agent': USER_AGENT },
  })
  if (!response.ok) throw new Error(`Google News RSS returned ${response.status}`)
  const xml = await response.text()
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? []
  return items
    .flatMap((item): ResearchSource[] => {
      const url = firstTag(item, 'link')
      const rawTitle = firstTag(item, 'title')
      if (!url || !rawTitle || !url.startsWith('http')) return []
      const { headline, publisher } = splitPublisher(rawTitle)
      return [{ title: headline, url, snippet: headline, evidenceBasis: 'search_snippet', publisher, publishedAt: toIso(firstTag(item, 'pubDate')), provider: 'Google News' }]
    })
    .slice(0, 6)
}
