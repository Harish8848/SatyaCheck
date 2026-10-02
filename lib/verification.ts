import { desc, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
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
        requestId: id, claimId: item.claimId ?? '', title: item.title, url: item.url, domain: item.domain, publisher: item.publisher,
        tier: item.tier, relation: item.relation, relevanceKind: item.relevanceKind, evidenceBasis: item.evidenceBasis,
        quoteVerified: item.quoteVerified, publishedAt: item.publishedAt ? new Date(item.publishedAt) : null, snippet: item.snippet,
        quote: item.quote ?? null, relevance: item.relevance, authority: item.authority, recency: item.recency ?? null,
        provider: item.provider, reasoning: item.reasoning ?? null,
      })))
    }
    await tx.update(verificationRequests).set({
      status: 'completed',
      verdict: verdictLabel(assessment.verdict),
      finalVerdict: assessment.verdict,
      confidence: assessment.confidence,
      summary: `${assessment.headline} ${assessment.reasoning}`.trim(),
      aiSignal: report.aiSignal ?? null,
      inputMeta: report.ingested,
      claims: report.claims,
      stages: report.stages,
      assessment,
      completedAt: new Date(),
    }).where(eq(verificationRequests.id, id))
  })
}

async function markFailed(id: string, summary: string) {
  await db.update(verificationRequests).set({ status: 'failed', verdict: 'Unable to verify', confidence: null, summary, completedAt: new Date() }).where(eq(verificationRequests.id, id))
}

export async function getVerification(id: string) {
  const [row] = await db.select().from(verificationRequests).where(eq(verificationRequests.id, id)).limit(1)
  if (!row) return undefined
  return toVerification(row, (await loadSources([id])).get(id) ?? [])
}

export async function listVerifications(limit = 50) {
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
export async function createVerification(input: { inputType: InputType; inputText?: string; sourceName?: string; media?: MediaUpload }) {
  const [request] = await db.insert(verificationRequests).values({
    inputType: input.inputType, inputText: input.inputText, sourceName: input.sourceName,
    status: 'processing', verdict: 'Researching evidence', summary: 'Extracting claims and researching external sources.',
  }).returning()
  const submission: Submission = { inputType: input.inputType, inputText: input.inputText, sourceName: input.sourceName, media: input.media }
  try {
    await persistReport(request.id, await runPipeline(submission))
  } catch (error) {
    log('error', 'verification failed', { id: request.id, error: describeError(error) })
    if (error instanceof UserFacingError) {
      await markFailed(request.id, error.message)
      throw error
    }
    await markFailed(request.id, error instanceof ModelUnavailableError
      ? 'The analysis models were unavailable. The request was saved but could not be analysed; please try again in a few minutes.'
      : 'The request was saved, but analysis failed. Please try again.')
  }
  return (await getVerification(request.id))!
}
