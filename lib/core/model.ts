import { generateText, Output } from 'ai'
import { google } from '@ai-sdk/google'
import { z } from 'zod'
import { config } from './config'
import { describeError, log } from './logger'

export class ModelUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ModelUnavailableError'
  }
}

/** Quota errors carry a suggested retry delay like "Please retry in 19.65s." */
export function quotaRetryDelayMs(error: unknown): number | undefined {
  if (!(error instanceof Error)) return undefined
  const text = `${error.name} ${error.message}`
  if (!/quota|rate.?limit|429|resource.?exhausted/i.test(text)) return undefined
  const match = text.match(/retry in ([\d.]+)s/i)
  if (!match) return 5_000
  const seconds = Number.parseFloat(match[1])
  if (!Number.isFinite(seconds)) return 5_000
  return Math.min(Math.max(seconds * 1000, 1_000), 30_000)
}

type Attempt = { modelId: string; tries: number; lastError?: unknown }

/**
 * Structured generation with ordered model fallback and bounded retries.
 *
 * Every fallback is recorded so the final report can state which model produced
 * the assessment — part of the transparency promise.
 */
export async function generateStructured<T>(options: {
  label: string
  schema: z.ZodType<T>
  system: string
  prompt: string
  models?: string[]
  files?: { data: Uint8Array | string; mediaType: string }[]
  maxRetriesPerModel?: number
}): Promise<{ output: T; model: string; attempts: Attempt[] }> {
  const models = options.models ?? config.analystModels
  const attempts: Attempt[] = []

  for (const modelId of models) {
    for (let attempt = 1; attempt <= (options.maxRetriesPerModel ?? 2); attempt += 1) {
      const started = Date.now()
      try {
        const result = await generateText({
          model: google(modelId),
          output: Output.object({ schema: options.schema, name: options.label }),
          system: options.system,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: options.prompt },
                ...(options.files ?? []).map((file) => ({ type: 'file' as const, data: file.data, mediaType: file.mediaType })),
              ],
            },
          ],
          maxRetries: 0,
          temperature: 0,
        })
        attempts.push({ modelId, tries: attempt })
        log('info', 'model call succeeded', { label: options.label, model: modelId, attempt, durationMs: Date.now() - started })
        return { output: result.output as T, model: modelId, attempts }
      } catch (error) {
        attempts.push({ modelId, tries: attempt, lastError: error })
        log('warn', 'model call failed', { label: options.label, model: modelId, attempt, durationMs: Date.now() - started, error: describeError(error) })
        // A quota-exhausted model will not recover on the next attempt, so move
        // on to the next fallback immediately instead of burning retries.
        if (quotaRetryDelayMs(error) !== undefined) break
      }
    }
  }

  throw new ModelUnavailableError(`No model produced a valid result for "${options.label}"`)
}
