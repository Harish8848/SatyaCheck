import { UserFacingError } from '../core/errors'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

async function withMediaFile<T>(bytes: Uint8Array, extension: string, run: (file: string, dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'satyacheck-'))
  const file = join(dir, `input.${extension}`)
  try {
    await writeFile(file, bytes)
    return await run(file, dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function extForMime(mime: string): string {
  return ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/tiff': 'tif', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg' } as Record<string, string>)[mime] || 'bin'
}

/** Returns undefined when the optional local binary is not installed or fails. */
async function runOptional(command: string, args: string[], timeout = 20_000): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(command, args, { timeout, maxBuffer: 2 * 1024 * 1024, windowsHide: true })
    return stdout.trim() || undefined
  } catch {
    return undefined
  }
}

export async function extractWithTesseract(bytes: Uint8Array, mime: string): Promise<string | undefined> {
  return withMediaFile(bytes, extForMime(mime), async (file) => runOptional('tesseract', [file, 'stdout', '--psm', '6'], 15_000))
}

export async function readExifTool(bytes: Uint8Array, mime: string): Promise<string | undefined> {
  return withMediaFile(bytes, extForMime(mime), async (file) => runOptional('exiftool', ['-json', '-G1', '-s', '-FileType', '-ImageWidth', '-ImageHeight', '-Make', '-Model', '-Software', '-DateTimeOriginal', '-CreateDate', '-ModifyDate', '-ColorSpace', file], 10_000))
}

export async function probeDuration(bytes: Uint8Array, mime: string): Promise<number> {
  return withMediaFile(bytes, extForMime(mime), async file => {
    const result = await runOptional('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file], 10_000)
    const duration = Number(result)
    if (!Number.isFinite(duration) || duration <= 0) throw new UserFacingError('Media duration could not be validated. Server setup requires FFmpeg/ffprobe; use pasted transcript instead.')
    if (duration > 120) throw new UserFacingError('Video and audio are limited to 120 seconds. Upload a shorter excerpt and disclose its context.')
    return duration
  })
}

export type SampledFrame = { bytes: Uint8Array; timestamp: number }
export async function extractVideoFrames(bytes: Uint8Array, mime: string, duration?: number): Promise<SampledFrame[]> {
  return withMediaFile(bytes, extForMime(mime), async (file, dir) => {
    const length = duration ?? await probeDuration(bytes, mime)
    const timestamps = [0, length / 2, length * .9]
    const frames: SampledFrame[] = []
    for (const [i, timestamp] of timestamps.entries()) {
      const output = join(dir, `frame-${i}.jpg`)
      await runOptional('ffmpeg', ['-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-ss', String(timestamp), '-i', file, '-vf', 'scale=1280:-1:force_original_aspect_ratio=decrease', '-frames:v', '1', '-q:v', '4', output], 15_000)
      try { frames.push({ bytes: await readFile(output), timestamp }) } catch { /* Disclosed by caller. */ }
    }
    return frames
  })
}

/** Uses OpenAI Whisper CLI (`whisper`) when installed. */
export async function transcribeWithWhisper(bytes: Uint8Array, mime: string): Promise<string | undefined> {
  return withMediaFile(bytes, extForMime(mime), async (file, dir) => {
    await runOptional('whisper', [file, '--model', process.env.WHISPER_MODEL || 'tiny', '--output_format', 'srt', '--output_dir', dir], 90_000)
    const output = join(dir, `${file.split('/').pop()!.replace(/\.[^.]+$/, '')}.srt`)
    try { return (await readFile(output, 'utf8')).trim() || undefined } catch { return undefined }
  })
}
