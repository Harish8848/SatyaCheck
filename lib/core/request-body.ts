import { config } from './config'
import { UserFacingError } from './errors'

/** Bound the entire body before multipart/JSON allocation, including chunked requests. */
export async function boundedRequest(request: Request): Promise<Request> {
  const ceiling = request.headers.get('content-type')?.includes('multipart/form-data') ? Math.max(config.maxVideoBytes, config.maxImageBytes) + 256_000 : 1_000_000
  if (Number(request.headers.get('content-length')) > ceiling) throw new UserFacingError('Request exceeds the upload size limit.')
  const reader = request.body?.getReader(), chunks: Uint8Array[] = []; let size = 0
  if (reader) {
    let timedOut = false
    const timeout = setTimeout(() => { timedOut = true; void reader.cancel() }, 30_000)
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (timedOut) throw new UserFacingError('Upload timed out. Please try again with a smaller file.')
        if (done) break
        size += value.length
        if (size > ceiling) { await reader.cancel(); throw new UserFacingError('Request exceeds the upload size limit.') }
        chunks.push(value)
      }
    } finally { clearTimeout(timeout); reader.releaseLock() }
  }
  return new Request(request.url, { method: 'POST', headers: request.headers, body: Buffer.concat(chunks) })
}

