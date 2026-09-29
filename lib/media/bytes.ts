/**
 * Low-level binary helpers shared by every container parser. Everything here is
 * endianness-explicit and bounds-checked: media files are untrusted input, so a
 * truncated or adversarial header must yield a tidy `undefined`, never a throw.
 */

export function u16(view: DataView, offset: number, littleEndian: boolean): number | undefined {
  if (offset < 0 || offset + 2 > view.byteLength) return undefined
  return view.getUint16(offset, littleEndian)
}

export function u32(view: DataView, offset: number, littleEndian: boolean): number | undefined {
  if (offset < 0 || offset + 4 > view.byteLength) return undefined
  return view.getUint32(offset, littleEndian)
}

export function u64(view: DataView, offset: number, littleEndian: boolean): bigint | undefined {
  if (offset < 0 || offset + 8 > view.byteLength) return undefined
  return view.getBigUint64(offset, littleEndian)
}

export function ascii(view: DataView, offset: number, length: number): string | undefined {
  if (offset < 0 || length < 0 || offset + length > view.byteLength) return undefined
  let text = ''
  for (let i = 0; i < length; i += 1) {
    text += String.fromCharCode(view.getUint8(offset + i))
  }
  return text
}

/** Decode a byte range as UTF-8/ASCII, trimming NULs and trailing whitespace. */
export function cleanString(bytes: Uint8Array): string {
  const end = bytes.indexOf(0)
  const slice = end === -1 ? bytes : bytes.subarray(0, end)
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(slice).trim()
  } catch {
    return Array.from(slice, (b) => String.fromCharCode(b)).join('').trim()
  }
}

export function slice(view: DataView, offset: number, length: number): Uint8Array | undefined {
  if (offset < 0 || length < 0 || offset + length > view.byteLength) return undefined
  return new Uint8Array(view.buffer, view.byteOffset + offset, length)
}

/** Find the next occurrence of a byte pattern; used to walk JPEG markers. */
export function indexOf(view: DataView, pattern: Uint8Array, from = 0): number {
  const limit = view.byteLength - pattern.length
  outer: for (let i = Math.max(0, from); i <= limit; i += 1) {
    for (let j = 0; j < pattern.length; j += 1) {
      if (view.getUint8(i + j) !== pattern[j]) continue outer
    }
    return i
  }
  return -1
}

export function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Convert a GPS DMS rational triple to decimal degrees.
 * Returns undefined for malformed or out-of-range input.
 */
export function gpsToDecimal(dms: [number, number, number], ref: string): number | undefined {
  const [deg, min, sec] = dms
  if (![deg, min, sec].every((v) => Number.isFinite(v)) || min < 0 || min >= 60 || sec < 0 || sec >= 60) return undefined
  const value = deg + min / 60 + sec / 3600
  const upper = ref.trim().toUpperCase()
  if (upper === 'S' || upper === 'W') return -value
  if (upper === 'N' || upper === 'E') return value
  return undefined
}

/** Split an XMP packet into its inner XML if wrapped, otherwise return as-is. */
export function unwrapXmp(raw: string): string {
  const begin = raw.indexOf('<x:xmpmeta')
  const packet = begin >= 0 ? raw.slice(begin) : raw
  const endMarker = packet.lastIndexOf('</x:xmpmeta>')
  return endMarker >= 0 ? packet.slice(0, endMarker + '</x:xmpmeta>'.length) : packet
}
