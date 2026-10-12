import { generateStructured } from '../core/model'
import { describeError, log } from '../core/logger'
import type { EvidenceItem, ExtractedClaim } from '../core/types'
import { planQueries, relevanceScore } from './evidence-rank'
import { JUDGE_SYSTEM, judgementSchema, toItem, validateJudgementIndices, type Candidate, type Judgement } from './evidence-judge'
import { dedupeKey, providerCount, searchAll } from './research'
import { toIso } from './research-parse'
import { extractPage } from './url-extract'
import { classifySource } from './sources'

/**
 * Per-claim web evidence: plan queries, search, rank, then have the model judge
 * each source using only that source's text. Classification, relevance and
 * quote verification are recorded independently (see evidence-judge).
 */

const CANDIDATES_PER_CLAIM = 8
const MIN_RELEVANCE = 15

export type ClaimEvidence = { items: EvidenceItem[]; notes: string[]; queries: string[]; model?: string }

const short = (text: string) => text.slice(0, 80)

async function rankCandidates(claim: ExtractedClaim, queries: string[], linkedSources: string[]): Promise<{ top: Candidate[]; allFailed: boolean; lookupNotes: string[] }> {
  const results = await Promise.all(queries.map((query) => searchAll(query)))
  const allFailed = results.length > 0 && results.every((result) => result.failures.length >= providerCount)
  const lookupNotes: string[] = ['Search coverage includes news, published fact-checks, and reference sources; social-media accounts are not searched or authenticated.']
  if (!process.env.GOOGLE_FACT_CHECK_API_KEY) lookupNotes.push('Published fact-check lookup is not configured; other research sources were searched.')
  else if (results.some(r => r.failures.some(f => f.startsWith('Google Fact Check:')))) lookupNotes.push('Published fact-check lookup was unavailable; this does not mean no reviews exist.')
  else if (!results.some(r => r.sources.some(s => s.provider === 'Google Fact Check'))) lookupNotes.push('No matching fact-check found for this search. This does not establish whether the claim is true or false.')
  for (const result of results) lookupNotes.push(...result.failures.map(f => `Search unavailable: ${f}`))
  const seen = new Set<string>()
  const candidates: Candidate[] = []
  for (const result of results) {
    for (const source of result.sources) {
      const key = dedupeKey(source.url)
      if (seen.has(key)) continue
      seen.add(key)
      const relevance = relevanceScore(claim, source)
      if (relevance < MIN_RELEVANCE) continue
      candidates.push({ source, cls: classifySource({ url: source.url, publisher: source.publisher }), relevance })
    }
  }
  // Inspect a bounded selection of references from the submitted article. Their
  // inclusion is not corroboration; they go through the same semantic judgment.
  await Promise.all(linkedSources.slice(0, 2).map(async url => {
    if (seen.has(dedupeKey(url))) return
    try {
      const page = await extractPage(url)
      const source = { title: page.title ?? 'Linked document', url: page.finalUrl, snippet: page.text.slice(0, 8000), evidenceBasis: 'article_content' as const, publishedAt: toIso(page.publishedAt), retrievedAt: new Date().toISOString(), provider: 'Linked source' }
      const relevance = relevanceScore(claim, source)
      if (relevance >= MIN_RELEVANCE) candidates.push({ source, cls: classifySource({ url: page.finalUrl }), relevance })
    } catch { lookupNotes.push('A linked source could not be inspected; it does not count as corroboration.') }
  }))
  const rank = (c: Candidate) => c.relevance * 0.6 + c.cls.authority * 0.4
  candidates.sort((a, b) => rank(b) - rank(a))
  return { top: candidates.slice(0, CANDIDATES_PER_CLAIM), allFailed, lookupNotes }
}

export async function gatherEvidence(claim: ExtractedClaim, linkedSources: string[] = [], progress?: (detail: string) => void): Promise<ClaimEvidence> {
  progress?.(`Searching sources for ${claim.id}.`)
  const queries = planQueries(claim)
  const notes: string[] = []
  const { top, allFailed, lookupNotes } = await rankCandidates(claim, queries, linkedSources)
  notes.push(...lookupNotes)

  if (!top.length) {
    notes.push(
      allFailed
        ? `Research providers were unreachable while checking “${short(claim.text)}”, so the lack of evidence says nothing about the claim.`
        : `No sufficiently relevant sources were found for “${short(claim.text)}”.`,
    )
    return { items: [], notes, queries }
  }

  // Read a bounded set of direct pages. Keep snippets when a site blocks access.
  const readable = top.filter(c => c.source.evidenceBasis === 'search_snippet' && !c.source.url.includes('news.google.com/')).slice(0, 3)
  await Promise.all(readable.map(async candidate => {
    try {
      const page = await extractPage(candidate.source.url)
      if (page.text.length < 200) return
      candidate.source = { ...candidate.source, retrievedAt: new Date().toISOString(), publishedAt: toIso(page.publishedAt) || candidate.source.publishedAt, url: page.finalUrl, snippet: page.text.slice(0, 8000), evidenceBasis: 'article_content' }
      candidate.cls = classifySource({ url: page.finalUrl })
    } catch {
      notes.push(`Could not read the full page from ${candidate.cls.domain}; only its search snippet was assessed.`)
    }
  }))

  progress?.(`Comparing retrieved evidence for ${claim.id}.`)
  let judged = new Map<number, Judgement>()
  let model: string | undefined
  try {
    const sourceBlock = top
      .map((c, i) => `[${i + 1}] Publisher: ${c.cls.publisher} (${c.cls.tier})\nEvidence basis: ${c.source.evidenceBasis}\nTitle: ${c.source.title}\nSnippet: ${c.source.snippet}${c.source.publishedAt ? `\nPublished: ${c.source.publishedAt.slice(0, 10)}` : ''}`)
      .join('\n\n')
    const result = await generateStructured({
      label: 'evidence-judgement',
      schema: judgementSchema,
      system: JUDGE_SYSTEM,
      prompt: `Claim: ${claim.text}\nQuestion to answer: ${claim.verificationQuestion}\n\nSources:\n${sourceBlock}`,
    })
    model = result.model
    judged = validateJudgementIndices(result.output.judgements, top.length)
  } catch (error) {
    log('warn', 'evidence judgement unavailable', { claim: claim.id, error: describeError(error) })
    notes.push(`Source judgement was unavailable for “${short(claim.text)}”; sources are listed as context only.`)
  }

  const items: EvidenceItem[] = []
  top.forEach((candidate, i) => {
    const judgement = judged.get(i + 1)
    if (judgement?.relation === 'irrelevant') return
    items.push(toItem(claim, candidate, judgement, judged.size > 0, items.length + 1))
  })
  if (items.some((item) => item.relation !== 'context' && item.evidenceBasis === 'search_snippet')) {
    notes.push('Some directional evidence comes from search-result headlines or snippets; the linked article text was not retrieved, so those statements are not independently verified article quotes.')
  }
  return { items, notes, queries, model }
}
