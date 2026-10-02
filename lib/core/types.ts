/**
 * Shared domain vocabulary for the SatyaCheck verification pipeline.
 *
 * Everything in this file is deliberately plain data (no I/O, no AI calls) so it
 * can be used from server code, API routes, client components and unit tests.
 */

export const verdicts = ['verified', 'likely_false', 'misleading', 'unverified', 'opinion', 'satire'] as const
export type Verdict = (typeof verdicts)[number]

export const pipelineStages = ['ingest', 'media_integrity', 'ai_signal', 'claim_extraction', 'fact_checking', 'final_assessment'] as const
export type PipelineStage = (typeof pipelineStages)[number]

export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed'

export type InputType = 'text' | 'image' | 'video' | 'audio' | 'url'

/**
 * A single forensic signal. `state` is intentionally four-valued: a check that
 * could not run must never be silently rendered as "no problem found".
 */
export const signalStates = ['pass', 'flag', 'inconclusive', 'not_applicable'] as const
export type SignalState = (typeof signalStates)[number]

export const signalCategories = ['provenance', 'metadata', 'watermark', 'forensics', 'model_judgement'] as const
export type SignalCategory = (typeof signalCategories)[number]

export type MediaSignal = {
  id: string
  category: SignalCategory
  label: string
  state: SignalState
  /** True when this check is implemented for the supplied container format. */
  applicable: boolean
  /** True when the check actually ran (a false value always pairs with a caveat). */
  executed: boolean
  /** Human-readable raw observation, e.g. `Software = Adobe Photoshop 25.3.1`. */
  observed: string
  /** Why this observation matters, written for a non-expert reader. */
  meaning: string
  /** 0-100; how much this signal moves the needle when it is conclusive. */
  strength: number
  /** Signed suspicion contribution applied by the fusion model. */
  contribution: number
  method: string
  caveat?: string
  /**
   * True only for checks that speak to synthesis/manipulation of pixels rather
   * than to provenance or re-encoding. The fusion step requires at least one
   * of these to corroborate a metadata hit before it will say "likely AI
   * generated": a Photoshop re-save is an edit trace, not evidence of synthesis.
   */
  corroboratesSynthesis?: boolean
}

export type AiContentType = 'likely_ai_generated' | 'possibly_ai_or_edited' | 'no_ai_signal_detected' | 'indeterminate'

export type AiContentSignal = {
  type: AiContentType
  /** 0-100 suspicion index produced by deterministic fusion, not a probability. */
  score: number
  /** 0-100; how much of the signal set was actually executable. */
  coverage: number
  signals: MediaSignal[]
  summary: string
  limitations: string[]
}

export const claimTypes = ['factual', 'opinion', 'satire', 'prediction', 'unverifiable'] as const
export type ClaimType = (typeof claimTypes)[number]

export type ExtractedClaim = {
  id: string
  text: string
  claimType: ClaimType
  /** Entities worth using as search anchors. */
  entities: string[]
  /** The question a fact-checker would actually try to answer. */
  verificationQuestion: string
  quote?: string
}

export const evidenceRelations = ['supports', 'contradicts', 'context'] as const
export type EvidenceRelation = (typeof evidenceRelations)[number]

export const sourceTiers = ['primary', 'reputable', 'reference', 'unverified'] as const
export type SourceTier = (typeof sourceTiers)[number]

export type EvidenceItem = {
  id: string
  /** The extracted claim this source was judged against. */
  claimId?: string
  title: string
  url: string
  domain: string
  publisher: string
  tier: SourceTier
  relation: EvidenceRelation
  publishedAt?: string
  snippet: string
  /** Verbatim span from the source that drives the relation, when one exists. */
  quote?: string
  relevance: number
  authority: number
  recency?: number
  provider: string
  reasoning?: string
}

export type StageState = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

export type StageResult = {
  stage: PipelineStage
  state: StageState
  startedAt?: string
  finishedAt?: string
  durationMs?: number
  detail?: string
  error?: string
  skippedReason?: string
}

export type Assessment = {
  verdict: Verdict
  confidence: number
  /** Short headline answer a reader can trust or refute. */
  headline: string
  reasoning: string
  caveats: string[]
  /** Deterministic evidence tally, shown next to the model's explanation. */
  tally: { supports: number; contradicts: number; context: number; distinctDomains: number; topTier: SourceTier }
  /** Deterministic net-evidence score before the model's reasoning. */
  evidenceScore: number
  /** Deterministic evidence strength 0-100, used to cap confidence. */
  evidenceStrength: number
  model: string
}

export type IngestedInput = {
  inputType: InputType
  text: string
  /** Original submitted text/URL before extraction. */
  sourceLabel: string
  url?: string
  pageTitle?: string
  pageAuthor?: string
  pagePublishedAt?: string
  extractedChars: number
  truncated: boolean
  mediaName?: string
  mediaBytes?: number
  mediaKind?: 'image' | 'video' | 'audio' | 'document' | 'unknown'
  notes: string[]
}

export const saturationLimit = 120_000

export function verdictLabel(verdict: Verdict): string {
  return {
    verified: 'Verified / Supported',
    likely_false: 'Likely false',
    misleading: 'Misleading',
    unverified: 'Unverified',
    opinion: 'Opinion',
    satire: 'Satire',
  }[verdict]
}

export function claimTypeLabel(claimType: ClaimType): string {
  return {
    factual: 'Checkable fact',
    opinion: 'Opinion',
    satire: 'Satire',
    prediction: 'Prediction',
    unverifiable: 'Unverifiable',
  }[claimType]
}

export function aiContentTypeLabel(type: AiContentType): string {
  return {
    likely_ai_generated: 'Likely AI generated',
    possibly_ai_or_edited: 'Possible AI generation or editing',
    no_ai_signal_detected: 'No AI signal detected',
    indeterminate: 'Indeterminate',
  }[type]
}

export function tierLabel(tier: SourceTier): string {
  return {
    primary: 'Primary / official',
    reputable: 'Reputable newsroom',
    reference: 'Reference',
    unverified: 'Unclassified',
  }[tier]
}
