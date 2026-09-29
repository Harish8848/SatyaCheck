import { ascii, cleanString, u16, u32 } from './bytes'
import { parseTiff, type ExifData } from './exif'
import { parseXmpBytes, parseXmpText, type XmpInfo } from './xmp'

/**
 * Container sniffing + metadata extraction for still images.
 *
 * Supported: JPEG (APP0/1/13/14 segments, DQT inventory, MPF), PNG (all
 * ancillary chunks incl. iTXt XMP and eXIf), WebP (RIFF/VP8X incl. EXIF/XMP),
 * GIF (XMP + animation application extensions), BMP (headers only), TIFF.
 *
 * The goal is provenance evidence, not pixel forensics — that lives in
 * `jpeg-forensics.ts`. Every observation is attributed to the byte range or
 * segment that produced it.
 */

export type JpegSegment = { marker: number; name: string; offset: number; length: number; header?: string }

export type ContainerKind = 'jpeg' | 'png' | 'webp' | 'gif' | 'bmp' | 'tiff' | 'heic' | 'avif' | 'unknown'

export type ImageContainer = {
  kind: ContainerKind
  mime: string
  width?: number
  height?: number
  bitDepth?: number
  colorType?: string
  animated: boolean
  segments: JpegSegment[]
  exif?: ExifData
  xmp?: XmpInfo
  iptcFields: Record<string, string>
  quantizationTables: { index: number; precision: 8 | 16; values: number[] }[]
  quantizationFingerprint: string
  iccProfile: boolean
  iccDescription?: string
  /** e.g. WhatsApp, Facebook, Twitter, Instagram, editor names… */
  softwareHints: string[]
  warnings: string[]
}

const MARKER_NAMES: Record<number, string> = {
  0xd8: 'SOI',
  0xd9: 'EOI',
  0xe0: 'APP0',
  0xe1: 'APP1',
  0xe2: 'APP2',
  0xe3: 'APP3',
  0xe4: 'APP4',
  0xe5: 'APP5',
  0xe6: 'APP6',
  0xe7: 'APP7',
  0xe8: 'APP8',
  0xe9: 'APP9',
  0xea: 'APP10',
  0xeb: 'APP11',
  0xec: 'APP12',
  0xed: 'APP13',
  0xee: 'APP14',
  0xdb: 'DQT',
  0xc4: 'DHT',
  0xc0: 'SOF0',
  0xc1: 'SOF1',
  0xc2: 'SOF2',
  0xc3: 'SOF3',
  0xdd: 'DRI',
  0xfe: 'COM',
}

const STANDALONE = new Set([0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7])

export function sniffContainer(bytes: Uint8Array): ContainerKind {
  if (bytes.length < 12) return 'unknown'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png'
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'webp'
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'gif'
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return 'bmp'
  if ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) || (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a)) return 'tiff'
  if (bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11])
    if (brand === 'heic' || brand === 'heix' || brand === 'hevc' || brand === 'hevx') return 'heic'
    if (brand === 'avif' || brand === 'avis') return 'avif'
  }
  return 'unknown'
}


function emptyContainer(kind: ContainerKind, mime: string, warnings: string[] = []): ImageContainer {
  return {
    kind,
    mime,
    animated: false,
    segments: [],
    iptcFields: {},
    quantizationTables: [],
    quantizationFingerprint: 'none',
    iccProfile: false,
    softwareHints: [],
    warnings,
  }
}

function walkJpeg(bytes: Uint8Array): { segments: JpegSegment[]; warnings: string[] } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const segments: JpegSegment[] = []
  const warnings: string[] = []
  let offset = 2
  let guard = 0
  while (offset + 4 <= bytes.length && guard < 512) {
    guard += 1
    if (view.getUint8(offset) !== 0xff) break
    let marker = view.getUint8(offset + 1)
    while (marker === 0xff && offset + 2 < bytes.length) {
      offset += 1
      marker = view.getUint8(offset + 1)
    }
    if (marker === 0x00) {
      offset += 1
      continue
    }
    if (STANDALONE.has(marker) || marker === 0xd8 || marker === 0xd9) {
      segments.push({ marker, name: MARKER_NAMES[marker] ?? `0x${marker.toString(16)}`, offset, length: 2 })
      offset += 2
      if (marker === 0xd9) break
      continue
    }
    if (marker === 0xda) {
      segments.push({ marker, name: 'SOS', offset, length: bytes.length - offset })
      break // entropy-coded data follows; structure walk ends here
    }
    if (offset + 4 > bytes.length) {
      warnings.push('JPEG segment header truncated.')
      break
    }
    const length = view.getUint16(offset + 2, false)
    if (length < 2 || offset + 2 + length > bytes.length + 2) {
      warnings.push('JPEG segment length out of range; walk stopped.')
      break
    }
    const headerBytes = bytes.subarray(offset + 4, Math.min(offset + 4 + 32, offset + 2 + length))
    segments.push({
      marker,
      name: MARKER_NAMES[marker] ?? `0x${marker.toString(16)}`,
      offset,
      length: length + 2,
      header: cleanString(headerBytes).slice(0, 48),
    })
    offset += 2 + length
  }
  // Running out of bytes before SOS/EOI means the file is truncated; the caller
  // must be told, because every downstream finding is then partial.
  const endedCleanly = segments.some((s) => s.marker === 0xda || s.marker === 0xd9)
  if (!endedCleanly && warnings.length === 0) {
    warnings.push(
      offset >= bytes.length
        ? 'JPEG ended before the image data; the file appears truncated.'
        : 'JPEG structure walk stopped early; results are partial.',
    )
  }
  return { segments, warnings }
}


function segmentBytes(bytes: Uint8Array, segment: JpegSegment): Uint8Array {
  return bytes.subarray(segment.offset + 4, segment.offset + segment.length)
}

/** Read a DQT segment into table inventory. */
function readDqt(payload: Uint8Array, tables: ImageContainer['quantizationTables']): void {
  let at = 0
  while (at < payload.length) {
    const info = payload[at]
    const precision: 8 | 16 = info >> 4 === 0 ? 8 : 16
    const index = info & 0x0f
    const need = precision === 8 ? 64 : 128
    if (at + 1 + need > payload.length) return
    const values: number[] = []
    for (let i = 0; i < 64; i += 1) {
      values.push(precision === 8 ? payload[at + 1 + i] : (payload[at + 1 + i * 2] << 8) | payload[at + 2 + i * 2])
    }
    if (!tables.some((t) => t.index === index)) tables.push({ index, precision, values })
    at += 1 + need
  }
}

export function fingerprintTables(tables: ImageContainer['quantizationTables']): string {
  if (!tables.length) return 'none'
  return tables
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((t) => `${t.index}:${t.precision}:${t.values.slice(0, 8).join(',')}`)
    .join('|')
}


/** Scan raw bytes for platform/editor/AI fingerprints beyond formal metadata. */
function scanFingerprints(bytes: Uint8Array, hints: Set<string>): void {
  const window = cleanString(bytes.subarray(0, Math.min(bytes.length, 128 * 1024))).toLowerCase()
  const patterns: [RegExp, string][] = [
    [/whatsapp/i, 'WhatsApp'],
    [/facebook|fbcdn|fb\.me/i, 'Facebook'],
    [/instagram/i, 'Instagram'],
    [/twitter|twimg/i, 'Twitter/X'],
    [/tiktok/i, 'TikTok'],
    [/telegram/i, 'Telegram'],
    [/snapchat/i, 'Snapchat'],
    [/photoshop|adobe/i, 'Adobe Photoshop'],
    [/lightroom/i, 'Adobe Lightroom'],
    [/gimp/i, 'GIMP'],
    [/canva/i, 'Canva'],
    [/picsart/i, 'PicsArt'],
    [/snapseed/i, 'Snapseed'],
    [/midjourney|mj_/i, 'Midjourney'],
    [/dall[-\s]?e|openai/i, 'DALL-E / OpenAI'],
    [/stable diffusion|stability\.ai|automatic1111|comfyui|invokeai/i, 'Stable Diffusion tooling'],
    [/firefly/i, 'Adobe Firefly'],
    [/imagen/i, 'Google Imagen'],
    [/ideogram/i, 'Ideogram'],
    [/leonardo/i, 'Leonardo AI'],
  ]
  for (const [re, label] of patterns) {
    if (re.test(window)) hints.add(label)
  }
}

function readIptcEnvelope(bytes: Uint8Array, out: Record<string, string>): void {
  let at = 0
  const names: Record<number, string> = {
    25: 'keywords', 80: 'byline', 85: 'bylineTitle', 90: 'city', 95: 'province',
    101: 'country', 105: 'headline', 116: 'copyright', 120: 'caption',
  }
  while (at + 5 < bytes.length) {
    if (bytes[at] !== 0x1c || bytes[at + 1] !== 0x02) {
      at += 1
      continue
    }
    const dataset = bytes[at + 2]
    const length = (bytes[at + 3] << 8) | bytes[at + 4]
    if (length > 32 * 1024 || at + 5 + length > bytes.length) break
    const text = cleanString(bytes.subarray(at + 5, at + 5 + length)).slice(0, 500)
    if (text) {
      const key = names[dataset] ? `IPTC ${names[dataset]}` : `IPTC 2:${dataset}`
      out[key] = out[key] ? `${out[key]}; ${text}`.slice(0, 1000) : text
    }
    at += 5 + length
  }
}

function readIptc8bim(payload: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    let at = 0
    let guard = 0
    while (at + 8 < payload.length && guard < 64) {
      guard += 1
      const is8bim = payload[at] === 0x38 && payload[at + 1] === 0x42 && payload[at + 2] === 0x49 && payload[at + 3] === 0x4d
      if (!is8bim) {
        at += 1
        continue
      }
      const resourceId = (payload[at + 4] << 8) | payload[at + 5]
      const nameLen = payload[at + 6]
      const namePadded = (nameLen + 1) % 2 === 0 ? nameLen + 1 : nameLen + 2
      const base = at + 7 + namePadded
      let dataLen = 0
      let dataAt = base + 2
      if (resourceId === 0x0404) {
        dataLen =
          ((payload[base] ?? 0) << 24) | ((payload[base + 1] ?? 0) << 16) | ((payload[base + 2] ?? 0) << 8) | (payload[base + 3] ?? 0)
        dataAt = base + 4
      } else {
        dataLen = ((payload[base] ?? 0) << 8) | (payload[base + 1] ?? 0)
      }
      if (resourceId === 0x0404 && dataLen > 0 && dataAt + dataLen <= payload.length + 8) {
        readIptcEnvelope(payload.subarray(dataAt, Math.min(dataAt + dataLen, payload.length)), out)
        return out
      }
      at = dataAt + Math.max(0, dataLen) + (dataLen % 2 === 1 ? 1 : 0)
      if (at <= base) at = base + 8
    }
  } catch {
    /* best effort */
  }
  return out
}

/** Parse JPEG end to end. */
export function parseJpeg(bytes: Uint8Array): ImageContainer {
  const out = emptyContainer('jpeg', 'image/jpeg')
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const { segments, warnings } = walkJpeg(bytes)
    out.segments = segments
    out.warnings.push(...warnings)

    for (const segment of segments) {
      const payload = segmentBytes(bytes, segment)
      if (segment.marker === 0xe1) {
        const prefix = ascii(view, segment.offset + 4, Math.min(16, payload.length)) ?? ''
        if (prefix.startsWith('Exif')) {
          const exif = parseTiff(payload, 6)
          if (exif) {
            out.exif = exif
            if (exif.software) out.softwareHints.push(exif.software)
          }
        } else if (prefix.startsWith('http://ns.adobe.com/xap/1.0/')) {
          const nul = payload.indexOf(0)
          out.xmp = parseXmpBytes(nul === -1 ? payload : payload.subarray(nul + 1))
          for (const creator of out.xmp.creators) out.softwareHints.push(creator)
        } else if (prefix.startsWith('http://ns.adobe.com/xmp/extension/')) {
          out.warnings.push('Extended XMP segment present; only the main packet was read.')
        }
      } else if (segment.marker === 0xe0) {
        const id = cleanString(payload.subarray(0, 5))
        if (/jfif/i.test(id)) out.softwareHints.push(`JFIF (${id})`)
      } else if (segment.marker === 0xed) {
        const head = cleanString(payload.subarray(0, 64)).toLowerCase()
        if (head.includes('photoshop')) out.softwareHints.push('Photoshop APP13/IRB')
        Object.assign(out.iptcFields, readIptc8bim(payload))
      } else if (segment.marker === 0xdb) {
        readDqt(payload, out.quantizationTables)
      } else if (segment.marker === 0xc0 || segment.marker === 0xc1 || segment.marker === 0xc2) {
        if (payload.length >= 7) {
          out.bitDepth = payload[0]
          out.height = (payload[1] << 8) | payload[2]
          out.width = (payload[3] << 8) | payload[4]
        }
      } else if (segment.marker === 0xe2) {
        const head = cleanString(payload.subarray(0, 32))
        if (/mpf/i.test(head)) {
          out.warnings.push('MPF segment present — burst/panorama/depth payload.')
          out.softwareHints.push('Multi-Picture Format')
        }
        if (/icc_profile/i.test(head)) {
          out.iccProfile = true
          const desc = cleanString(payload.subarray(32, 96))
          if (desc) out.iccDescription = desc.slice(0, 80)
        }
      }
    }

    out.quantizationFingerprint = fingerprintTables(out.quantizationTables)
    const hints = new Set(out.softwareHints)
    scanFingerprints(bytes, hints)
    out.softwareHints = [...hints]
    return out
  } catch {
    out.warnings.push('JPEG walk failed partway; results are partial.')
    return out
  }
}

function readU32BE(view: DataView, offset: number): number | undefined {
  if (offset < 0 || offset + 4 > view.byteLength) return undefined
  return view.getUint32(offset, false)
}

/** Parse PNG chunks; extracts IHDR, eXIf, iTXt/tEXt XMP, pHYs, software hints. */
export function parsePng(bytes: Uint8Array): ImageContainer {
  const out = emptyContainer('png', 'image/png')
  try {
    if (bytes.length < 33) {
      out.warnings.push('PNG truncated before IHDR.')
      return out
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let offset = 8
    let guard = 0
    while (offset + 12 <= bytes.length && guard < 256) {
      guard += 1
      const length = readU32BE(view, offset)
      const type = ascii(view, offset + 4, 4)
      if (length === undefined || !type || length > 64 * 1024 * 1024) {
        out.warnings.push('PNG chunk header out of range; walk stopped.')
        break
      }
      const dataAt = offset + 8
      const dataEnd = dataAt + length
      if (dataEnd + 4 > bytes.length) {
        out.warnings.push('PNG chunk truncated.')
        break
      }
      if (type === 'IHDR' && length >= 13) {
        out.width = u32(view, dataAt, false)
        out.height = u32(view, dataAt + 4, false)
        out.bitDepth = view.getUint8(dataAt + 8)
        const colorType = view.getUint8(dataAt + 9)
        out.colorType = ['grayscale', 'unknown', 'truecolor', 'indexed', 'gray-alpha', 'unknown', 'truecolor-alpha'][colorType] ?? `type ${colorType}`
      } else if (type === 'eXIf' && length >= 8) {
        const exif = parseTiff(bytes.subarray(dataAt, dataEnd), 0)
        if (exif) {
          out.exif = exif
          if (exif.software) out.softwareHints.push(exif.software)
        }
      } else if ((type === 'iTXt' || type === 'zTXt' || type === 'tEXt') && length > 8) {
        const text = extractPngText(bytes.subarray(dataAt, dataEnd), type)
        if (text) {
          if (/xml/i.test(text.keyword) || /xmp/i.test(text.text.slice(0, 2000))) {
            const xmp = parseXmpText(text.text.slice(0, 256 * 1024))
            if (xmp.present) {
              out.xmp = xmp
              for (const creator of xmp.creators) out.softwareHints.push(creator)
            }
          }
          if (/software/i.test(text.keyword) && text.text) out.softwareHints.push(text.text.slice(0, 80))
          if (/creation time|create/i.test(text.keyword) && text.text) out.warnings.push(`PNG text ${text.keyword}: ${text.text.slice(0, 120)}`)
        }
      } else if (type === 'acTL') {
        out.animated = true
        out.warnings.push('APNG animation chunk present.')
      } else if (type === 'IEND') {
        break
      }
      offset = dataEnd + 4
    }
    const hints = new Set(out.softwareHints)
    scanFingerprints(bytes, hints)
    out.softwareHints = [...hints]
    return out
  } catch {
    out.warnings.push('PNG walk failed partway; results are partial.')
    return out
  }
}

function extractPngText(chunk: Uint8Array, type: string): { keyword: string; text: string } | undefined {
  try {
    if (type === 'tEXt') {
      const nul = chunk.indexOf(0)
      if (nul === -1) return undefined
      return { keyword: cleanString(chunk.subarray(0, nul)), text: cleanString(chunk.subarray(nul + 1)).slice(0, 262144) }
    }
    const nul = chunk.indexOf(0)
    if (nul === -1 || nul + 2 >= chunk.length) return undefined
    const keyword = cleanString(chunk.subarray(0, nul))
    // iTXt: compression flag + method + langtag\0 + translated\0 + text
    let at = nul + 1
    if (type === 'iTXt') {
      at += 2 // compression flag + method
      const langEnd = chunk.indexOf(0, at)
      if (langEnd === -1) return undefined
      at = langEnd + 1
      const transEnd = chunk.indexOf(0, at)
      if (transEnd === -1) return undefined
      at = transEnd + 1
    }
    return { keyword, text: cleanString(chunk.subarray(at)).slice(0, 262144) }
  } catch {
    return undefined
  }
}


/** Parse WebP (RIFF): VP8/VP8L/VP8X, EXIF + XMP chunks, alpha/animation flags. */
export function parseWebp(bytes: Uint8Array): ImageContainer {
  const out = emptyContainer('webp', 'image/webp')
  try {
    if (bytes.length < 30) {
      out.warnings.push('WebP too small to parse.')
      return out
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const fourcc = ascii(view, 12, 4)
    if (fourcc === 'VP8 ') {
      out.width = u16(view, 26, true) !== undefined ? (u16(view, 26, true)! & 0x3fff) : undefined
      out.height = u16(view, 28, true) !== undefined ? (u16(view, 28, true)! & 0x3fff) : undefined
    } else if (fourcc === 'VP8L' && bytes.length >= 25) {
      const b0 = bytes[21]
      const b1 = bytes[22]
      const b2 = bytes[23]
      const b3 = bytes[24]
      out.width = (((b1 & 0x3f) << 8) | b0) + 1
      out.height = (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) + 1
    } else if (fourcc === 'VP8X' && bytes.length >= 30) {
      out.width = (((bytes[26] << 16) | (bytes[25] << 8) | bytes[24]) & 0xffffff) + 1
      out.height = (((bytes[29] << 16) | (bytes[28] << 8) | bytes[27]) & 0xffffff) + 1
      const flags = bytes[19]
      if (flags & 0x02) {
        out.animated = true
        out.warnings.push('Animated WebP (ANMF chunks may follow).')
      }
      if (flags & 0x08) out.warnings.push('WebP container advertises EXIF chunk.')
      if (flags & 0x04) out.warnings.push('WebP container advertises XMP chunk.')
      if (flags & 0x10) out.warnings.push('WebP container advertises alpha.')
    }
    // Walk generic RIFF chunks for EXIF/XMP regardless of flavor.
    let offset = 12
    let guard = 0
    while (offset + 8 <= bytes.length && guard < 128) {
      guard += 1
      const id = ascii(view, offset, 4)
      const size = u32(view, offset + 4, true)
      if (!id || size === undefined || size > bytes.length) break
      const dataAt = offset + 8
      if (id === 'EXIF' && size >= 8) {
        const exif = parseTiff(bytes.subarray(dataAt, Math.min(dataAt + size, bytes.length)), 0)
        if (exif) {
          out.exif = exif
          if (exif.software) out.softwareHints.push(exif.software)
        }
      } else if (id === 'XMP ' && size > 0) {
        const xmp = parseXmpBytes(bytes.subarray(dataAt, Math.min(dataAt + size, bytes.length)))
        if (xmp.present) {
          out.xmp = xmp
          for (const creator of xmp.creators) out.softwareHints.push(creator)
        }
      }
      offset = dataAt + size + (size % 2 === 1 ? 1 : 0)
    }
    const hints = new Set(out.softwareHints)
    scanFingerprints(bytes, hints)
    out.softwareHints = [...hints]
    return out
  } catch {
    out.warnings.push('WebP walk failed partway; results are partial.')
    return out
  }
}

/** Parse GIF: dimensions, animation (NETSCAPE/Application extensions), XMP. */
export function parseGif(bytes: Uint8Array): ImageContainer {
  const out = emptyContainer('gif', 'image/gif')
  try {
    if (bytes.length < 10) return out
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    out.width = u16(view, 6, true)
    out.height = u16(view, 8, true)
    let offset = 13
    const gctFlag = (bytes[4] & 0x80) !== 0
    if (gctFlag) offset += 3 * (1 << ((bytes[4] & 0x07) + 1))
    let guard = 0
    while (offset + 2 <= bytes.length && guard < 512) {
      guard += 1
      const sep = bytes[offset]
      if (sep === 0x3b) break
      if (sep === 0x21) {
        const label = bytes[offset + 1]
        if (label === 0xff && offset + 14 <= bytes.length) {
          const appId = cleanString(bytes.subarray(offset + 3, offset + 11))
          if (/netscape/i.test(appId)) {
            out.animated = true
            out.warnings.push('NETSCAPE animation extension present.')
          }
          if (/xmp/i.test(appId)) {
            // XMP Application Extension: sub-blocks until zero-length block.
            let at = offset + 14
            const parts: Uint8Array[] = []
            while (at + 1 <= bytes.length) {
              const size = bytes[at]
              if (size === 0) break
              if (at + 1 + size > bytes.length) break
              parts.push(bytes.subarray(at + 1, at + 1 + size))
              at += 1 + size
            }
            const joined = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
            let w = 0
            for (const p of parts) {
              joined.set(p, w)
              w += p.length
            }
            const xmp = parseXmpBytes(joined)
            if (xmp.present) {
              out.xmp = xmp
              for (const creator of xmp.creators) out.softwareHints.push(creator)
            }
          }
        }
        // Skip extension sub-blocks.
        let at = offset + 2
        while (at + 1 <= bytes.length) {
          const size = bytes[at]
          if (size === 0) {
            at += 1
            break
          }
          at += 1 + size
        }
        offset = at
      } else if (sep === 0x2c) {
        out.animated = out.animated || offset > 13
        if (offset + 10 > bytes.length) break
        const lctFlag = (bytes[offset + 9] & 0x80) !== 0
        offset += 10
        if (lctFlag) offset += 3 * (1 << ((bytes[offset - 1] & 0x07) + 1))
        offset += 1 // LZW min code size
        while (offset + 1 <= bytes.length) {
          const size = bytes[offset]
          if (size === 0) {
            offset += 1
            break
          }
          offset += 1 + size
        }
      } else {
        break
      }
    }
    if (out.animated) out.warnings.push('Multiple image descriptors — animated GIF.')
    const hints = new Set(out.softwareHints)
    scanFingerprints(bytes, hints)
    out.softwareHints = [...hints]
    return out
  } catch {
    out.warnings.push('GIF walk failed partway; results are partial.')
    return out
  }
}

/** Parse BMP headers only (dimensions + bit depth). */
export function parseBmp(bytes: Uint8Array): ImageContainer {
  const out = emptyContainer('bmp', 'image/bmp')
  try {
    if (bytes.length < 54) {
      out.warnings.push('BMP truncated before DIB header.')
      return out
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const dibSize = u32(view, 14, true)
    if (dibSize !== undefined && dibSize >= 40 && bytes.length >= 30) {
      out.width = u32(view, 18, true)
      const rawHeight = u32(view, 22, true)
      out.height = rawHeight !== undefined && rawHeight > 0x80000000 ? 0x100000000 - rawHeight : rawHeight
      out.bitDepth = u16(view, 28, true)
    } else {
      out.warnings.push('Legacy BMP DIB header; dimensions unread.')
    }
    const hints = new Set(out.softwareHints)
    scanFingerprints(bytes, hints)
    out.softwareHints = [...hints]
    return out
  } catch {
    out.warnings.push('BMP walk failed partway; results are partial.')
    return out
  }
}

/** Parse a bare TIFF file (EXIF module reused, header describes dimensions). */
export function parseTiffFile(bytes: Uint8Array): ImageContainer {
  const out = emptyContainer('tiff', 'image/tiff')
  const exif = parseTiff(bytes, 0)
  if (exif) {
    out.exif = exif
    const width = Number(exif.fields['IFD0 0x100'] ?? exif.fields['ImageWidth'] ?? Number.NaN)
    const height = Number(exif.fields['IFD0 0x101'] ?? exif.fields['ImageLength'] ?? Number.NaN)
    if (Number.isFinite(width)) out.width = width
    if (Number.isFinite(height)) out.height = height
    if (exif.software) out.softwareHints.push(exif.software)
  } else {
    out.warnings.push('TIFF header valid but IFD unreadable.')
  }
  const hints = new Set(out.softwareHints)
  scanFingerprints(bytes, hints)
  out.softwareHints = [...hints]
  return out
}

/** Dispatch bytes to the right container parser by sniffed kind. */
export function parseImage(bytes: Uint8Array): ImageContainer {
  const kind = sniffContainer(bytes)
  switch (kind) {
    case 'jpeg':
      return parseJpeg(bytes)
    case 'png':
      return parsePng(bytes)
    case 'webp':
      return parseWebp(bytes)
    case 'gif':
      return parseGif(bytes)
    case 'bmp':
      return parseBmp(bytes)
    case 'tiff':
      return parseTiffFile(bytes)
    case 'heic':
      return emptyContainer('heic', 'image/heic', ['HEIC container detected; metadata parsing not yet implemented — pixel forensics unavailable.'])
    case 'avif':
      return emptyContainer('avif', 'image/avif', ['AVIF container detected; metadata parsing not yet implemented — pixel forensics unavailable.'])
    default:
      return emptyContainer('unknown', 'application/octet-stream', ['Unrecognized image container; only fingerprint scan performed.'])
  }
}
