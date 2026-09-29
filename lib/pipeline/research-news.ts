import { fetchResearch, firstTag, splitPublisher, toIso, USER_AGENT, type ResearchSource } from './research-parse'

/** News search providers. Return raw candidates only; no relation judgement happens here. */

export async function searchGdelt(query: string): Promise<ResearchSource[]> {
  const response = await fetchResearch(
    `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&maxrecords=8&format=json`,
    { headers: { Accept: 'application/json' } },
  )
  if (!response.ok) throw new Error(`GDELT returned ${response.status}`)
  // GDELT answers rejected queries with a plain-text 200; that is "no results", not an outage.
  if (!response.headers.get('content-type')?.includes('application/json')) return []
  const data = (await response.json()) as { articles?: Array<{ title?: string; url?: string; seendate?: string; domain?: string }> }
  return (data.articles ?? [])
    .filter((article) => article.title && article.url)
    .map((article) => ({
      title: article.title!,
      url: article.url!,
      snippet: article.title!,
      publisher: article.domain,
      publishedAt: toIso(article.seendate),
      provider: 'GDELT',
    }))
}

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
      return [{ title: headline, url, snippet: headline, publisher, publishedAt: toIso(firstTag(item, 'pubDate')), provider: 'Google News' }]
    })
    .slice(0, 6)
}
