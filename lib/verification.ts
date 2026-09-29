import { desc, eq } from 'drizzle-orm'
import { generateText, Output } from 'ai'
import { google } from '@ai-sdk/google'
import { z } from 'zod'
import { db } from '@/lib/db'
import { verificationEvidence, verificationRequests } from '@/lib/db/schema'

export const inputTypes = ['text', 'image', 'video', 'url'] as const
export const statuses = ['queued', 'processing', 'completed', 'failed'] as const
export const relations = ['Supports', 'Contradicts', 'Neutral'] as const

export type InputType = (typeof inputTypes)[number]
export type VerificationStatus = (typeof statuses)[number]
export type EvidenceRelation = (typeof relations)[number]

export type Evidence = {
  id: string
  sourceType: string
  title: string
  relation: EvidenceRelation
  explanation: string
  sourceUrl?: string
}

export type VerificationRequest = {
  id: string
  inputType: InputType
  inputText?: string
  sourceName?: string
  status: VerificationStatus
  verdict?: string
  confidence?: number
  summary?: string
  evidence: Evidence[]
  createdAt: string
  completedAt?: string
}

const factCheckSchema = z.object({
  verdict: z.string().min(1),
  confidence: z.number().int().min(0).max(100),
  summary: z.string().min(1),
  evidence: z.array(z.object({
    sourceType: z.string().min(1),
    title: z.string().min(1),
    relation: z.enum(relations),
    explanation: z.string().min(1),
    sourceUrl: z.string().url().optional(),
  })).max(8),
})

type ResearchSource = { title: string; url: string; snippet: string; sourceType: string }

const researchUserAgent = 'SatyaCheck/1.0 research bot'
const providerTimeoutMs = 8000
const pageFetchTimeoutMs = 12000
const maxSources = 10
const maxSnippetLength = 1200

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause as { code?: string } | undefined
    const label = error.name && error.name !== 'Error' ? `${error.name}: ` : ''
    return `${label}${error.message}${cause?.code ? ` (${cause.code})` : ''}`
  }
  return String(error)
}

function normalizeQuery(claim: string): string {
  return claim.replace(/["“”]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240)
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
}

function decodeXmlEntities(value: string): string {
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

function firstTag(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))
  return match ? decodeXmlEntities(match[1].trim()) : undefined
}

function splitPublisher(headline: string): { headline: string; publisher?: string } {
  const separator = headline.lastIndexOf(' - ')
  if (separator <= 0) return { headline }
  const publisher = headline.slice(separator + 3).trim()
  return { headline: headline.slice(0, separator).trim(), publisher: publisher || undefined }
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.host.replace(/^www\./i, '').toLowerCase()}${parsed.pathname.replace(/\/$/, '').toLowerCase()}`
  } catch {
    return url.trim().toLowerCase()
  }
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

type ResearchProvider = { name: string; search: (query: string) => Promise<ResearchSource[]> }

async function searchGdeltNews(query: string): Promise<ResearchSource[]> {
  const response = await fetch(`https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&maxrecords=8&format=json`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(providerTimeoutMs) })
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
    throw new Error(`GDELT returned ${response.status}`)
  }
  const data = await response.json() as { articles?: Array<{ title?: string; url?: string; seendate?: string; domain?: string }> }
  return (data.articles ?? []).filter((article) => article.title && article.url).map((article) => ({
    title: article.title!,
    url: article.url!,
    snippet: `${article.title} (${article.domain ?? 'news source'}, ${article.seendate ?? 'recent'})`,
    sourceType: 'News coverage',
  }))
}

async function wikipediaExtract(pageId: number, title: string): Promise<string | undefined> {
  try {
    const response = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/\s+/g, '_'))}`, { headers: { Accept: 'application/json', 'User-Agent': researchUserAgent }, signal: AbortSignal.timeout(providerTimeoutMs) })
    if (!response.ok) return undefined
    const data = await response.json() as { extract?: string }
    return data.extract?.trim() || undefined
  } catch {
    console.warn(` Wikipedia extract unavailable for page ${pageId}`)
    return undefined
  }
}

async function searchWikipedia(query: string): Promise<ResearchSource[]> {
  const params = new URLSearchParams({ action: 'query', list: 'search', srsearch: query, srlimit: '4', format: 'json', origin: '*' })
  const response = await fetch(`https://en.wikipedia.org/w/api.php?${params.toString()}`, { headers: { Accept: 'application/json', 'User-Agent': researchUserAgent }, signal: AbortSignal.timeout(providerTimeoutMs) })
  if (!response.ok) throw new Error(`Wikipedia search returned ${response.status}`)
  const data = await response.json() as { query?: { search?: Array<{ title?: string; pageid?: number; snippet?: string }> } }
  const results = (data.query?.search ?? []).filter((item) => item.title && item.pageid)
  const sources = await Promise.all(results.map(async (item) => ({
    title: item.title!,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title!.replace(/\s+/g, '_'))}`,
    snippet: (await wikipediaExtract(item.pageid!, item.title!)) ?? stripHtml(item.snippet ?? ''),
    sourceType: 'Reference source',
  })))
  return sources
}

async function searchGoogleNews(query: string): Promise<ResearchSource[]> {
  const params = new URLSearchParams({ q: query, hl: 'en-US', gl: 'US', ceid: 'US:en' })
  const response = await fetch(`https://news.google.com/rss/search?${params.toString()}`, { headers: { Accept: 'application/rss+xml, application/xml', 'User-Agent': researchUserAgent }, signal: AbortSignal.timeout(providerTimeoutMs) })
  if (!response.ok) throw new Error(`Google News RSS returned ${response.status}`)
  const xml = await response.text()
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? []
  return items.flatMap((item) => {
    const url = firstTag(item, 'link')
    const rawTitle = firstTag(item, 'title')
    if (!url || !rawTitle || !url.startsWith('http')) return []
    const pubDate = firstTag(item, 'pubDate')
    const { headline, publisher } = splitPublisher(rawTitle)
    const published = pubDate ? new Date(pubDate) : undefined
    const dateLabel = published && !Number.isNaN(published.getTime()) ? published.toISOString().slice(0, 10) : 'recent'
    return [{
      title: publisher ? `${headline} — ${publisher}` : headline,
      url,
      snippet: `${headline} (${publisher ?? 'news source'}, ${dateLabel}, via Google News)`,
      sourceType: 'News coverage',
    }]
  }).slice(0, 6)
}

async function searchCrossref(query: string): Promise<ResearchSource[]> {
  const params = new URLSearchParams({ query, rows: '3', select: 'title,DOI,URL,container-title,issued' })
  const response = await fetch(`https://api.crossref.org/works?${params.toString()}`, { headers: { Accept: 'application/json', 'User-Agent': researchUserAgent }, signal: AbortSignal.timeout(providerTimeoutMs) })
  if (!response.ok) throw new Error(`Crossref returned ${response.status}`)
  const data = await response.json() as { message?: { items?: Array<{ title?: string[]; DOI?: string; URL?: string; 'container-title'?: string[]; issued?: { 'date-parts'?: number[][] } }> } }
  return (data.message?.items ?? []).flatMap((item) => {
    const title = stripHtml(item.title?.[0] ?? '')
    const url = item.URL?.trim() || (item.DOI ? `https://doi.org/${item.DOI}` : undefined)
    if (!title || !url) return []
    const journal = stripHtml(item['container-title']?.[0] ?? '')
    const year = item.issued?.['date-parts']?.[0]?.[0]
    const detail = [journal, year].filter(Boolean).join(', ')
    return [{ title, url, snippet: `${title}${detail ? ` (${detail})` : ''}`, sourceType: 'Academic publication' }]
  })
}

const researchProviders: ResearchProvider[] = [
  { name: 'GDELT news search', search: searchGdeltNews },
  { name: 'Google News RSS search', search: searchGoogleNews },
  { name: 'Wikipedia search', search: searchWikipedia },
  { name: 'Crossref works search', search: searchCrossref },
]

async function researchClaim(claim: string, inputType: InputType): Promise<ResearchSource[]> {
  if (inputType === 'url') {
    try {
      const response = await fetch(claim, { headers: { 'User-Agent': researchUserAgent }, signal: AbortSignal.timeout(pageFetchTimeoutMs) })
      const text = (await response.text()).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/gi, ' ').replace(/\s+/g, ' ').trim()
      return [{ title: claim, url: claim, snippet: text.slice(0, 12000), sourceType: 'Submitted page' }]
    } catch {
      return []
    }
  }

  const query = normalizeQuery(claim)
  if (!query) return []

  const settled = await Promise.allSettled(researchProviders.map((provider) => provider.search(query)))
  const grouped: ResearchSource[][] = settled.map((result, index) => {
    if (result.status === 'fulfilled') return result.value
    console.warn(` External source search unavailable (${researchProviders[index].name}): ${describeError(result.reason)}`)
    return []
  })

  const sources: ResearchSource[] = []
  const seenUrls = new Set<string>()
  const seenTitles = new Set<string>()
  const rounds = Math.max(0, ...grouped.map((group) => group.length))

  for (let round = 0; round < rounds && sources.length < maxSources; round++) {
    for (const group of grouped) {
      if (sources.length >= maxSources) break
      const source = group[round]
      if (!source) continue
      const urlKey = normalizeUrl(source.url)
      const titleKey = normalizeTitle(source.title)
      if (!urlKey || seenUrls.has(urlKey) || seenTitles.has(titleKey)) continue
      seenUrls.add(urlKey)
      seenTitles.add(titleKey)
      sources.push({ ...source, snippet: source.snippet.slice(0, maxSnippetLength) })
    }
  }

  if (!sources.length) {
    console.warn(` No external sources matched "${query}" across ${researchProviders.length} providers.`)
  }
  return sources.slice(0, maxSources)
}

async function completeVerification(id: string, claim: string, inputType: InputType) {
  try {
    const sources = await researchClaim(claim, inputType)
    const sourceContext = sources.length
      ? sources.map((source, index) => `[${index + 1}] ${source.title}\nType: ${source.sourceType}\nURL: ${source.url}\nDetails: ${source.snippet}`).join('\n\n')
      : 'No external sources were returned. Mark the result as inconclusive and explain that evidence was unavailable.'

    const prompt = `Analyze this claim or submitted page:\n${claim}\n\nExternal research sources:\n${sourceContext}\n\nReturn a verdict such as True, Mostly true, Mixed, Mostly false, False, or Inconclusive. Prefer sources that address the claim directly. Reuse exact URLs from the list above and nothing else, with a short sourceType label copied from that source's Type field. Add one evidence item per source you actually used; label sources that are on topic but do not settle the claim as Neutral and explain their limits in the explanation. Only return an empty evidence list when no sources were supplied above. Never invent sources, titles, or URLs.`
    const system = 'You are SatyaCheck, a careful fact-checking analyst. Never present absence of evidence as proof. Compare the claim only with the supplied sources, identify uncertainty, and keep explanations precise. Do not invent source details or URLs.'
    let output: z.infer<typeof factCheckSchema> | undefined
    let lastError: unknown

    for (const modelId of ['gemini-3.8-flash', 'gemini-3.5-flash-lite']) {
      try {
        const result = await generateText({
          model: google(modelId),
          output: Output.object({ schema: factCheckSchema }),
          system,
          prompt,
          maxRetries: 0,
        })
        output = result.output
        break
      } catch (error) {
        lastError = error
        console.warn(` Gemini model ${modelId} failed; trying fallback:`, error)
      }
    }

    if (!output) throw lastError ?? new Error('No Gemini model returned a result')

    const hasEvidence = sources.length > 0 && output.evidence.length > 0
    const isInconclusive = /inconclusive|unable to verify|insufficient evidence/i.test(output.verdict)
    const safeConfidence = isInconclusive || !hasEvidence ? Math.min(output.confidence, 25) : output.confidence
    const safeVerdict = !sources.length && !isInconclusive ? 'Inconclusive' : output.verdict
    const safeSummary = !sources.length
      ? 'SatyaCheck could not retrieve any external sources for this claim, so it cannot determine whether the claim is true or false. This usually means the research providers were unreachable or returned no matches. Please retry in a moment.'
      : output.summary

    await db.transaction(async (tx) => {
      await tx.delete(verificationEvidence).where(eq(verificationEvidence.requestId, id))
      if (output.evidence.length) {
        await tx.insert(verificationEvidence).values(output.evidence.map((item) => ({ ...item, requestId: id })))
      }
      await tx.update(verificationRequests).set({ status: 'completed', verdict: safeVerdict, confidence: safeConfidence, summary: safeSummary, completedAt: new Date() }).where(eq(verificationRequests.id, id))
    })
  } catch (error) {
    console.error(' Fact-check analysis failed:', error)
    await db.update(verificationRequests).set({ status: 'failed', verdict: 'Unable to verify', summary: 'The request was saved, but external research or analysis failed. Please try again.', completedAt: new Date() }).where(eq(verificationRequests.id, id))
  }
}

function toEvidence(row: typeof verificationEvidence.$inferSelect): Evidence {
  return { id: row.id, sourceType: row.sourceType, title: row.title, relation: row.relation as EvidenceRelation, explanation: row.explanation, sourceUrl: row.sourceUrl ?? undefined }
}

async function toVerification(row: typeof verificationRequests.$inferSelect): Promise<VerificationRequest> {
  const evidence = await db.select().from(verificationEvidence).where(eq(verificationEvidence.requestId, row.id)).orderBy(desc(verificationEvidence.createdAt))
  return { id: row.id, inputType: row.inputType as InputType, inputText: row.inputText ?? undefined, sourceName: row.sourceName ?? undefined, status: row.status as VerificationStatus, verdict: row.verdict ?? undefined, confidence: row.confidence ?? undefined, summary: row.summary ?? undefined, evidence: evidence.map(toEvidence), createdAt: row.createdAt.toISOString(), completedAt: row.completedAt?.toISOString() }
}

export async function createVerification(input: { inputType: InputType; inputText?: string; sourceName?: string }) {
  const [request] = await db.insert(verificationRequests).values({ inputType: input.inputType, inputText: input.inputText, sourceName: input.sourceName, status: 'processing', verdict: 'Researching evidence', confidence: null, summary: 'Researching external sources and comparing evidence.', createdAt: new Date() }).returning()
  await completeVerification(request.id, input.inputText?.trim() || input.sourceName?.trim() || '', input.inputType)
  const [updated] = await db.select().from(verificationRequests).where(eq(verificationRequests.id, request.id)).limit(1)
  return toVerification(updated ?? request)
}

export async function listVerifications() {
  const rows = await db.select().from(verificationRequests).orderBy(desc(verificationRequests.createdAt))
  return Promise.all(rows.map(toVerification))
}

export async function getVerification(id: string) {
  const [row] = await db.select().from(verificationRequests).where(eq(verificationRequests.id, id)).limit(1)
  return row ? toVerification(row) : undefined
}

export async function getVerificationStatus(id: string) {
  return getVerification(id)
}

export async function runVerification(id: string) {
  const [request] = await db.select().from(verificationRequests).where(eq(verificationRequests.id, id)).limit(1)
  if (!request) return undefined
  await completeVerification(id, request.inputText?.trim() || request.sourceName?.trim() || '', request.inputType as InputType)
  return getVerification(id)
}
