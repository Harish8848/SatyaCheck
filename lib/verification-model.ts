import type { verificationRequests, verificationSources } from '@/lib/db/schema'
import type { AiContentSignal, Assessment, EvidenceItem, ExtractedClaim, IngestedInput, SourceTier, StageResult } from '@/lib/core/types'

export const inputTypes = ['text', 'image', 'video', 'url'] as const
export const statuses = ['queued', 'processing', 'completed', 'failed'] as const

export type InputType = (typeof inputTypes)[number]
export type VerificationStatus = (typeof statuses)[number]
export type MediaUpload = { bytes: Uint8Array; mime: string }

export type VerificationRequest = {
  id: string
  inputType: InputType
  inputText?: string
  sourceName?: string
  status: VerificationStatus
  /** Human-readable verdict label. */
  verdict?: string
  confidence?: number
  summary?: string
  aiSignal?: AiContentSignal
  assessment?: Assessment
  claims: ExtractedClaim[]
  sources: EvidenceItem[]
  stages: StageResult[]
  input?: IngestedInput
  createdAt: string
  completedAt?: string
}

export type RequestRow = typeof verificationRequests.$inferSelect
export type SourceRow = typeof verificationSources.$inferSelect

export function toSource(row: SourceRow): EvidenceItem {
  return {
    id: row.id, claimId: row.claimId, title: row.title, url: row.url, domain: row.domain, publisher: row.publisher,
    tier: row.tier as SourceTier, relation: row.relation as EvidenceItem['relation'], publishedAt: row.publishedAt?.toISOString(),
    snippet: row.snippet, quote: row.quote ?? undefined, relevance: row.relevance, authority: row.authority,
    recency: row.recency ?? undefined, provider: row.provider, reasoning: row.reasoning ?? undefined,
  }
}

export function toVerification(row: RequestRow, sources: SourceRow[]): VerificationRequest {
  return {
    id: row.id,
    inputType: row.inputType as InputType,
    inputText: row.inputText ?? undefined,
    sourceName: row.sourceName ?? undefined,
    status: row.status as VerificationStatus,
    verdict: row.verdict ?? undefined,
    confidence: row.confidence ?? undefined,
    summary: row.summary ?? undefined,
    aiSignal: row.aiSignal ?? undefined,
    assessment: row.assessment ?? undefined,
    claims: row.claims ?? [],
    sources: sources.map(toSource),
    stages: row.stages ?? [],
    input: row.inputMeta ?? undefined,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString(),
  }
}
