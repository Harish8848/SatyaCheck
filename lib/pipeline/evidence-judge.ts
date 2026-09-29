import { z } from 'zod'
import type { EvidenceItem, EvidenceRelation, ExtractedClaim } from '../core/types'
import { recencyScore, verifyQuote } from './evidence-rank'
import type { ResearchSource } from './research-parse'
import type { SourceClass } from './sources'

/** Judgement schema, prompt and item construction for the evidence stage. */

export const judgementSchema = z.object({
  judgements: z
    .array(
      z.object({
        index: z.number().int().min(1),
        relation: z.enum(['supports', 'contradicts', 'context', 'irrelevant']),
        reasoning: z.string().min(1).max(400),
        quote: z.string().max(400).optional(),
      }),
    )
    .max(20),
})
export type Judgement = z.infer<typeof judgementSchema>['judgements'][number]

export const JUDGE_SYSTEM = [
  'You judge whether each numbered source supports or contradicts a claim.',
  "Use ONLY the source's own title and snippet. Never use outside knowledge to decide the relation.",
  "'supports': the source text states or directly implies the claim is true.",
  "'contradicts': the source text states or directly implies the claim is false, or reports something incompatible with it.",
  "'context': on topic but does not settle the claim (background, related events, same names without the same assertion).",
  "'irrelevant': off topic.",
  'Be conservative: a headline that only mentions the same topic is context, not support.',
  "For supports and contradicts, 'quote' MUST be an exact contiguous substring copied from that source's text.",
  'Return one judgement per source index.',
].join(' ')

export type Candidate = { source: ResearchSource; cls: SourceClass; relevance: number }

export function toItem(claim: ExtractedClaim, candidate: Candidate, judgement: Judgement | undefined, judgedAny: boolean, ordinal: number): EvidenceItem {
  let relation: EvidenceRelation = judgement?.relation === 'supports' || judgement?.relation === 'contradicts' ? judgement.relation : 'context'
  let reasoning = judgement?.reasoning ?? (judgedAny ? 'Not addressed by the judgement step; treated as context.' : 'Relevance judgement unavailable; listed as context only.')
  let quote: string | undefined
  if (relation !== 'context') {
    if (verifyQuote(judgement?.quote, `${candidate.source.title} ${candidate.source.snippet}`)) {
      quote = judgement!.quote!.trim()
    } else {
      relation = 'context'
      reasoning = `${reasoning} (Downgraded to context: no verifiable supporting quote.)`
    }
  }
  return {
    id: `${claim.id}-ev-${ordinal}`,
    claimId: claim.id,
    title: candidate.source.title,
    url: candidate.source.url,
    domain: candidate.cls.domain,
    publisher: candidate.cls.publisher,
    tier: candidate.cls.tier,
    relation,
    publishedAt: candidate.source.publishedAt,
    snippet: candidate.source.snippet,
    quote,
    relevance: candidate.relevance,
    authority: candidate.cls.authority,
    recency: recencyScore(candidate.source.publishedAt),
    provider: candidate.source.provider,
    reasoning,
  }
}
