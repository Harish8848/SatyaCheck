import { generateText, Output } from 'ai'
import { google } from '@ai-sdk/google'
import { z } from 'zod'
import { config } from './config'
import { describeError, log } from './logger'

export class ModelUnavailableError extends Error {
  readonly attempts: Attempt[]
  constructor(message: string, attempts: Attempt[] = []) {
    super(message)
    this.name = 'ModelUnavailableError'
    this.attempts = attempts
  }
}

const MAX_OVERLOAD_DELAY_MS = 20_000

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

/**
 * Capacity errors (503 / UNAVAILABLE / "high demand" / overload) are transient
 * for the *same* model, unlike quota errors: waiting briefly and retrying the
 * same model usually succeeds, so we must not fall through the fallback list.
 */
export function overloadRetryDelayMs(error: unknown): number | undefined {
  if (!(error instanceof Error)) return undefined
  const text = `${error.name} ${error.message} ${String((error as { statusCode?: unknown }).statusCode ?? '')}`
  if (!/503|unavailable|high demand|overload|model is currently|try again later/i.test(text)) return undefined
  if (quotaRetryDelayMs(error) !== undefined) return undefined
  return 2_000
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
  const baseRetries = options.maxRetriesPerModel ?? 2
  // A capacity blip can clear on a second try, but a model that is *sustained*ly
  // overloaded will not: retrying it repeatedly just burns the request budget
  // and delays the fallbacks that would actually work. Two extra tries (three
  // total) is the sweet spot, then we move on to the next model.
  const overloadRetries = Math.min(baseRetries + 1, 3)

  for (const modelId of models) {
    for (let attempt = 1; attempt <= overloadRetries; attempt += 1) {
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

        // Schema/shape failures will not fix themselves either: retrying the same
        // model with the same prompt reproduces the same bad output.
        if (!overloadRetryDelayMs(error) && attempt >= baseRetries) break

        const overloadDelay = overloadRetryDelayMs(error)
        const delay = overloadDelay ?? Math.min(250 * 2 ** (attempt - 1), 2_000)
        if (attempt < overloadRetries) {
          log('info', 'model call retry scheduled', { label: options.label, model: modelId, nextAttempt: attempt + 1, delayMs: Math.min(delay, MAX_OVERLOAD_DELAY_MS) })
          await sleep(Math.min(delay, MAX_OVERLOAD_DELAY_MS))
        }
      }
    }
  }

  throw new ModelUnavailableError(`No model produced a valid result for "${options.label}"`, attempts)
}
