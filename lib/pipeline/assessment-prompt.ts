import { z } from 'zod'
import { aiContentTypeLabel, verdicts, type AiContentSignal, type EvidenceItem, type ExtractedClaim } from '../core/types'
import type { Stats } from './assessment-stats'

export const assessmentSchema = z.object({
  verdict: z.enum(verdicts),
  confidence: z.number().int().min(0).max(100),
  headline: z.string().min(1).max(200),
  reasoning: z.string().min(1).max(2000),
  caveats: z.array(z.string().min(1).max(300)).max(6).default([]),
})

export const ASSESSMENT_SYSTEM = [
  'You are SatyaCheck, a careful evidence-based fact-checking analyst.',
  'Decide the verdict ONLY from the supplied claims and evidence; never add outside facts or sources.',
  'Verdicts: verified (evidence supports the central claims), likely_false (evidence contradicts them), misleading (partly accurate but missing or distorting context), unverified (evidence insufficient), opinion, satire.',
  'Absence of evidence is never proof of falsehood: choose unverified.',
  'Media authenticity signals are heuristics about a file, not about whether events happened; mention them only as context.',
  'Write a one-sentence headline a reader can act on, and reasoning that cites which sources drove the verdict.',
  'Do not say there is no evidence when directional supporting or contradicting evidence is listed. Distinguish direct headline/snippet evidence from retrieved article content, and state when an exact article quote was not independently verified.',
  'Do not call an event official or definitively confirmed unless primary or official-source evidence is supplied. When evidence is search-snippet-only, attribute the finding to the named reporting and make clear that the underlying article text was not retrieved.',
  'List genuine limitations as caveats.',
].join(' ')

export type AssessInput = {
  claims: ExtractedClaim[]
  evidence: EvidenceItem[]
  uncheckedClaims: number
  aiSignal?: AiContentSignal
  notes: string[]
}

/** Stable, attributed wording when every directional item is snippet-only. */
export function snippetOnlyNarrative(evidence: EvidenceItem[]) {
  const directional = evidence.filter((item) => item.relation !== 'context')
  if (!directional.length || directional.some((item) => item.evidenceBasis !== 'search_snippet')) return undefined
  const supports = directional.filter((item) => item.relation === 'supports')
  const contradicts = directional.filter((item) => item.relation === 'contradicts')
  const publisherNames = (items: EvidenceItem[]) => [...new Set(items.map((item) => item.publisher))]
  const supportNames = publisherNames(supports)
  const contradictNames = publisherNames(contradicts)
  if (supports.length && !contradicts.length) {
    return {
      headline: 'Search result headlines support the claim; the linked article text was not retrieved.',
      reasoning: `${supportNames.length} publisher headline(s) directly report the claim (${supportNames.join(', ')}). The underlying article text was not retrieved, so these search results have not been independently checked against full articles.`,
    }
  }
  if (contradicts.length && !supports.length) {
    return {
      headline: 'Search result headlines contradict the claim; the linked article text was not retrieved.',
      reasoning: `${contradictNames.length} publisher headline(s) directly contradict the claim (${contradictNames.join(', ')}). The underlying article text was not retrieved, so these search results have not been independently checked against full articles.`,
    }
  }
  return {
    headline: 'Search result headlines disagree; the linked article text was not retrieved.',
    reasoning: `${supportNames.length} publisher headline(s) support the claim (${supportNames.join(', ')}); ${contradictNames.length} contradict it (${contradictNames.join(', ')}). The underlying article text was not retrieved, so these search results have not been independently checked against full articles.`,
  }
}

export function mediaCaveat(aiSignal: AiContentSignal | undefined): string[] {
  if (!aiSignal) return []
  if (aiSignal.type === 'likely_ai_generated' || aiSignal.type === 'possibly_ai_or_edited') {
    return [`Authenticity check: ${aiContentTypeLabel(aiSignal.type).toLowerCase()}. This concerns the file, not whether the claim is true.`]
  }
  if (aiSignal.type === 'indeterminate') return ['Authenticity checks were mostly inconclusive for this file.']
  return ['No AI-generation signal was found, which does not prove the media is authentic or unedited.']
}

export function buildPrompt(input: AssessInput, factual: ExtractedClaim[], stats: Stats): string {
  const evidenceBlock = factual
    .map((claim) => {
      const items = input.evidence.filter((item) => item.claimId === claim.id)
      const lines = items.length
        ? items.map((item) => `  - [${item.relation}; ${item.relevanceKind}; basis=${item.evidenceBasis}; quote verified=${item.quoteVerified}] ${item.publisher} (${item.tier}): ${item.title} — ${item.reasoning ?? ''}`).join('\n')
        : '  - (no relevant sources found)'
      return `Claim: ${claim.text}\nQuestion: ${claim.verificationQuestion}\nEvidence:\n${lines}`
    })
    .join('\n\n')
  const others = input.claims.filter((claim) => claim.claimType !== 'factual').map((claim) => `- (${claim.claimType}) ${claim.text}`).join('\n')
  return [
    evidenceBlock,
    others ? `Non-factual statements (not checked):\n${others}` : '',
    `Deterministic tally: supports=${stats.tally.supports}, contradicts=${stats.tally.contradicts}, context=${stats.tally.context}, independent publisher/domain identities=${stats.tally.distinctDomains}, evidence score=${stats.evidenceScore} (-100..100), evidence strength=${stats.evidenceStrength}/100.`,
    input.aiSignal ? `Media authenticity: ${aiContentTypeLabel(input.aiSignal.type)} (${input.aiSignal.summary})` : '',
  ].filter(Boolean).join('\n\n')
}
