import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { UserFacingError } from './errors'

/**
 * SSRF guard for user-supplied URLs. Hostname deny-lists are not enough: a
 * public name can resolve to 127.0.0.1 or a cloud metadata address, so every
 * resolved address must be public.
 *
 * Limitation: DNS is resolved here and again by fetch(), so a hostile resolver
 * could rebind between the two lookups. Run behind an egress firewall for
 * defence in depth.
 */
export function isPrivateAddress(ip: string): boolean {
  const value = ip.toLowerCase()
  if (isIP(value) === 4) {
    const p = value.split('.').map(Number)
    const [a, b] = p
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 192 && b === 0 && p[2] === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    )
  }
  if (isIP(value) === 6) {
    if (value === '::' || value === '::1') return true
    if (value.startsWith('::ffff:')) {
      const mapped = value.slice(7)
      return isIP(mapped) === 4 ? isPrivateAddress(mapped) : true
    }
    return /^f[cd]/.test(value) || /^fe[89ab]/.test(value) || value.startsWith('ff')
  }
  return true
}

export async function assertPublicUrl(raw: string): Promise<void> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new UserFacingError('URL could not be parsed.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new UserFacingError('Only http(s) URLs can be fetched.')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  let addresses: string[]
  try {
    addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((entry) => entry.address)
  } catch {
    throw new UserFacingError('That URL’s host could not be resolved.')
  }
  if (!addresses.length || addresses.some(isPrivateAddress)) {
    throw new UserFacingError('Loopback, private-network and internal addresses cannot be fetched.')
  }
}
