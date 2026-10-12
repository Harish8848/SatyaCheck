import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { UserFacingError } from '../core/errors'
import type { AiContentSignal, ExtractedClaim, IngestedInput } from '../core/types'
import { extractClaims } from './claims'
import { ingestSubmission, type Submission } from './ingest-run'
import { analyzeImage, analyzeVideo } from './media-integrity'
import type { Progress } from './orchestrator'

export type PreparedInput = { ingested: IngestedInput; claims: ExtractedClaim[]; aiSignal?: AiContentSignal }
const drafts = new Map<string, { prepared: PreparedInput; owner: string; expires: number }>()
const TTL = 10 * 60_000
function cleanup() { for (const [id, draft] of drafts) if (draft.expires <= Date.now()) drafts.delete(id) }
const timer = setInterval(cleanup, 60_000); timer.unref()
export const reviewedClaimsSchema = z.array(z.object({ text: z.string().trim().min(8).max(600), claimType: z.enum(['factual', 'opinion', 'satire', 'prediction', 'unverifiable']) })).max(12)

export function saveDraft(prepared: PreparedInput, owner: string): string {
  cleanup()
  if (drafts.size >= 50) throw new UserFacingError('The extraction queue is full. Please try again shortly.')
  const token = randomUUID()
  drafts.set(token, { prepared, owner, expires: Date.now() + TTL })
  return token
}
export function readDraft(token: string, owner: string, reviewed: unknown): PreparedInput {
  cleanup()
  const draft = drafts.get(token)
  if (!draft || draft.owner !== owner) throw new UserFacingError('Extraction review expired or is unavailable on this server. Extract the content again.')
  const parsed = reviewedClaimsSchema.safeParse(reviewed)
  if (!parsed.success) throw new UserFacingError('Review up to 12 claims, each 8–600 characters, and select a claim type.')
  return { ...draft.prepared, ingested: { ...draft.prepared.ingested, notes: [...draft.prepared.ingested.notes, 'The user reviewed the extracted claims. Edits are user-supplied assertions, not authenticated transcripts.'] }, claims: parsed.data.map((c, i) => ({ ...c, id: `claim-${i + 1}`, entities: [], verificationQuestion: c.text.slice(0, 300) })) }
}
export function deleteDraft(token: string) { drafts.delete(token) }
export async function prepareReview(submission: Submission, owner: string, progress?: Progress) {
  progress?.({ stage: 'ingest', state: 'running' })
  const ingested = await ingestSubmission(submission)
  if (ingested.text.length > 12_000) { ingested.truncated = true; ingested.notes.push('Claim extraction inspected only the first 12,000 characters.') }
  progress?.({ stage: 'ingest', state: 'completed', detail: 'Content extracted; extraction may be imperfect.' })
  let aiSignal: AiContentSignal | undefined
  if (submission.media && ['image', 'video'].includes(submission.inputType)) {
    progress?.({ stage: 'media_integrity', state: 'running' })
    try {
      const result = submission.inputType === 'image' ? await analyzeImage(submission.media.bytes) : await analyzeVideo(submission.media.bytes)
      aiSignal = result.aiSignal
      progress?.({ stage: 'media_integrity', state: 'completed' })
    } catch {
      ingested.notes.push('Media integrity checks failed; authenticity remains unknown.')
      progress?.({ stage: 'media_integrity', state: 'failed', error: 'Media integrity checks unavailable.' })
    }
  }
  progress?.({ stage: 'claim_extraction', state: 'running' })
  const { claims } = await extractClaims(ingested.text, { sourceLabel: ingested.sourceLabel })
  progress?.({ stage: 'claim_extraction', state: 'completed' })
  const token = saveDraft({ ingested, claims, aiSignal }, owner)
  return { token, claims, extractedText: ingested.text, notes: ingested.notes, expiresInSeconds: TTL / 1000 }
}
