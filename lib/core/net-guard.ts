import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { UserFacingError } from './errors'

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
      (a === 192 && b === 0 && p[2] === 2) ||
      (a === 198 && b === 51 && p[2] === 100) ||
      (a === 203 && b === 0 && p[2] === 113) ||
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
    // Only ordinary global-unicast IPv6; reject transition/translation and reserved ranges.
    return !/^[23][0-9a-f]{3}:/.test(value) || value.startsWith('2001:') || value.startsWith('2002:')
  }
  return true
}

export async function resolvePublicUrl(raw: string): Promise<string[]> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new UserFacingError('URL could not be parsed.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new UserFacingError('Only http(s) URLs can be fetched.')
  if (url.username || url.password || (url.port && !['80', '443'].includes(url.port))) throw new UserFacingError('URL credentials and nonstandard ports are not allowed.')
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
  return addresses
}

export async function assertPublicUrl(raw: string): Promise<void> { await resolvePublicUrl(raw) }
