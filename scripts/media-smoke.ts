import assert from 'node:assert/strict'
import jpeg from 'jpeg-js'
import { analyzeImage, analyzeVideo } from '../lib/pipeline/media-integrity'
import { parseImage, sniffContainer } from '../lib/media/containers'
import { parseTiff } from '../lib/media/exif'
import { parseXmpBytes } from '../lib/media/xmp'

/**
 * Fixture-driven smoke test for the media integrity pipeline.
 *
 * Fixtures are synthesised in-process (no network, no binary blobs in the repo)
 * so every assertion is reproducible: a real JPEG is encoded by jpeg-js, then
 * hand-built EXIF and XMP APP1 segments are spliced in at the correct offsets.
 */

const enc = new TextEncoder()

/** Encode a deterministic gradient as a real baseline JPEG. */
function baseJpeg(width: number, height: number, quality = 80): Uint8Array {
  const data = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4
      const v = (x * 3 + y * 5) % 256
      data[i] = v
      data[i + 1] = (v * 2) % 256
      data[i + 2] = (v * 3) % 256
      data[i + 3] = 255
    }
  }
  return new Uint8Array(jpeg.encode({ data, width, height }, quality).data)
}

type ExifString = { tag: number; text: string }

/**
 * Build a little-endian TIFF/EXIF APP1 payload (after the `Exif\0\0` prefix)
 * with a real Exif sub-IFD, so `dateTimeOriginal` is exercised end to end.
 *
 * Layout:
 *   [header 8][IFD0: 2 + n*12 + 4][Exif sub-IFD][string data]
 * Offsets stored in entries are relative to the TIFF header, per spec.
 */
function exifApp1(strings: ExifString[]): Uint8Array {
  const HEADER = 8
  const IFD0_TAGS: ExifString[] = strings.filter((s) => s.tag !== 0x9003)
  const EXIF_TAGS: ExifString[] = strings.filter((s) => s.tag === 0x9003)

  const ifd0Size = 2 + (IFD0_TAGS.length + 1) * 12 + 4 // +1 for the Exif pointer entry
  const exifIfdOffset = HEADER + ifd0Size
  const exifIfdSize = 2 + EXIF_TAGS.length * 12 + 4
  const dataStart = exifIfdOffset + exifIfdSize

  const stringBytes: number[] = []
  const stringAt = new Map<number, number>()
  let cursor = dataStart

  // Lay out every string first so the IFDs can reference known offsets.
  for (const s of [...IFD0_TAGS, ...EXIF_TAGS]) {
    stringAt.set(s.tag, cursor)
    for (const b of enc.encode(s.text)) stringBytes.push(b)
    stringBytes.push(0)
    cursor += s.text.length + 1
  }

  const writeIfd = (tags: ExifString[], exifPointer?: number) => {
    const bytes: number[] = []
    const push = (v: number) => bytes.push(v & 0xff)
    const writeEntry = (tag: number, type: number, count: number, value: number) => {
      push(tag)
      push(tag >> 8)
      push(type)
      push(0)
      push(count)
      push(count >> 8)
      push(0)
      push(0)
      push(value)
      push(value >> 8)
      push(value >> 16)
      push(value >>> 24)
    }
    // The Exif-pointer entry occupies a slot in IFD0, so it must be counted.
    push(tags.length + (exifPointer === undefined ? 0 : 1))
    push(0)
    if (exifPointer !== undefined) writeEntry(0x8769, 4, 1, exifPointer)
    for (const s of tags) {
      writeEntry(s.tag, 2, s.text.length + 1, stringAt.get(s.tag) ?? 0)
    }
    push(0)
    push(0)
    push(0)
    push(0) // no next IFD
    return bytes
  }

  const header = [0x49, 0x49, 42, 0, HEADER, 0, 0, 0]
  const ifd0 = writeIfd(IFD0_TAGS, exifIfdOffset)
  const exifIfd = writeIfd(EXIF_TAGS)

  return new Uint8Array([0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...header, ...ifd0, ...exifIfd, ...stringBytes])
}

function app1(payload: Uint8Array): number[] {
  return [0xff, 0xe1, ((payload.length + 2) >> 8) & 0xff, (payload.length + 2) & 0xff, ...payload]
}

/** Splice segments in directly after SOI (offset 2). */
function withSegments(jpeg: Uint8Array, segments: number[]): Uint8Array {
  const out = new Uint8Array(jpeg.length + segments.length)
  out.set(jpeg.subarray(0, 2), 0)
  out.set(segments, 2)
  out.set(jpeg.subarray(2), 2 + segments.length)
  return out
}


function xmpPacket(creator: string, c2pa = false): string {
  const manifest = c2pa
    ? '<c2pa:manifest c2pa:claim_generator="Adobe Photoshop 25.3"/><c2pa:assertion c2pa:label="c2pa.created"/>'
    : ''
  return `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:c2pa="http://c2pa.org/manifest/1.0/">
   <xmp:CreatorTool>${creator}</xmp:CreatorTool>
   <xmp:CreateDate>2024-03-11T08:15:22Z</xmp:CreateDate>
   ${manifest}
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`
}

/** A structurally valid 2x2 PNG carrying an XMP iTXt chunk. */
function pngWithXmp(creator: string): Uint8Array {
  const ihdr = new Uint8Array(13)
  const view = new DataView(ihdr.buffer)
  view.setUint32(0, 2)
  view.setUint32(4, 2)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // truecolour + alpha

  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length)
    const v = new DataView(out.buffer)
    v.setUint32(0, data.length)
    out.set(enc.encode(type), 4)
    out.set(data, 8)
    return out
  }

  // iTXt layout: keyword \0 compressionFlag compressionMethod lang \0 translated \0 text
  const xmp = enc.encode(xmpPacket(creator))
  const keyword = enc.encode('XML:com.adobe.xmp')
  const head = new Uint8Array(keyword.length + 5) // keyword + NUL, 2 flags, lang NUL, translated NUL
  head.set(keyword, 0)
  head[keyword.length] = 0 // NUL terminates the keyword
  // head[keyword.length + 1] = compressionFlag (0 = uncompressed)
  // head[keyword.length + 2] = compressionMethod
  // head[keyword.length + 3] = 0 -> empty language tag
  // head[keyword.length + 4] = 0 -> empty translated keyword
  const itxt = new Uint8Array(head.length + xmp.length)
  itxt.set(head, 0)
  itxt.set(xmp, head.length)

  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('iTXt', itxt),
    chunk('IEND', new Uint8Array(0)),
  ]
  const total = parts.reduce((sum, p) => sum + p.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

const results: string[] = []
async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn()
    results.push(`ok   ${name}`)
  } catch (error) {
    results.push(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}

const CANON_EXIF: ExifString[] = [
  { tag: 0x010f, text: 'Canon' },
  { tag: 0x0110, text: 'Canon EOS 5D Mark IV' },
  { tag: 0x0131, text: 'Adobe Photoshop 25.3 (Windows)' },
  { tag: 0x9003, text: '2024:03:11 08:15:22' },
]

async function main() {
  await check('sniffContainer identifies jpeg / png / unknown', () => {
    assert.equal(sniffContainer(baseJpeg(32, 32)), 'jpeg')
    assert.equal(sniffContainer(pngWithXmp('Midjourney v6')), 'png')
    assert.equal(sniffContainer(new Uint8Array(64)), 'unknown')
  })

  await check('parseImage walks JPEG segments and reads dimensions', () => {
    const parsed = parseImage(baseJpeg(64, 48))
    assert.equal(parsed.kind, 'jpeg')
    assert.equal(parsed.width, 64)
    assert.equal(parsed.height, 48)
    assert.ok(parsed.segments.length > 0, 'expected at least one segment')
    assert.ok(parsed.quantizationTables.length > 0, 'expected a DQT inventory')
    assert.notEqual(parsed.quantizationFingerprint, 'none')
  })

  await check('parseImage survives truncated and garbage input', () => {
    const parsed = parseImage(baseJpeg(64, 48).subarray(0, 20))
    assert.equal(parsed.kind, 'jpeg')
    assert.ok(parsed.warnings.length > 0, 'truncation should be reported')
    // Long enough to sniff, but with an out-of-range DQT length.
    const garbage = parseImage(new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0xff, 0xf0, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88]))
    assert.equal(garbage.kind, 'jpeg')
    assert.ok(garbage.warnings.length > 0, 'a bad segment length should be reported')
  })

  await check('parseTiff reads the injected EXIF block', () => {
    const exif = parseTiff(exifApp1(CANON_EXIF), 6)
    assert.ok(exif, 'expected EXIF to parse')
    assert.equal(exif.byteOrder, 'II')
    assert.equal(exif.make, 'Canon')
    assert.equal(exif.model, 'Canon EOS 5D Mark IV')
    assert.equal(exif.dateTimeOriginal, '2024:03:11 08:15:22')
  })

  await check('parseXmpBytes reads the creator tool and date', () => {
    const info = parseXmpBytes(enc.encode(xmpPacket('Midjourney v6')))
    assert.equal(info.present, true)
    assert.ok(info.creators.includes('Midjourney v6'), `creators: ${info.creators.join(',')}`)
    assert.equal(info.createDate, '2024-03-11T08:15:22Z')
  })

  await check('parseXmpBytes detects a C2PA reference without claiming validation', () => {
    const info = parseXmpBytes(enc.encode(xmpPacket('Adobe Photoshop 25.3', true)))
    assert.equal(info.c2pa.present, true)
    assert.equal(info.c2pa.claimGenerator, 'Adobe Photoshop 25.3')
    assert.notEqual(info.c2pa.validation, 'absent')
  })
}

async function pipelineChecks() {
  await check('analyzeImage flags Photoshop metadata as an AI-tool lead', async () => {
    const jpeg = withSegments(baseJpeg(64, 64), app1(exifApp1(CANON_EXIF)))
    const result = await analyzeImage(jpeg)
    assert.equal(result.container.exif?.make, 'Canon')
    assert.equal(result.container.exif?.software, 'Adobe Photoshop 25.3 (Windows)')
    const metadata = result.aiSignal.signals.find((s) => s.category === 'metadata')
    assert.ok(metadata)
    assert.equal(metadata.state, 'flag')
    assert.equal(result.aiSignal.type, 'possibly_ai_or_edited')
  })

  await check('analyzeImage reports inconclusive provenance with no manifest', async () => {
    const result = await analyzeImage(baseJpeg(64, 64))
    const provenance = result.aiSignal.signals.find((s) => s.category === 'provenance')
    assert.ok(provenance)
    assert.equal(provenance.state, 'inconclusive')
  })

  await check('analyzeImage reads XMP creator tools from a PNG iTXt chunk', async () => {
    const result = await analyzeImage(pngWithXmp('Midjourney v6'))
    assert.equal(result.container.kind, 'png')
    assert.equal(result.container.width, 2)
    assert.ok(result.container.xmp?.creators.includes('Midjourney v6'), 'expected the iTXt creator tool')
    assert.match(result.contextText, /Midjourney v6/)
  })

  await check('analyzeImage marks pixel forensics not-applicable for PNG', async () => {
    const result = await analyzeImage(pngWithXmp('Midjourney v6'))
    const forensics = result.aiSignal.signals.filter((s) => s.category === 'forensics')
    assert.ok(forensics.length > 0)
    assert.equal(forensics[0].executed, false)
    assert.equal(forensics[0].state, 'inconclusive')
  })

  await check('analyzeImage executes JPEG pixel forensics', async () => {
    const result = await analyzeImage(baseJpeg(128, 128))
    const ela = result.aiSignal.signals.find((s) => s.category === 'forensics' && /Error-level/.test(s.label))
    assert.ok(ela, 'expected an ELA signal')
    assert.equal(ela.executed, true)
    assert.ok(result.aiSignal.coverage > 0)
  })

  await check('analyzeVideo reports honest coverage for a non-video payload', async () => {
    const result = await analyzeVideo(new Uint8Array(200))
    assert.equal(result.container.kind, 'unknown')
    assert.ok(result.aiSignal.limitations.length > 0)
    assert.equal(result.aiSignal.type, 'indeterminate')
  })

  await check('no signal claims pass without executing, and all carry method + observation', async () => {
    const result = await analyzeImage(withSegments(baseJpeg(64, 64), app1(exifApp1(CANON_EXIF))))
    for (const s of result.aiSignal.signals) {
      assert.ok(s.method.length > 0, `signal ${s.id} missing method`)
      assert.ok(s.observed.length > 0, `signal ${s.id} missing observation`)
      assert.ok(s.meaning.length > 0, `signal ${s.id} missing meaning`)
      assert.ok(s.strength >= 0 && s.strength <= 100, `signal ${s.id} strength out of range`)
      if (!s.executed) assert.notEqual(s.state, 'pass', `signal ${s.id} claims pass without running`)
    }
  })
}

void main().then(pipelineChecks).then(() => {
  console.log(results.join('\n'))
  const failed = results.filter((r) => r.startsWith('FAIL')).length
  console.log(`\n${results.length - failed}/${results.length} media integrity checks passed`)
})
