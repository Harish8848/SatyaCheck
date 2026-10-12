import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { LookupFunction } from 'node:net'
import { resolvePublicUrl } from './net-guard'
import { config } from './config'

/** Connect only to the DNS addresses we validated. Preserve Host/SNI and TLS verification. */
export async function fetchPublicPage(raw: string): Promise<{ bytes: Uint8Array; contentType: string; finalUrl: string }> {
  const deadline = AbortSignal.timeout(config.fetchTimeoutMs)
  let current = raw
  for (let hop = 0; hop <= config.maxRedirects; hop++) {
    deadline.throwIfAborted()
    const resolved = await Promise.race([
      resolvePublicUrl(current),
      new Promise<never>((_, reject) => deadline.addEventListener('abort', () => reject(new Error('Page fetch timed out.')), { once: true })),
    ])
    const url = new URL(current)
    const result = await new Promise<{ bytes: Uint8Array; contentType: string; location?: string }>((resolve, reject) => {
      const lookup: LookupFunction = (_host, options, callback) => {
        const addresses = resolved.map(address => ({ address, family: address.includes(':') ? 6 : 4 }))
        if (options.all) callback(null, addresses)
        else callback(null, addresses[0].address, addresses[0].family)
      }
      const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
        agent: false, lookup, signal: deadline,
        headers: { 'user-agent': 'SatyaCheck/1.0', accept: 'text/html,application/xhtml+xml', 'accept-encoding': 'identity' },
      }, res => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.destroy(); resolve({ bytes: new Uint8Array(), contentType: '', location: res.headers.location }); return
        }
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) { res.destroy(); reject(new Error(`Page returned HTTP ${res.statusCode}. Paste its text or upload a copy.`)); return }
        const contentType = res.headers['content-type'] ?? ''
        if (!/^(text\/(html|plain)|application\/xhtml\+xml)/i.test(contentType)) { res.destroy(); reject(new Error('Unsupported page content type.')); return }
        const chunks: Buffer[] = []; let total = 0
        res.on('data', (chunk: Buffer) => {
          total += chunk.length
          if (total > config.maxRemoteBytes) { res.destroy(new Error('Page exceeds the safe download limit.')); return }
          chunks.push(chunk)
        })
        res.on('error', reject)
        res.on('end', () => resolve({ bytes: Buffer.concat(chunks), contentType }))
      })
      req.on('error', reject); req.end()
    })
    if (result.location) { current = new URL(result.location, current).toString(); continue }
    return { ...result, finalUrl: current }
  }
  throw new Error('Too many redirects.')
}
