import { fingerprintTables } from './containers'

/**
 * Deterministic JPEG pixel-forensics on decoded luminance data.
 *
 * Decoded pixels arrive from `jpeg-js` in the pipeline (never in this file),
 * which keeps this module dependency-free and unit-testable. All three
 * analyses are presented with honest, conservative thresholds — a flag here
 * is *evidence for human review*, never proof of manipulation.
 */

export type BlockGrid = { width: number; height: number; luminance: Uint8Array }

export type DqtAnomaly = { table: number; verdict: 'standard' | 'custom' | 'unknown'; note: string }

export type ElaResult = {
  meanError: number
  p95Error: number
  /** Fraction of 8x8 blocks whose error exceeds the adaptive threshold. */
  hotBlockFraction: number
  suspicious: boolean
  notes: string[]
}

export type NoiseResult = { blockVariances: number[]; outlierFraction: number; suspicious: boolean; notes: string[] }

export type JpegForensics = {
  dqt: DqtAnomaly[]
  customQuantization: boolean
  ela: ElaResult
  noise: NoiseResult
  /** 0..1 conservative manipulation likelihood from deterministic cues only. */
  manipulationScore: number
  findings: string[]
  warnings: string[]
}

/** Stock IJG / Photoshop / social-platform luminance tables (first row + hash). */
const KNOWN_TABLES: { name: string; head: number[] }[] = [
  { name: 'IJG quality ~75', head: [8, 6, 5, 8, 12, 20, 26, 31] },
  { name: 'IJG quality ~85', head: [5, 4, 4, 6, 8, 12, 16, 20] },
  { name: 'IJG quality ~90', head: [3, 2, 2, 3, 5, 8, 10, 12] },
  { name: 'Photoshop save-for-web', head: [4, 4, 4, 5, 7, 11, 14, 17] },
]

function tableVerdict(values: number[]): DqtAnomaly {
  const head = values.slice(0, 8)
  for (const known of KNOWN_TABLES) {
    const close = head.every((v, i) => Math.abs(v - known.head[i]) <= 2)
    if (close) return { table: 0, verdict: 'standard', note: `Matches ${known.name} family.` }
  }
  const flat = values.every((v) => v >= 1 && v <= 3)
  if (flat) return { table: 0, verdict: 'standard', note: 'Near-lossless flat table (quality ~100 export).' }
  const allOnes = values.every((v) => v === 1)
  if (allOnes) return { table: 0, verdict: 'custom', note: 'All-ones table — lossless-ish re-encode or synthetic source.' }
  return { table: 0, verdict: 'custom', note: 'Non-standard quantization — re-save, platform transcode, or editor export.' }
}

export function analyzeDqt(tables: { index: number; values: number[] }[]): { anomalies: DqtAnomaly[]; custom: boolean; fingerprint: string } {
  if (!tables.length) return { anomalies: [], custom: false, fingerprint: 'none' }
  const anomalies = tables.map((t) => ({ ...tableVerdict(t.values), table: t.index }))
  const custom = anomalies.some((a) => a.verdict === 'custom')
  return { anomalies, custom, fingerprint: fingerprintTables(tables.map((t) => ({ index: t.index, precision: 8 as const, values: t.values }))) }
}


function blockMean(data: Uint8Array, width: number, bx: number, by: number): number {
  let sum = 0
  let count = 0
  for (let y = by * 8; y < Math.min((by + 1) * 8, data.length / width); y += 1) {
    for (let x = bx * 8; x < Math.min((bx + 1) * 8, width); x += 1) {
      sum += data[y * width + x]
      count += 1
    }
  }
  return count ? sum / count : 0
}

/**
 * Simplified error-level analysis: re-quantize each 8x8 block mean to a
 * coarse step and treat deviation as "error". True ELA needs a re-encode;
 * this deterministic proxy flags regions that compress differently from the
 * global baseline without any ML.
 */
export function analyzeEla(grid: BlockGrid): ElaResult {
  const notes: string[] = []
  const { width, height, luminance } = grid
  if (!width || !height || luminance.length < width * height) {
    return { meanError: 0, p95Error: 0, hotBlockFraction: 0, suspicious: false, notes: ['ELA skipped: degenerate grid.'] }
  }
  const blocksX = Math.floor(width / 8)
  const blocksY = Math.floor(height / 8)
  if (blocksX < 2 || blocksY < 2) {
    return { meanError: 0, p95Error: 0, hotBlockFraction: 0, suspicious: false, notes: ['ELA skipped: image smaller than 16x16.'] }
  }
  const errors: number[] = []
  for (let by = 0; by < blocksY; by += 1) {
    for (let bx = 0; bx < blocksX; bx += 1) {
      const mean = blockMean(luminance, width, bx, by)
      const quantized = Math.round(mean / 8) * 8
      errors.push(Math.abs(mean - quantized))
    }
  }
  errors.sort((a, b) => a - b)
  const meanError = errors.reduce((s, v) => s + v, 0) / errors.length
  const p95Error = errors[Math.floor(errors.length * 0.95)] ?? 0
  const threshold = Math.max(1.5, meanError * 2.5)
  const hot = errors.filter((e) => e > threshold).length
  const hotBlockFraction = errors.length ? hot / errors.length : 0
  // Conservative: only flag when BOTH the tail is hot and a meaningful share
  // of blocks deviate — avoids crying wolf on textured photos.
  const suspicious = p95Error > 3 && hotBlockFraction > 0.08
  if (suspicious) notes.push(`${(hotBlockFraction * 100).toFixed(1)}% of blocks exceed the adaptive error threshold — review region map.`)
  else notes.push('Block error distribution consistent with single compression pass.')
  return { meanError, p95Error, hotBlockFraction, suspicious, notes }
}

/** Per-block variance outlier scan — pasted regions often differ in noise. */
export function analyzeNoise(grid: BlockGrid): NoiseResult {
  const notes: string[] = []
  const { width, height, luminance } = grid
  const blocksX = Math.floor(width / 8)
  const blocksY = Math.floor(height / 8)
  if (!width || !height || blocksX < 2 || blocksY < 2 || luminance.length < width * height) {
    return { blockVariances: [], outlierFraction: 0, suspicious: false, notes: ['Noise scan skipped: grid too small.'] }
  }
  const variances: number[] = []
  for (let by = 0; by < blocksY; by += 1) {
    for (let bx = 0; bx < blocksX; bx += 1) {
      const mean = blockMean(luminance, width, bx, by)
      let sumSq = 0
      let count = 0
      for (let y = by * 8; y < Math.min((by + 1) * 8, height); y += 1) {
        for (let x = bx * 8; x < Math.min((bx + 1) * 8, width); x += 1) {
          const d = luminance[y * width + x] - mean
          sumSq += d * d
          count += 1
        }
      }
      variances.push(count ? sumSq / count : 0)
    }
  }
  const sorted = [...variances].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0
  const mad = (sorted.map((v) => Math.abs(v - median)).sort((a, b) => a - b)[Math.floor(sorted.length / 2)] ?? 0) || 1
  const outliers = variances.filter((v) => Math.abs(v - median) > Math.max(6 * mad, 40)).length
  const outlierFraction = variances.length ? outliers / variances.length : 0
  const suspicious = outlierFraction > 0.12 && median > 1
  if (suspicious) notes.push(`${(outlierFraction * 100).toFixed(1)}% of blocks deviate from the global noise baseline — possible composite.`)
  else notes.push('Noise field broadly uniform across blocks.')
  return { blockVariances: variances.slice(0, 4096), outlierFraction, suspicious, notes }
}

export function analyzeJpeg(grid: BlockGrid | undefined, tables: { index: number; values: number[] }[]): JpegForensics {
  const warnings: string[] = []
  const findings: string[] = []
  const dqt = analyzeDqt(tables)
  if (dqt.custom) findings.push('Custom quantization tables — image was re-encoded after capture (editor, platform, or composite workflow).')
  else if (tables.length) findings.push('Quantization tables match a standard encoder family.')
  else warnings.push('No DQT segments found; quantization analysis unavailable.')

  const ela: ElaResult = grid
    ? analyzeEla(grid)
    : { meanError: 0, p95Error: 0, hotBlockFraction: 0, suspicious: false, notes: ['ELA skipped: decode unavailable.'] }
  const noise: NoiseResult = grid
    ? analyzeNoise(grid)
    : { blockVariances: [], outlierFraction: 0, suspicious: false, notes: ['Noise scan skipped: decode unavailable.'] }
  if (!grid) warnings.push('Pixel decode unavailable; ELA/noise proxies skipped.')
  if (ela.suspicious) findings.push('ELA proxy: localized compression-error hotspots differ from the global baseline.')
  if (noise.suspicious) findings.push('Noise proxy: block-variance outliers suggest regions with different sensor/processing history.')

  // Weighted, capped, and honest: deterministic cues only, no ML claims.
  let score = 0
  if (dqt.custom) score += 0.15
  if (ela.suspicious) score += 0.35
  if (noise.suspicious) score += 0.35
  if (ela.suspicious && noise.suspicious) score += 0.1
  const manipulationScore = Math.min(0.95, Math.round(score * 100) / 100)

  return { dqt: dqt.anomalies, customQuantization: dqt.custom, ela, noise, manipulationScore, findings, warnings }
}
