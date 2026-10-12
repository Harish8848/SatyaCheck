/** Consume actual server progress; never advance stages using client timers. */
export async function readEvents(response: Response, receive: (event: Record<string, unknown>) => void) {
  if (!response.ok || !response.headers.get('content-type')?.includes('application/x-ndjson')) {
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Unable to complete this check.')
    receive(data); return
  }
  const reader = response.body?.getReader()
  if (!reader) throw new Error('The server returned no response stream.')
  const decoder = new TextDecoder(); let pending = '', finished = false
  const consume = (line: string) => { if (!line.trim()) return; const event = JSON.parse(line); if (event.data || event.review || event.error) finished = true; receive(event) }
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      pending += decoder.decode(value, { stream: true })
      let index: number
      while ((index = pending.indexOf('\n')) !== -1) { const line = pending.slice(0, index); pending = pending.slice(index + 1); consume(line) }
    }
    pending += decoder.decode(); consume(pending)
    if (!finished) throw new Error('The connection ended before the assessment finished. Please retry.')
  } finally { reader.releaseLock() }
}
