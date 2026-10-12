import { desc, eq, inArray } from 'drizzle-orm'
import { db, assertDatabaseConfigured } from '@/lib/db'
import { verificationRequests, verificationSources } from '@/lib/db/schema'
import { UserFacingError } from '@/lib/core/errors'
import { describeError, log } from '@/lib/core/logger'
import { ModelUnavailableError } from '@/lib/core/model'
import { verdictLabel } from '@/lib/core/types'
import { runPipeline, type PipelineReport } from '@/lib/pipeline/orchestrator'
import type { Submission } from '@/lib/pipeline/ingest-run'
import { toVerification, type InputType, type MediaUpload, type SourceRow } from '@/lib/verification-model'

export { inputTypes, statuses } from '@/lib/verification-model'
export type { InputType, MediaUpload, VerificationRequest, VerificationStatus } from '@/lib/verification-model'

// Web pages and model output can contain NULs or lone UTF-16 surrogates.
// PostgreSQL rejects those values with SQLSTATE 22021, so clean text at the
// persistence boundary instead of allowing one source to fail the whole job.
function cleanText(value: string): string {
  const withoutNul = value.replace(/\u0000/g, '')
  return new TextDecoder().decode(new TextEncoder().encode(withoutNul))
}

function cleanJson<T>(value: T): T {
  if (typeof value === 'string') return cleanText(value) as T
  if (Array.isArray(value)) return value.map(item => cleanJson(item)) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [cleanText(key), cleanJson(item)])) as T
  }
  return value
}

async function loadSources(ids: string[]): Promise<Map<string, SourceRow[]>> {
  const grouped = new Map<string, SourceRow[]>()
  if (!ids.length) return grouped
  const rows = await db.select().from(verificationSources).where(inArray(verificationSources.requestId, ids)).orderBy(desc(verificationSources.relevance))
  for (const row of rows) grouped.set(row.requestId, [...(grouped.get(row.requestId) ?? []), row])
  return grouped
}

async function persistReport(id: string, report: PipelineReport) {
  const { assessment } = report
  await db.transaction(async (tx) => {
    await tx.delete(verificationSources).where(eq(verificationSources.requestId, id))
    if (report.evidence.length) {
      await tx.insert(verificationSources).values(report.evidence.map((item) => ({
        requestId: id, claimId: cleanText(item.claimId ?? ''), title: cleanText(item.title), url: cleanText(item.url), domain: cleanText(item.domain), publisher: cleanText(item.publisher),
        tier: cleanText(item.tier), relation: cleanText(item.relation), relevanceKind: item.relevanceKind, evidenceBasis: item.evidenceBasis,
        quoteVerified: item.quoteVerified, publishedAt: item.publishedAt ? new Date(item.publishedAt) : null, snippet: cleanText(item.snippet),
        quote: item.quote ? cleanText(item.quote) : null, relevance: item.relevance, authority: item.authority, recency: item.recency ?? null,
        provider: cleanText(item.provider), reasoning: item.reasoning ? cleanText(item.reasoning) : null,
      })))
    }
    await tx.update(verificationRequests).set({
      status: 'completed',
      verdict: assessment.evidenceReport?.claims.length === 1 ? assessment.evidenceReport.claims[0].verdict : assessment.evidenceReport ? 'Claim-by-claim assessment' : verdictLabel(assessment.verdict),
      finalVerdict: assessment.verdict,
      confidence: assessment.evidenceReport ? null : assessment.confidence,
      summary: assessment.evidenceReport?.summary ?? `${assessment.headline} ${assessment.reasoning}`.trim(),
      aiSignal: report.aiSignal ?? null,
      inputMeta: cleanJson(report.ingested),
      claims: cleanJson(report.claims),
      stages: cleanJson(report.stages),
      assessment: cleanJson(assessment),
      completedAt: new Date(),
    }).where(eq(verificationRequests.id, id))
  })
}

async function markFailed(id: string, summary: string) {
  await db.update(verificationRequests).set({ status: 'failed', verdict: 'Unable to verify', confidence: null, summary, completedAt: new Date() }).where(eq(verificationRequests.id, id))
}

export async function getVerification(id: string) {
  assertDatabaseConfigured()
  const [row] = await db.select().from(verificationRequests).where(eq(verificationRequests.id, id)).limit(1)
  if (!row) return undefined
  return toVerification(row, (await loadSources([id])).get(id) ?? [])
}

export async function listVerifications(limit = 50) {
  assertDatabaseConfigured()
  const rows = await db.select().from(verificationRequests).orderBy(desc(verificationRequests.createdAt)).limit(limit)
  const sources = await loadSources(rows.map((row) => row.id))
  return rows.map((row) => toVerification(row, sources.get(row.id) ?? []))
}

/**
 * Creates the request row, runs the full pipeline, and stores the report.
 * Bad input (e.g. an unreachable URL) marks the row failed and rethrows a
 * UserFacingError so the API can answer 422; any other failure is stored as a
 * failed report rather than an HTTP 500.
 */
export async function createVerification(input: { inputType: InputType; inputText?: string; sourceName?: string; media?: MediaUpload; reviewedClaims?: Submission['reviewedClaims'] }, progress?: import('@/lib/pipeline/orchestrator').Progress, prepared?: import('@/lib/pipeline/review').PreparedInput) {
  assertDatabaseConfigured()
  const [request] = await db.insert(verificationRequests).values({
    inputType: input.inputType, inputText: input.inputText, sourceName: input.sourceName,
    status: 'processing', verdict: 'Researching evidence', summary: 'Extracting claims and researching external sources.',
  }).returning()
  const submission: Submission = { inputType: input.inputType, inputText: input.inputText, sourceName: input.sourceName, media: input.media, reviewedClaims: input.reviewedClaims }
  try {
    await persistReport(request.id, await runPipeline(submission, progress, prepared))
  } catch (error) {
    log('error', 'verification failed', { id: request.id, error: describeError(error) })
    if (error instanceof UserFacingError) {
      await markFailed(request.id, error.message)
      throw error
    }
    await markFailed(request.id, error instanceof ModelUnavailableError
      ? (error.quotaLimited ? 'The AI provider’s free-tier quota or rate limit was reached. No verdict was produced. Please try again after your quota resets.' : 'The analysis model is unavailable. Check the server API key and model settings, then try again.')
      : 'The request was saved, but analysis failed. Please try again.')
  }
  return (await getVerification(request.id))!
}
