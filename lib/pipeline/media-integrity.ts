import { parseImage, type ImageContainer } from '../media/containers'
import { analyzeJpeg, type BlockGrid } from '../media/jpeg-forensics'
import { parseVideo, type VideoContainer } from '../media/video'
import { parseXmpBytes } from '../media/xmp'
import type { AiContentSignal, MediaSignal } from '../core/types'
import { log } from '../core/logger'

/**
 * Media integrity: deterministic signal extraction per the pipeline diagram.
 *
 *   IMAGE / VIDEO -> C2PA provenance, watermark signals, forensics analysis
 *                 -> AI content signal
 *
 * Three rules govern every signal here:
 *  1. A check that could not run is `inconclusive`, never `pass`. Absence of
 *     provenance is not authenticity.
 *  2. Every observation carries the method that produced it, so the report can
 *     be audited.
 *  3. The fused index is a *suspicion* score over the checks that ran, not a
 *     probability of synthetic origin. Coverage is reported alongside it.
 */

type Builder = Omit<MediaSignal, 'contribution'>

export type ImageIntegrity = {
  container: ImageContainer
  aiSignal: AiContentSignal
  /** Plain-language context for claim extraction and the final assessment. */
  contextText: string
}

export type VideoIntegrity = {
  container: VideoContainer
  aiSignal: AiContentSignal
  contextText: string
}

const AI_TOOL_HINTS = [
  'midjourney',
  'dall-e',
  'stable diffusion',
  'stability.ai',
  'firefly',
  'imagen',
  'ideogram',
  'leonardo',
  'openai',
  'comfyui',
  'invokeai',
  'automatic1111',
  // Adobe products are the most common generative/editing trace in the wild:
  // Firefly and the Generative Fill history action are explicitly AI-backed.
  'photoshop',
  'adobe firefly',
]

let counter = 0
function signal(partial: Omit<Builder, 'id'>): Builder {
  counter += 1
  return { id: `sig-${counter}-${partial.category}`, ...partial }
}

function aiToolHint(values: string[]): string | undefined {
  const joined = values.join(' ').toLowerCase()
  return AI_TOOL_HINTS.find((hint) => joined.includes(hint))
}

async function decodeLuminance(bytes: Uint8Array): Promise<{ grid?: BlockGrid; note: string }> {
  try {
    const jpeg = await import('jpeg-js')
    const decoded = jpeg.decode(bytes, { maxMemoryUsageInMB: 256, useTArray: true })
    if (!decoded?.data || !decoded.width || !decoded.height) return { note: 'Decoder returned no pixels.' }
    const pixels = decoded.data
    const luminance = new Uint8Array(decoded.width * decoded.height)
    for (let i = 0; i < luminance.length; i += 1) {
      const r = pixels[i * 4] ?? 0
      const g = pixels[i * 4 + 1] ?? 0
      const b = pixels[i * 4 + 2] ?? 0
      luminance[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b)
    }
    return {
      grid: { width: decoded.width, height: decoded.height, luminance },
      note: `Decoded ${decoded.width}x${decoded.height} to luminance.`,
    }
  } catch (error) {
    return { note: error instanceof Error ? `Decode skipped: ${error.message.slice(0, 120)}` : 'Decode skipped.' }
  }
}

/**
 * Deterministic fusion. Only signals that actually executed contribute to the
 * score; the denominator is the weight of everything that *could* have run, so
 * low coverage pushes the verdict toward `indeterminate`, never toward "clean".
 */
function fuseSignals(signals: Builder[], limitations: string[], scope: string): AiContentSignal {
  const runnable = signals.filter((s) => s.applicable && s.executed)
  const weighted = runnable.reduce(
    (sum, s) => sum + (s.state === 'flag' ? s.strength : s.state === 'inconclusive' ? s.strength * 0.25 : 0),
    0,
  )
  const possibleWeight = signals.filter((s) => s.applicable).reduce((sum, s) => sum + s.strength, 0) || 1
  const coverage = Math.round((runnable.length / Math.max(1, signals.length)) * 100)
  const score = Math.max(0, Math.min(100, Math.round((weighted / possibleWeight) * 100)))
  const flagged = runnable.filter((s) => s.state === 'flag')
  // A single metadata or watermark hit is an *edit* trace, not proof of
  // synthesis: a Photoshop re-save is the most ordinary thing on the internet.
  // Reserve "likely AI generated" for cases where a forensic or model-level
  // check corroborates the metadata, so one editable string cannot carry it.
  const hasPixelCorroboration = flagged.some((s) => s.corroboratesSynthesis)

  const type: AiContentSignal['type'] =
    flagged.length === 0
      ? coverage < 50
        ? 'indeterminate'
        : 'no_ai_signal_detected'
      : score >= 60 && hasPixelCorroboration
        ? 'likely_ai_generated'
        : 'possibly_ai_or_edited'

  const summary =
    type === 'likely_ai_generated'
      ? `Signals for this ${scope} lean toward synthetic or heavily processed content. Treat as a lead for the evidence stages, not a verdict.`
      : type === 'possibly_ai_or_edited'
        ? `Some ${scope} signals indicate editing or platform processing. That is common and benign on its own; the claim evidence below carries the assessment.`
        : type === 'indeterminate'
          ? `Only ${coverage}% of the ${scope} checks could run, so no conclusion about synthetic origin is defensible.`
          : `No AI-generation signal was detected in this ${scope}. This neither authenticates the content nor rules out editing.`

  return {
    type,
    score,
    coverage,
    signals: signals.map((s) => ({
      ...s,
      contribution: s.state === 'flag' ? s.strength : s.state === 'inconclusive' ? Math.round(s.strength * 0.25) : 0,
    })),
    summary,
    limitations: [...new Set(limitations)],
  }
}


function provenanceSignalsImage(container: ImageContainer, signals: Builder[], limitations: string[]): void {
  const xmp = container.xmp
  if (!xmp?.present) {
    signals.push(
      signal({
        category: 'provenance',
        label: 'C2PA / signed provenance',
        state: 'inconclusive',
        applicable: true,
        executed: true,
        observed: 'No XMP packet and no C2PA manifest reference found.',
        meaning: 'Most captures and screenshots carry no signed provenance; absence proves nothing either way.',
        strength: 20,
        method: 'XMP packet scan for c2pa:manifest / dcterms:provenance tags.',
        caveat: 'Only embedded manifest references are checked; cloud registries are not queried.',
      }),
    )
  } else if (xmp.c2pa.present) {
    signals.push(
      signal({
        category: 'provenance',
        label: 'C2PA / signed provenance',
        state: 'pass',
        applicable: true,
        executed: true,
        observed: `Manifest reference present${xmp.c2pa.claimGenerator ? ` (generator: ${xmp.c2pa.claimGenerator})` : ''}; validation: ${xmp.c2pa.validation}.`,
        meaning: 'A manifest reference suggests a provenance-aware exporter. Without cryptographic validation the named generator is asserted, not proven.',
        strength: 30,
        method: 'XMP packet scan for c2pa:manifest / dcterms:provenance tags.',
        caveat: 'Presence only — the signature was NOT validated in this build.',
      }),
    )
    limitations.push('C2PA manifest presence is reported without signature validation.')
  } else {
    signals.push(
      signal({
        category: 'provenance',
        label: 'C2PA / signed provenance',
        state: 'inconclusive',
        applicable: true,
        executed: true,
        observed: `XMP present (${xmp.packetLength} chars) but no C2PA manifest reference.`,
        meaning: 'Editors that attach XMP without C2PA leave content unattributed; claims still need external evidence.',
        strength: 15,
        method: 'XMP packet scan for c2pa:manifest / dcterms:provenance tags.',
      }),
    )
  }

  if (xmp?.present && xmp.historyActions.length) {
    const extra = xmp.historyActions.length > 6 ? ` (+${xmp.historyActions.length - 6} more)` : ''
    signals.push(
      signal({
        category: 'provenance',
        label: 'Edit-history trail',
        state: 'flag',
        applicable: true,
        executed: true,
        observed: `XMP history: ${xmp.historyActions.slice(0, 6).join(', ')}${extra}.`,
        meaning: 'A recorded edit history means the file passed through editing software after capture.',
        strength: 25,
        method: 'xmpMM:History action enumeration.',
        caveat: 'An edit history is not evidence that the edit was deceptive.',
      }),
    )
  }
}


function metadataSignalImage(container: ImageContainer, signals: Builder[]): void {
  const exif = container.exif
  const software = [exif?.software, ...container.softwareHints].filter(Boolean) as string[]
  const toolHit = aiToolHint(software)

  if (exif && exif.tagCount > 0) {
    const camera = [exif.make, exif.model].filter(Boolean).join(' ') || 'camera make/model absent'
    const when = exif.dateTimeOriginal ?? exif.dateTimeDigitized ?? exif.modifyDate ?? 'no capture date'
    const tools = software.length ? `; software: ${software.slice(0, 3).join('; ')}` : ''
    signals.push(
      signal({
        category: 'metadata',
        label: 'Capture metadata (EXIF)',
        state: toolHit ? 'flag' : 'pass',
        applicable: true,
        executed: true,
        observed: `${exif.tagCount} EXIF tags; ${camera}; ${when}${tools}.`,
        meaning: toolHit
          ? 'The embedded software tag names a generative or editing tool.'
          : 'Camera-style metadata is consistent with a direct capture, but EXIF is trivially rewritten so this is weak evidence.',
        strength: toolHit ? 45 : 10,
        method: 'TIFF IFD parse of the APP1/eXIf payload.',
        caveat: 'EXIF can be stripped, forged, or inherited from a template.',
      }),
    )
  } else {
    signals.push(
      signal({
        category: 'metadata',
        label: 'Capture metadata (EXIF)',
        state: 'inconclusive',
        applicable: true,
        executed: true,
        observed: 'No EXIF block found — common after screenshots, downloads, and social re-uploads.',
        meaning: 'Missing metadata removes one provenance avenue; the content must be judged on pixels and claims alone.',
        strength: 10,
        method: 'TIFF IFD parse of the APP1/eXIf payload.',
      }),
    )
  }
}

function watermarkSignalImage(container: ImageContainer, signals: Builder[]): void {
  // EXIF's Software tag is just as much a generator trace as the XMP creator
  // tool, so it belongs in the haystack.
  const haystack = [
    container.exif?.software ?? '',
    ...container.softwareHints,
    container.xmp?.creators.join(' ') ?? '',
    Object.values(container.iptcFields).join(' '),
  ]
    .join(' ')
    .toLowerCase()
  const aiHit = AI_TOOL_HINTS.find((hint) => haystack.includes(hint))

  if (aiHit) {
    const detail = container.softwareHints.slice(0, 3).join('; ') || 'XMP/IPTC fields'
    signals.push(
      signal({
        category: 'watermark',
        label: 'Generator / watermark strings',
        state: 'flag',
        applicable: true,
        executed: true,
        observed: `Embedded string names "${aiHit}" (${detail}).`,
        meaning: 'The file advertises a generative tool in its own metadata — a strong lead that still has to agree with the visual content and the claims.',
        strength: 50,
        method: 'Case-insensitive scan of APP segments, XMP creator tools, and IPTC fields.',
        caveat: 'Metadata strings can be forged; treat as a lead, not proof.',
      }),
    )
    return
  }

  const platformHit = container.softwareHints.find((h) => /whatsapp|facebook|instagram|twitter|tiktok|telegram|screenshot/i.test(h))
  signals.push(
    signal({
      category: 'watermark',
      label: 'Generator / watermark strings',
      state: platformHit ? 'flag' : 'inconclusive',
      applicable: true,
      executed: true,
      observed: platformHit ? `Platform/editor trace: ${platformHit}.` : 'No generator, watermark, or platform string embedded.',
      meaning: platformHit
        ? 'Platform traces show the file was re-encoded in transit, which degrades provenance but says nothing about truth.'
        : 'Absence of embedded strings is normal; most exports carry none.',
      strength: platformHit ? 15 : 5,
      method: 'Case-insensitive scan of APP segments, XMP creator tools, and IPTC fields.',
    }),
  )
}

/** Full image path: container metadata + pixel forensics fused into one signal. */
export async function analyzeImage(bytes: Uint8Array): Promise<ImageIntegrity> {
  const container = parseImage(bytes)
  const limitations: string[] = [...container.warnings]
  const signals: Builder[] = []

  provenanceSignalsImage(container, signals, limitations)
  metadataSignalImage(container, signals)
  watermarkSignalImage(container, signals)

  if (container.kind === 'jpeg') {
    const { grid, note } = await decodeLuminance(bytes)
    const forensics = analyzeJpeg(grid, container.quantizationTables)
    limitations.push(...forensics.warnings, note)

    signals.push(
      signal({
        category: 'forensics',
        label: 'JPEG re-encode / quantization trail',
        state: forensics.customQuantization ? 'flag' : container.quantizationTables.length ? 'pass' : 'inconclusive',
        applicable: true,
        executed: true,
        observed: forensics.customQuantization
          ? `Custom quantization (${container.quantizationFingerprint}).`
          : container.quantizationTables.length
            ? `Standard tables (${container.quantizationFingerprint}).`
            : 'No DQT segments parsed.',
        meaning: 'Custom tables prove a re-encode — an editor, a platform, or a composite step. That is equally consistent with innocent sharing.',
        strength: 20,
        method: 'DQT inventory compared against stock IJG / Photoshop families.',
        caveat: 'A re-encode alone never proves a claim false; most viral images are re-encoded.',
      }),
    )

    signals.push(
      signal({
        category: 'forensics',
        label: 'Error-level / noise consistency',
        state: !grid ? 'inconclusive' : forensics.ela.suspicious ? 'flag' : 'pass',
        applicable: grid !== undefined,
        executed: grid !== undefined,
        observed: grid
          ? `ELA hot blocks ${(forensics.ela.hotBlockFraction * 100).toFixed(1)}%; noise outliers ${(forensics.noise.outlierFraction * 100).toFixed(1)}%.`
          : `Pixel proxy skipped: ${note}`,
        meaning: 'Localized hotspots can indicate pasted or generated regions — or just text overlays, recompression, and flat skies.',
        strength: 30,
        method: 'Block-mean ELA proxy and per-block variance outlier scan on decoded luminance.',
        corroboratesSynthesis: true,
        caveat: grid ? 'Heuristic proxy, not true ELA; overlays and memes routinely trigger it.' : 'Decode unavailable, so pixel forensics did not run.',
      }),
    )

    if (!grid) limitations.push('Pixel-level ELA and noise proxies skipped: JPEG decode unavailable.')
  } else {
    limitations.push(`${container.kind.toUpperCase()} pixel forensics: only JPEG is covered in this build.`)
    signals.push(
      signal({
        category: 'forensics',
        label: 'Pixel forensics',
        state: 'inconclusive',
        applicable: false,
        executed: false,
        observed: `Deterministic pixel forensics cover JPEG only; this file is ${container.kind.toUpperCase()}.`,
        meaning: 'The assessment rests on metadata, C2PA, and claim evidence instead.',
        strength: 25,
        method: 'JPEG-only in this build.',
        caveat: 'A clean metadata read must never be presented as authentication.',
      }),
    )
  }

  const aiSignal = fuseSignals(signals, limitations, 'image')
  log('info', 'image integrity complete', { kind: container.kind, score: aiSignal.score, type: aiSignal.type })

  const dimensions = container.width && container.height ? ` ${container.width}x${container.height}` : ''
  const contextText = [
    `Image: ${container.kind.toUpperCase()}${dimensions}.`,
    container.exif ? `EXIF tags: ${container.exif.tagCount}.` : 'No EXIF.',
    container.xmp?.present ? `XMP creators: ${container.xmp.creators.join(', ') || 'none listed'}.` : 'No XMP.',
    container.xmp?.c2pa.present ? `C2PA manifest referenced (${container.xmp.c2pa.validation}).` : 'No C2PA manifest.',
    `AI-content suspicion ${aiSignal.score}/100 (${aiSignal.type}).`,
  ].join(' ')

  return { container, aiSignal, contextText }
}

/** Video path: box walk, XMP, and exporter traces fused into one signal. */
export async function analyzeVideo(bytes: Uint8Array): Promise<VideoIntegrity> {
  const container = parseVideo(bytes)
  const limitations: string[] = [...container.warnings]
  const signals: Builder[] = []
  const tools = container.softwareHints.join('; ')
  // If we could not even identify the container, none of the metadata-driven
  // checks really ran. Recording them as executed would inflate coverage and
  // let an unreadable file masquerade as a clean one.
  const identified = container.kind !== 'unknown'
  if (!identified) {
    limitations.push('Container could not be identified, so metadata-driven checks were not executed.')
  }

  signals.push(
    signal({
      category: 'provenance',
      label: 'C2PA / embedded provenance (video)',
      state: identified && container.xmpPresent ? 'pass' : 'inconclusive',
      applicable: identified,
      executed: identified,
      observed: container.xmpPresent ? 'XMP/UUID provenance box present.' : 'No embedded XMP/C2PA box found.',
      meaning: 'Almost no in-the-wild clips carry signed provenance; absence is expected and proves nothing.',
      strength: 20,
      method: 'MP4/MOV box walk for XMP and UUID chunks.',
      caveat: 'Cloud C2PA registries are not queried and signatures are not validated.',
    }),
  )

  signals.push(
    signal({
      category: 'metadata',
      label: 'Container / encoder metadata',
      state: container.softwareHints.length ? 'flag' : container.majorBrand ? 'pass' : 'inconclusive',
      applicable: identified,
      executed: identified,
      observed: container.majorBrand
        ? `Brand ${container.majorBrand}; ${container.durationSeconds ?? '?'}s; ${container.tracks.length} track(s).`
        : 'Brand unreadable.',
      meaning: 'Encoder tags reveal the export tool, never the truth of the depicted events.',
      strength: 10,
      method: 'ftyp / mvhd / trak header parse.',
    }),
  )

  signals.push(
    signal({
      category: 'watermark',
      label: 'Editor / platform traces',
      state: container.softwareHints.length ? 'flag' : 'inconclusive',
      applicable: identified,
      executed: identified,
      observed: tools || 'No editor string embedded.',
      meaning: 'Re-encode traces degrade frame provenance; the claims still need external evidence.',
      strength: 10,
      method: 'ASCII scan of the first 256 KB for exporter tags.',
    }),
  )

  signals.push(
    signal({
      category: 'forensics',
      label: 'Frame forensics',
      state: 'inconclusive',
      applicable: false,
      executed: false,
      observed: 'Frame-level manipulation detection is not implemented in this build.',
      meaning: 'Video judgement rests on metadata plus claim evidence, stated explicitly in the report.',
      strength: 25,
      method: 'Not implemented.',
      caveat: 'Never present a clean metadata read as proof of authenticity.',
    }),
  )
  limitations.push('Frame-level video forensics (double-compression, PRNU, deepfake scores) are not implemented in this build.')

  const aiSignal = fuseSignals(signals, limitations, 'video')
  log('info', 'video integrity complete', { kind: container.kind, score: aiSignal.score, type: aiSignal.type })

  const contextText = `Video: ${container.kind.toUpperCase()}. ${tools ? `Tools: ${tools}.` : 'No encoder trace.'} AI-content suspicion ${aiSignal.score}/100 (${aiSignal.type}).`
  return { container, aiSignal, contextText }
}

/** XMP-only entry point used by unit tests and the pipeline orchestrator. */
export function analyzeXmpPacket(bytes: Uint8Array): ReturnType<typeof parseXmpBytes> {
  return parseXmpBytes(bytes)
}
