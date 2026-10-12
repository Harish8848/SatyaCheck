import { z } from 'zod'
import { config } from '../core/config'
import { ResearchProviderError } from '../core/research-error'
import { toIso, type ResearchSource } from './research-parse'

const responseSchema = z.object({ articles: z.array(z.object({
  title: z.string(), url: z.string().url(), seendate: z.string().optional(), domain: z.string().optional(),
})) })
const GAP_MS = 5_500
const CACHE_MS = 5 * 60_000
const COOLDOWN_MS = 60_000

export function retryAfterMs(value: string | null, now: number): number {
  if (!value) return 0
  const milliseconds = /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) * 1000 : Date.parse(value) - now
  return Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 0
}

/** One provider-wide queue, shared by all queries in this server process.
 * Waiting calls recheck cooldown after the previous response; no hidden fast retries.
 */
export function createGdeltSearch(deps: {
  fetch?: typeof fetch; now?: () => number; wait?: (ms: number) => Promise<void>
} = {}) {
  const now = deps.now ?? Date.now
  const wait = deps.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const request = deps.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
  const cache = new Map<string, { expires: number; sources: ResearchSource[] }>()
  const inFlight = new Map<string, Promise<ResearchSource[]>>()
  let tail: Promise<unknown> = Promise.resolve()
  let nextAllowed = 0
  let cooldownUntil = 0
  const copy = (sources: ResearchSource[]) => sources.map(source => ({ ...source }))
  const checkCooldown = () => {
    if (now() < cooldownUntil) throw new ResearchProviderError(`Temporarily paused; retry in ${Math.ceil((cooldownUntil - now()) / 1000)} seconds. Other providers are still used.`)
  }

  return async function searchGdelt(query: string): Promise<ResearchSource[]> {
    const key = query.trim().replace(/\s+/g, ' ')
    for (const [q, value] of cache) if (value.expires <= now()) cache.delete(q)
    const cached = cache.get(key)
    if (cached) return copy(cached.sources)
    const pending = inFlight.get(key)
    if (pending) return copy(await pending)
    checkCooldown()
    // One active request and one queued request support the usual two variants.
    // Skip excess work explicitly instead of holding up all other provider results.
    if (inFlight.size >= 2) throw new ResearchProviderError('Request queue is busy; this GDELT lookup was skipped. Other providers are still used.')

    const task = tail.then(async () => {
      checkCooldown()
      if (nextAllowed > now()) await wait(nextAllowed - now())
      checkCooldown()
      try {
        const params = new URLSearchParams({ query: key, mode: 'artlist', maxrecords: '8', format: 'json' })
        const response = await request(`https://api.gdeltproject.org/api/v2/doc/doc?${params}`, {
          headers: { Accept: 'application/json' }, redirect: 'error',
          // GDELT can take longer than the other research providers to accept a
          // query. Give it a little more time, while still failing fast enough
          // for the remaining providers to return a useful result.
          signal: AbortSignal.timeout(Math.max(config.providerTimeoutMs, 12_000)),
        })
        if (response.status === 429) {
          cooldownUntil = now() + Math.max(COOLDOWN_MS, retryAfterMs(response.headers.get('retry-after'), now()))
          await response.body?.cancel()
          throw new ResearchProviderError('Rate limited (HTTP 429); GDELT searches are temporarily paused. Other providers are still used.', 429)
        }
        if (!response.ok) {
          await response.body?.cancel()
          throw new ResearchProviderError(`Service returned HTTP ${response.status}.`, response.status)
        }
        // The service also returns plain-text rejections with HTTP 200.
        // These are failed searches, never successful searches with no matches.
        if (!response.headers.get('content-type')?.includes('application/json')) {
          const body = await response.text()
          if (/limit requests|too many requests|rate limit/i.test(body)) {
            cooldownUntil = now() + COOLDOWN_MS
            throw new ResearchProviderError('Rate limited; GDELT searches are temporarily paused. Other providers are still used.', 429)
          }
          throw new ResearchProviderError('Query rejected or response was not JSON; this search could not be completed.')
        }
        const parsed = responseSchema.safeParse(await response.json())
        if (!parsed.success) throw new ResearchProviderError('Invalid search response; this search could not be completed.')
        const sources: ResearchSource[] = parsed.data.articles
          .filter(article => /^https?:\/\//i.test(article.url))
          .map(article => ({ title: article.title, url: article.url, snippet: article.title,
            evidenceBasis: 'search_snippet', publisher: article.domain,
            publishedAt: toIso(article.seendate), retrievedAt: new Date(now()).toISOString(), provider: 'GDELT' }))
        if (cache.size >= 100) cache.delete(cache.keys().next().value!)
        cache.set(key, { expires: now() + CACHE_MS, sources })
        return sources
      } catch (error) {
        // Pause briefly after timeouts/outages too, so queued calls do not repeat
        // a known failure. A provider's Retry-After always takes precedence.
        cooldownUntil = Math.max(cooldownUntil, now() + 15_000)
        if (!(error instanceof ResearchProviderError) && (error as { name?: string }).name === 'TimeoutError') {
          throw new ResearchProviderError('Could not connect to GDELT before the 12-second timeout. GDELT was skipped; other research providers are still used.')
        }
        throw error
      } finally {
        // Spacing from completion also avoids overlapping slow server requests.
        nextAllowed = now() + GAP_MS
      }
    })
    tail = task.catch(() => {})
    inFlight.set(key, task)
    try { return copy(await task) }
    finally { inFlight.delete(key) }
  }
}

export const searchGdelt = createGdeltSearch()
