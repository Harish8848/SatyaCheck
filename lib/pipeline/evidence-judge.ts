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
        relevanceKind: z.enum(['direct', 'indirect']),
        reasoning: z.string().min(1).max(400),
        quote: z.string().max(400).optional(),
      }),
    )
    .max(20),
})
export type Judgement = z.infer<typeof judgementSchema>['judgements'][number]

export const JUDGE_SYSTEM = [
  'You judge whether each numbered source supports or contradicts a claim.',
  "Use ONLY the source's own title, snippet, or retrieved article content. Never use outside knowledge to decide the relation.",
  "'supports': the source asserts the same factual proposition as the claim. 'contradicts': the source asserts the opposite proposition or reports something incompatible with it.",
  "'context': on topic but does not settle the proposition (background, related events, same names without the same assertion, or uncertain/speculative reporting).",
  "'irrelevant': off topic.",
  'Do not classify evidence as context solely because an exact quote is unavailable. If the title, snippet, or article text directly supports or contradicts the proposition, classify it accordingly; quote verification is a separate property.',
  'A headline that only mentions the same topic is context. A headline that explicitly asserts the proposition is direct evidence for what the publisher reports.',
  'Do not treat rumor, possibility, questions, or phrases such as may, might, could, alleged, or unconfirmed as an established assertion of the underlying claim. A story that only says reports or rumors are circulating is context.',
  "Set relevanceKind to direct when the source explicitly addresses the same proposition or its negation; otherwise use indirect. For supports and contradicts, quote should be an exact span when available, but omit it rather than changing the classification if no exact span can be extracted.",
  'Return one judgement per source index.',
].join(' ')

export type Candidate = { source: ResearchSource; cls: SourceClass; relevance: number }

const speculativeLanguage = /\b(?:may|might|could|possibly|potentially|alleged(?:ly)?|unconfirmed|rumou?rs?|speculation|whether)\b|\?\s*$/i

export function toItem(claim: ExtractedClaim, candidate: Candidate, judgement: Judgement | undefined, judgedAny: boolean, ordinal: number): EvidenceItem {
  let relation: EvidenceRelation = judgement?.relation === 'supports' || judgement?.relation === 'contradicts' ? judgement.relation : 'context'
  let reasoning = judgement?.reasoning ?? (judgedAny ? 'Not addressed by the judgement step; treated as context.' : 'Relevance judgement unavailable; listed as context only.')
  if (relation === 'supports' && speculativeLanguage.test(`${candidate.source.title} ${candidate.source.snippet}`)) {
    relation = 'context'
    reasoning = `${reasoning} (The source uses speculative or uncertain language and does not assert the claim as established.)`
  }
  let quote: string | undefined
  const sourceText = `${candidate.source.title} ${candidate.source.snippet}`
  if (verifyQuote(judgement?.quote, sourceText)) {
    quote = judgement!.quote!.trim()
  } else if (
    relation !== 'context' && candidate.source.title.trim().length >= 8 &&
    candidate.source.title.trim().toLowerCase() === candidate.source.snippet.trim().toLowerCase()
  ) {
    // Keep the relation and attach the exact available headline; it remains
    // snippet-based and is not represented as a verified article quote.
    quote = candidate.source.title.trim()
  }
  const quoteVerified = candidate.source.evidenceBasis === 'article_content' && Boolean(quote && verifyQuote(quote, candidate.source.snippet))
  return {
    id: `${claim.id}-ev-${ordinal}`,
    claimId: claim.id,
    title: candidate.source.title,
    url: candidate.source.url,
    domain: candidate.cls.domain,
    publisher: candidate.cls.publisher,
    tier: candidate.cls.tier,
    relation,
    relevanceKind: judgement?.relevanceKind ?? 'indirect',
    evidenceBasis: candidate.source.evidenceBasis,
    quoteVerified,
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
