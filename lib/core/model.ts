import { generateText, Output } from 'ai'
import { createGoogle } from '@ai-sdk/google'
import { createCerebras } from '@ai-sdk/cerebras'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
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

const MAX_OVERLOAD_DELAY_MS = 2_000

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

function statusOf(error: unknown) { return Number((error as { statusCode?: unknown })?.statusCode ?? (error as { status?: unknown })?.status ?? 0) }
function isQuotaOrUnavailable(error: unknown) {
  const text = `${(error as Error)?.name ?? ''} ${(error as Error)?.message ?? ''}`
  return /429|quota|rate.?limit|resource.?exhausted|model.*(not found|unavailable|retired)|not available to new users/i.test(`${text} ${statusOf(error)}`)
}
function isTransient(error: unknown) { return /500|502|503|timeout|timed out|overload|high demand|temporar/i.test(`${(error as Error)?.message ?? ''} ${statusOf(error)}`) }

function providerFor(name: string): { name: string; model: string; call: (model: string) => any } | undefined {
  if ((name === 'gemini' || name.startsWith('gemini-')) && (process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY)) return { name: 'gemini', model: name === 'gemini' ? (process.env.GEMINI_MODEL || 'gemini-3.8-flash') : name, call: createGoogle({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY }) }
  const grokApiKey = process.env.GROK_API_KEY || process.env.XAI_API_KEY
  if ((name === 'xai' || name === 'grok' || name.startsWith('xai/') || name.startsWith('grok/')) && grokApiKey) return { name: 'grok', model: name === 'xai' || name === 'grok' ? (process.env.GROK_MODEL || process.env.XAI_MODEL || 'grok-4.7') : name.slice(name.startsWith('grok/') ? 5 : 4), call: createOpenAICompatible({ name: 'grok', baseURL: process.env.GROK_BASE_URL || process.env.XAI_BASE_URL || 'https://api.x.ai/v1', apiKey: grokApiKey, supportsStructuredOutputs: true }) }
  if ((name === 'cerebras' || name.startsWith('cerebras/')) && process.env.CEREBRAS_API_KEY) return { name: 'cerebras', model: name === 'cerebras' ? (process.env.CEREBRAS_MODEL || 'gpt-oss-120b') : name.slice(9), call: createCerebras({ apiKey: process.env.CEREBRAS_API_KEY }) }
  if (name === 'ollama' || name.startsWith('ollama/')) {
    const model = name === 'ollama' ? (process.env.OLLAMA_MODEL || 'llama3.2:3b') : name.slice('ollama/'.length)
    // Ollama's OpenAI-compatible endpoint works with the current AI SDK model
    // interface; the legacy ollama-ai-provider package only implements v1.
    const baseURL = (process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1').replace(/\/$/, '')
    return {
      name: 'ollama',
      model,
      call: createOpenAICompatible({
        name: 'ollama',
        baseURL,
        apiKey: 'ollama',
        supportsStructuredOutputs: false,
      }),
    }
  }
  return undefined
}

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
  const baseRetries = options.maxRetriesPerModel ?? 1
  // A capacity blip can clear on a second try, but a model that is *sustained*ly
  // overloaded will not: retrying it repeatedly just burns the request budget
  // and delays the fallbacks that would actually work. Two extra tries (three
  // total) is the sweet spot, then we move on to the next model.
  const overloadRetries = Math.min(baseRetries + 1, 2)

  for (const providerName of models) {
    const provider = providerFor(providerName)
    if (!provider) continue
    const modelId = `${provider.name}/${provider.model}`
    for (let attempt = 1; attempt <= overloadRetries; attempt += 1) {
      const started = Date.now()
      try {
        const result = await generateText({
          model: provider.call(provider.model),
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
          abortSignal: AbortSignal.timeout(config.modelTimeoutMs),
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
        if (isQuotaOrUnavailable(error)) break

        // Schema/shape failures will not fix themselves either: retrying the same
        // model with the same prompt reproduces the same bad output.
        if (!isTransient(error) && attempt >= baseRetries) break

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
