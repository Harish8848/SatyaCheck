import { generateStructured } from '../core/model'
import { describeError, log } from '../core/logger'
import type { EvidenceItem, ExtractedClaim } from '../core/types'
import { planQueries, relevanceScore } from './evidence-rank'
import { JUDGE_SYSTEM, judgementSchema, toItem, type Candidate, type Judgement } from './evidence-judge'
import { dedupeKey, providerCount, searchAll } from './research'
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

async function rankCandidates(claim: ExtractedClaim, queries: string[]): Promise<{ top: Candidate[]; allFailed: boolean }> {
  const results = await Promise.all(queries.map((query) => searchAll(query)))
  const allFailed = results.length > 0 && results.every((result) => result.failures.length >= providerCount)
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
  const rank = (c: Candidate) => c.relevance * 0.6 + c.cls.authority * 0.4
  candidates.sort((a, b) => rank(b) - rank(a))
  return { top: candidates.slice(0, CANDIDATES_PER_CLAIM), allFailed }
}

export async function gatherEvidence(claim: ExtractedClaim): Promise<ClaimEvidence> {
  const queries = planQueries(claim)
  const notes: string[] = []
  const { top, allFailed } = await rankCandidates(claim, queries)

  if (!top.length) {
    notes.push(
      allFailed
        ? `Research providers were unreachable while checking “${short(claim.text)}”, so the lack of evidence says nothing about the claim.`
        : `No sufficiently relevant sources were found for “${short(claim.text)}”.`,
    )
    return { items: [], notes, queries }
  }

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
    judged = new Map(result.output.judgements.map((j) => [j.index, j]))
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
