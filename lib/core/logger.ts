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

export function describeError(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause as { code?: string } | undefined
    const label = error.name && error.name !== 'Error' ? `${error.name}: ` : ''
    return `${label}${error.message}${cause?.code ? ` (${cause.code})` : ''}`
  }
  return String(error)
}
