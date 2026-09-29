import { config } from './config'

/**
 * Fixed-window per-key limiter held in process memory. It bounds abuse of one
 * server instance; on multi-instance or serverless deployments use a shared
 * store (e.g. Redis) instead, since each instance keeps its own counters.
 */
const hits = new Map<string, { count: number; resetAt: number }>()

export function rateLimit(key: string, now = Date.now()): { ok: boolean; retryAfterSeconds: number } {
  if (hits.size > 5000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k)
  const entry = hits.get(key)
  if (!entry || entry.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + config.rateLimitWindowMs })
    return { ok: true, retryAfterSeconds: 0 }
  }
  entry.count += 1
  return entry.count > config.rateLimitRequests ? { ok: false, retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000) } : { ok: true, retryAfterSeconds: 0 }
}

export function clientKey(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown'
}
