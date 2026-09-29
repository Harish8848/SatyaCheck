import { ascii, gpsToDecimal, u16, u32 } from './bytes'
import { firstNumber, firstText, parseIfd } from './ifd'

/**
 * Pure-TypeScript TIFF/EXIF IFD parser covering JPEG APP1, TIFF files,
 * PNG eXIf chunks and WebP EXIF chunks.
 *
 * Handles both byte orders, nested EXIF / GPS / Interop sub-IFDs, thumbnail
 * IFD presence, and rational values. Returns `undefined` (never throws) for
 * anything malformed.
 */

export type ExifData = {
  byteOrder: 'II' | 'MM'
  /** Human-readable tag name -> formatted value. */
  fields: Record<string, string>
  make?: string
  model?: string
  software?: string
  dateTimeOriginal?: string
  dateTimeDigitized?: string
  modifyDate?: string
  artist?: string
  copyright?: string
  imageDescription?: string
  orientation?: number
  xResolution?: number
  yResolution?: number
  colorSpace?: number
  pixelXDimension?: number
  pixelYDimension?: number
  exposureTime?: string
  fNumber?: number
  iso?: number
  focalLength?: string
  lensModel?: string
  gpsLatitude?: number
  gpsLongitude?: number
  thumbnail: boolean
  thumbnailOffset?: number
  thumbnailLength?: number
  tagCount: number
}

const MAIN_TAGS: Record<number, string> = {
  0x010f: 'Make',
  0x0110: 'Model',
  0x0131: 'Software',
  0x0132: 'ModifyDate',
  0x013b: 'Artist',
  0x010e: 'ImageDescription',
  0x8298: 'Copyright',
  0x0112: 'Orientation',
  0x011a: 'XResolution',
  0x011b: 'YResolution',
  0x8769: 'ExifIFDPointer',
  0x8825: 'GPSInfoIFDPointer',
  0x9286: 'UserComment',
}

const EXIF_TAGS: Record<number, string> = {
  0x9003: 'DateTimeOriginal',
  0x9004: 'DateTimeDigitized',
  0xa002: 'PixelXDimension',
  0xa003: 'PixelYDimension',
  0xa001: 'ColorSpace',
  0x829a: 'ExposureTime',
  0x829d: 'FNumber',
  0x8827: 'ISO',
  0x920a: 'FocalLength',
  0xa434: 'LensModel',
  0x010f: 'Make',
  0x0110: 'Model',
}

const GPS_TAGS: Record<number, string> = {
  0x0001: 'GPSLatitudeRef',
  0x0002: 'GPSLatitude',
  0x0003: 'GPSLongitudeRef',
  0x0004: 'GPSLongitude',
  0x001d: 'GPSDateStamp',
}

export function parseTiff(buffer: Uint8Array, tiffStart = 0): ExifData | undefined {
  try {
    if (tiffStart < 0 || tiffStart + 8 > buffer.length) return undefined
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    const order = ascii(view, tiffStart, 2)
    if (order !== 'II' && order !== 'MM') return undefined
    const le = order === 'II'
    const ctx = { view, le, base: tiffStart }
    const magic = u16(view, tiffStart + 2, le)
    const ifd0 = u32(view, tiffStart + 4, le)
    if (magic !== 42 || ifd0 === undefined || ifd0 < 8) return undefined

    const fields: Record<string, string> = {}
    const main = parseIfd(ctx, tiffStart + ifd0)
    for (const [tag, text] of main.texts) {
      fields[MAIN_TAGS[tag] ?? `IFD0 0x${tag.toString(16)}`] = text
    }

    const exifTexts = new Map<number, string>()
    const exifNums = new Map<number, number[]>()
    const exifPointer = firstNumber(main.numbers, 0x8769)
    if (exifPointer !== undefined && exifPointer > 0) {
      const sub = parseIfd(ctx, tiffStart + exifPointer)
      for (const [tag, text] of sub.texts) {
        exifTexts.set(tag, text)
        fields[`Exif ${EXIF_TAGS[tag] ?? `0x${tag.toString(16)}`}`] = text
      }
      for (const [tag, nums] of sub.numbers) exifNums.set(tag, nums)
    }

    let gpsLatitude: number | undefined
    let gpsLongitude: number | undefined
    const gpsPointer = firstNumber(main.numbers, 0x8825)
    if (gpsPointer !== undefined && gpsPointer > 0) {
      const gps = parseIfd(ctx, tiffStart + gpsPointer)
      for (const [tag, text] of gps.texts) {
        fields[`GPS ${GPS_TAGS[tag] ?? `0x${tag.toString(16)}`}`] = text
      }
      const lat = gps.numbers.get(0x0002)
      const latRef = gps.texts.get(0x0001)
      const lon = gps.numbers.get(0x0004)
      const lonRef = gps.texts.get(0x0003)
      if (lat && lat.length >= 3 && latRef) gpsLatitude = gpsToDecimal([lat[0], lat[1], lat[2]], latRef)
      if (lon && lon.length >= 3 && lonRef) gpsLongitude = gpsToDecimal([lon[0], lon[1], lon[2]], lonRef)
    }

    const hasThumbnail = main.nextIfd > 0
    let thumbnailOffset: number | undefined
    let thumbnailLength: number | undefined
    if (hasThumbnail) {
      const ifd1 = parseIfd(ctx, tiffStart + main.nextIfd)
      const off = firstNumber(ifd1.numbers, 0x0201)
      const len = firstNumber(ifd1.numbers, 0x0202)
      if (off !== undefined && len !== undefined && len > 0 && len < buffer.length) {
        thumbnailOffset = tiffStart + off
        thumbnailLength = len
      }
    }

    return {
      byteOrder: order,
      fields,
      make: firstText(main.texts, 0x010f) ?? firstText(exifTexts, 0x010f),
      model: firstText(main.texts, 0x0110) ?? firstText(exifTexts, 0x0110),
      software: firstText(main.texts, 0x0131),
      dateTimeOriginal: firstText(exifTexts, 0x9003),
      dateTimeDigitized: firstText(exifTexts, 0x9004),
      modifyDate: firstText(main.texts, 0x0132),
      artist: firstText(main.texts, 0x013b),
      copyright: firstText(main.texts, 0x8298),
      imageDescription: firstText(main.texts, 0x010e),
      orientation: firstNumber(main.numbers, 0x0112),
      xResolution: firstNumber(main.numbers, 0x011a),
      yResolution: firstNumber(main.numbers, 0x011b),
      colorSpace: firstNumber(exifNums, 0xa001),
      pixelXDimension: firstNumber(exifNums, 0xa002),
      pixelYDimension: firstNumber(exifNums, 0xa003),
      exposureTime: firstText(exifTexts, 0x829a),
      fNumber: firstNumber(exifNums, 0x829d),
      iso: firstNumber(main.numbers, 0x8827) ?? firstNumber(exifNums, 0x8827),
      focalLength: firstText(exifTexts, 0x920a),
      lensModel: firstText(exifTexts, 0xa434),
      gpsLatitude,
      gpsLongitude,
      thumbnail: hasThumbnail,
      thumbnailOffset,
      thumbnailLength,
      tagCount: main.texts.size + exifTexts.size,
    }
  } catch {
    return undefined
  }
}

