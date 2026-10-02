import { config } from '../core/config'
import { describeError, log } from '../core/logger'
import { analyzeImage, analyzeVideo } from './media-integrity'
import type { AiContentSignal, Assessment, EvidenceItem, ExtractedClaim, IngestedInput, PipelineStage, StageResult } from '../core/types'
import { assess } from './assessment'
import { extractClaims } from './claims'
import { gatherEvidence } from './evidence'
import { ingestSubmission, type Submission } from './ingest-run'

/**
 * The verification pipeline, in the order of the product diagram:
 *
 *   ingest -> media_integrity -> ai_signal -> claim_extraction -> fact_checking -> final_assessment
 *
 * Only a failed *ingest* aborts the run (nothing to check). Every later stage
 * degrades: the report says what could not run instead of implying it was fine.
 */

export type PipelineReport = {
  ingested: IngestedInput
  aiSignal?: AiContentSignal
  claims: ExtractedClaim[]
  evidence: EvidenceItem[]
  assessment: Assessment
  stages: StageResult[]
}

class Tracker {
  readonly stages: StageResult[] = []
  async run<T>(stage: PipelineStage, work: () => Promise<{ value: T; detail?: string }>): Promise<T | undefined> {
    const started = Date.now()
    const entry: StageResult = { stage, state: 'running', startedAt: new Date(started).toISOString() }
    this.stages.push(entry)
    try {
      const { value, detail } = await work()
      Object.assign(entry, { state: 'completed', detail })
      return value
    } catch (error) {
      Object.assign(entry, { state: 'failed', error: describeError(error) })
      log('error', 'pipeline stage failed', { stage, error: describeError(error) })
      if (stage === 'ingest') throw error
      return undefined
    } finally {
      entry.finishedAt = new Date().toISOString()
      entry.durationMs = Date.now() - started
    }
  }
  skip(stage: PipelineStage, skippedReason: string) {
    this.stages.push({ stage, state: 'skipped', skippedReason })
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++
        results[index] = await fn(items[index])
      }
    }),
  )
  return results
}

export async function runPipeline(submission: Submission): Promise<PipelineReport> {
  const tracker = new Tracker()
  const notes: string[] = []

  const ingested = (await tracker.run('ingest', async () => {
    const value = await ingestSubmission(submission)
    return { value, detail: `${value.extractedChars.toLocaleString()} characters ready for analysis.` }
  }))!

  let aiSignal: AiContentSignal | undefined
  let mediaContext: string | undefined
  const isMedia = submission.inputType === 'image' || submission.inputType === 'video'
  if (submission.inputType === 'audio' && submission.media) {
    tracker.skip('media_integrity', 'Audio has no image authenticity analysis.')
    tracker.skip('ai_signal', 'Audio has no image authenticity analysis.')
  } else if (isMedia && submission.media) {
    const media = submission.media
    const integrity = await tracker.run('media_integrity', async () => {
      const result = submission.inputType === 'image' ? await analyzeImage(media.bytes) : await analyzeVideo(media.bytes)
      return { value: result, detail: `${result.aiSignal.signals.filter((s) => s.executed).length} of ${result.aiSignal.signals.length} checks ran.` }
    })
    aiSignal = integrity?.aiSignal
    mediaContext = integrity?.contextText
    if (!integrity) notes.push('Media authenticity analysis failed to run; no authenticity conclusion is offered.')
    if (aiSignal) {
      const signal = aiSignal
      await tracker.run('ai_signal', async () => ({ value: signal, detail: `${signal.type} (suspicion ${signal.score}/100, ${signal.coverage}% coverage).` }))
    }
  } else {
    tracker.skip('media_integrity', 'No image or video was submitted.')
    tracker.skip('ai_signal', 'No image or video was submitted.')
  }

  notes.push(...ingested.notes.filter((note) => !note.startsWith('Vision description')))
  const extraction = await tracker.run('claim_extraction', async () => {
    const value = await extractClaims(ingested.text, { sourceLabel: ingested.sourceLabel, aiSignalSummary: mediaContext })
    return { value, detail: `${value.claims.length} claim(s), ${value.factualCount} checkable.` }
  })
  const claims = extraction?.claims ?? []
  if (!extraction) notes.push('Claim extraction failed, so no claims could be checked.')

  const factual = claims.filter((claim) => claim.claimType === 'factual')
  const toCheck = factual.slice(0, config.maxClaims)
  const evidence: EvidenceItem[] = []
  if (toCheck.length) {
    await tracker.run('fact_checking', async () => {
      const results = await mapLimit(toCheck, 3, (claim) => gatherEvidence(claim))
      results.forEach((result) => {
        evidence.push(...result.items)
        notes.push(...result.notes)
      })
      return { value: evidence, detail: `${evidence.length} source(s) across ${toCheck.length} claim(s).` }
    })
  } else {
    tracker.skip('fact_checking', extraction ? 'No checkable factual claim was extracted.' : 'Claim extraction did not run.')
  }

  const assessment = await tracker.run('final_assessment', async () => {
    const value = await assess({ claims, evidence, uncheckedClaims: factual.length - toCheck.length, aiSignal, notes })
    return { value, detail: `${value.verdict} (confidence ${value.confidence}).` }
  })
  if (!assessment) throw new Error('Final assessment failed.')
  return { ingested, aiSignal, claims, evidence, assessment, stages: tracker.stages }
}
