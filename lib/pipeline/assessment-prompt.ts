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
  'List genuine limitations as caveats.',
].join(' ')

export type AssessInput = {
  claims: ExtractedClaim[]
  evidence: EvidenceItem[]
  uncheckedClaims: number
  aiSignal?: AiContentSignal
  notes: string[]
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
        ? items.map((item) => `  - [${item.relation}] ${item.publisher} (${item.tier}): ${item.title} — ${item.reasoning ?? ''}`).join('\n')
        : '  - (no relevant sources found)'
      return `Claim: ${claim.text}\nQuestion: ${claim.verificationQuestion}\nEvidence:\n${lines}`
    })
    .join('\n\n')
  const others = input.claims.filter((claim) => claim.claimType !== 'factual').map((claim) => `- (${claim.claimType}) ${claim.text}`).join('\n')
  return [
    evidenceBlock,
    others ? `Non-factual statements (not checked):\n${others}` : '',
    `Deterministic tally: supports=${stats.tally.supports}, contradicts=${stats.tally.contradicts}, context=${stats.tally.context}, distinct domains=${stats.tally.distinctDomains}, evidence score=${stats.evidenceScore} (-100..100), evidence strength=${stats.evidenceStrength}/100.`,
    input.aiSignal ? `Media authenticity: ${aiContentTypeLabel(input.aiSignal.type)} (${input.aiSignal.summary})` : '',
  ].filter(Boolean).join('\n\n')
}
