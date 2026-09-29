import { ascii, cleanString, u32 } from './bytes'

/** Minimal MP4/MOV box walk: brand, timescale, duration, creation time. */
export type VideoContainer = {
  kind: 'mp4' | 'mov' | 'webm' | 'avi' | 'unknown'
  majorBrand?: string
  compatibleBrands: string[]
  durationSeconds?: number
  timescale?: number
  creationTime?: string
  modificationTime?: string
  tracks: { kind: string; codec?: string; width?: number; height?: number }[]
  xmpPresent: boolean
  softwareHints: string[]
  warnings: string[]
}

const MP4_EPOCH = Date.UTC(1904, 0, 1) / 1000

function mp4Time(value: number): string | undefined {
  if (!Number.isFinite(value) || value <= 0 || value > 0xffffffff) return undefined
  try {
    return new Date((MP4_EPOCH + value) * 1000).toISOString()
  } catch {
    return undefined
  }
}

function scanHints(bytes: Uint8Array, hints: Set<string>): void {
  const window = cleanString(bytes.subarray(0, Math.min(bytes.length, 256 * 1024))).toLowerCase()
  const patterns: [RegExp, string][] = [
    [/lavf/i, 'FFmpeg/Lavf'],
    [/adobe/i, 'Adobe exporter'],
    [/tiktok/i, 'TikTok'],
    [/instagram/i, 'Instagram'],
    [/capcut/i, 'CapCut'],
    [/kinemaster/i, 'KineMaster'],
    [/filmora/i, 'Filmora'],
    [/premiere/i, 'Premiere'],
  ]
  for (const [re, label] of patterns) {
    if (re.test(window)) hints.add(label)
  }
}


/** Walk top-level boxes; parse mvhd + track headers without full demux. */
export function parseVideo(bytes: Uint8Array): VideoContainer {
  const out: VideoContainer = { kind: 'unknown', compatibleBrands: [], tracks: [], xmpPresent: false, softwareHints: [], warnings: [] }
  try {
    if (bytes.length < 32) {
      out.warnings.push('File too small to identify as video.')
      return out
    }
    if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
      out.kind = 'webm'
      out.warnings.push('WebM/Matroska detected; deep box parsing limited to MP4/MOV.')
      return out
    }
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
      out.kind = 'avi'
      out.warnings.push('AVI detected; deep box parsing limited to MP4/MOV.')
      return out
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const ftypSize = u32(view, 0, false)
    const ftyp = ascii(view, 4, 4)
    if (ftyp !== 'ftyp' || ftypSize === undefined || ftypSize < 16) {
      out.warnings.push('No ftyp box; not MP4/MOV.')
      return out
    }
    out.majorBrand = ascii(view, 8, 4)
    const compatCount = Math.floor((ftypSize - 16) / 4)
    for (let i = 0; i < Math.min(compatCount, 16); i += 1) {
      const brand = ascii(view, 16 + i * 4, 4)
      if (brand) out.compatibleBrands.push(brand)
    }
    out.kind = out.majorBrand === 'qt  ' ? 'mov' : 'mp4'

    let offset = ftypSize
    let guard = 0
    while (offset + 8 <= bytes.length && guard < 64) {
      guard += 1
      const size = u32(view, offset, false)
      const type = ascii(view, offset + 4, 4)
      if (size === undefined || !type || size < 8 || offset + size > bytes.length + 8) break
      if (type === 'moov') {
        parseMoov(bytes, offset + 8, offset + size, out)
        break
      }
      if (type === 'uuid' && size > 32) {
        const head = cleanString(bytes.subarray(offset + 8, offset + 40))
        if (/xmp/i.test(head)) out.xmpPresent = true
      }
      offset += size
    }
    const hints = new Set(out.softwareHints)
    scanHints(bytes, hints)
    if (out.majorBrand) hints.add(`brand ${out.majorBrand}`)
    out.softwareHints = [...hints]
    if (!out.tracks.length) out.warnings.push('No track headers found inside moov; file may be truncated or fragmented.')
    return out
  } catch {
    out.warnings.push('Video walk failed partway; results are partial.')
    return out
  }
}

function parseMoov(bytes: Uint8Array, start: number, end: number, out: VideoContainer): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = start
  let guard = 0
  while (offset + 8 <= end && offset + 8 <= bytes.length && guard < 64) {
    guard += 1
    const size = u32(view, offset, false)
    const type = ascii(view, offset + 4, 4)
    if (size === undefined || !type || size < 8) break
    const boxEnd = Math.min(offset + size, end)
    if (type === 'mvhd' && offset + 32 <= bytes.length) {
      const version = bytes[offset + 8]
      if (version === 1 && offset + 44 <= bytes.length) {
        out.timescale = u32(view, offset + 28, false)
        const hi = u32(view, offset + 32, false) ?? 0
        const lo = u32(view, offset + 36, false) ?? 0
        if (out.timescale) out.durationSeconds = Math.round(((hi * 0x100000000 + lo) / out.timescale) * 10) / 10
      } else if (offset + 32 <= bytes.length) {
        out.creationTime = mp4Time(u32(view, offset + 12, false) ?? 0) ?? out.creationTime
        out.modificationTime = mp4Time(u32(view, offset + 16, false) ?? 0) ?? out.modificationTime
        out.timescale = u32(view, offset + 20, false)
        const duration = u32(view, offset + 24, false)
        if (out.timescale && duration !== undefined) out.durationSeconds = Math.round((duration / out.timescale) * 10) / 10
      }
    } else if (type === 'trak') {
      out.tracks.push(parseTrak(bytes, offset + 8, boxEnd))
    }
    offset = boxEnd
  }
}

function parseTrak(bytes: Uint8Array, start: number, end: number): VideoContainer['tracks'][number] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const track: VideoContainer['tracks'][number] = { kind: 'unknown' }
  let offset = start
  let guard = 0
  while (offset + 8 <= end && offset + 8 <= bytes.length && guard < 32) {
    guard += 1
    const size = u32(view, offset, false)
    const type = ascii(view, offset + 4, 4)
    if (size === undefined || !type || size < 8) break
    const boxEnd = Math.min(offset + size, end)
    if (type === 'mdia') parseMdia(bytes, offset + 8, boxEnd, track)
    else if (type === 'tkhd' && offset + 84 <= bytes.length) {
      const w = u32(view, offset + 76, false)
      const h = u32(view, offset + 80, false)
      if (w !== undefined) track.width = Math.floor(w / 65536)
      if (h !== undefined) track.height = Math.floor(h / 65536)
    }
    offset = boxEnd
  }
  return track
}

function parseMdia(bytes: Uint8Array, start: number, end: number, track: VideoContainer['tracks'][number]): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = start
  let guard = 0
  while (offset + 8 <= end && offset + 8 <= bytes.length && guard < 32) {
    guard += 1
    const size = u32(view, offset, false)
    const type = ascii(view, offset + 4, 4)
    if (size === undefined || !type || size < 8) break
    const boxEnd = Math.min(offset + size, end)
    if (type === 'hdlr' && offset + 20 <= bytes.length) {
      const handler = ascii(view, offset + 16, 4)
      if (handler === 'vide') track.kind = 'video'
      else if (handler === 'soun') track.kind = 'audio'
      else if (handler) track.kind = handler
    } else if (type === 'minf') {
      const codec = findCodec(bytes, offset + 8, boxEnd)
      if (codec) track.codec = codec
    }
    offset = boxEnd
  }
}

function findCodec(bytes: Uint8Array, start: number, end: number): string | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = start
  let guard = 0
  while (offset + 8 <= end && offset + 8 <= bytes.length && guard < 32) {
    guard += 1
    const size = u32(view, offset, false)
    const type = ascii(view, offset + 4, 4)
    if (size === undefined || !type || size < 8) return undefined
    if (type === 'stbl' || type === 'stsd') {
      const fourcc = ascii(view, offset + 24, 4)
      if (fourcc && /^[a-z0-9]{4}$/i.test(fourcc)) return fourcc
      return undefined
    }
    offset += size
  }
  return undefined
}
