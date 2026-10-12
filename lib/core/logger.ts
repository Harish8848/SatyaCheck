type Level = 'debug' | 'info' | 'warn' | 'error'

/**
 * Single-line structured logs. Job ids are included so a report can be traced
 * end to end across pipeline stages in the platform log stream.
 */
export function log(level: Level, message: string, fields: Record<string, unknown> = {}) {
  const detail = Object.keys(fields).length
    ? ` ${Object.entries(fields)
        .map(([key, value]) => `${key}=${value instanceof Error ? value.message : JSON.stringify(value)}`)
        .join(' ')}`
    : ''
  const line = `${new Date().toISOString()} ${level.toUpperCase()} [satyacheck] ${message}${detail}`
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

/** Provider errors can embed prompts, uploads, URLs and keys. Keep diagnostics structural. */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return 'Unknown processing error'
  const status = (error as Error & { statusCode?: number }).statusCode
  const code = (error.cause as { code?: string } | undefined)?.code
  return `${error.name || 'Error'}${Number.isFinite(status) ? ` (HTTP ${status})` : ''}${code && /^[A-Z_0-9]+$/.test(code) ? ` (${code})` : ''}`
}
