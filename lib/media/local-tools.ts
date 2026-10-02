import { execFile } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
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

/** Extracts up to three representative frames. FFmpeg is optional at runtime. */
export async function extractVideoFrames(bytes: Uint8Array, mime: string): Promise<Uint8Array[]> {
  return withMediaFile(bytes, extForMime(mime), async (file, dir) => {
    const pattern = join(dir, 'frame-%02d.jpg')
    const result = await runOptional('ffmpeg', ['-nostdin', '-v', 'error', '-i', file, '-vf', 'fps=1/10,scale=1280:-1:force_original_aspect_ratio=decrease', '-frames:v', '3', '-q:v', '4', pattern], 30_000)
    // Successful ffmpeg writes frames but has no stdout; check its output files.
    if (result === undefined) {
      // Distinguish an empty successful invocation from a missing binary by reading the output directory.
    }
    const paths = (await readdir(dir)).filter((name) => /^frame-\d+\.jpg$/.test(name)).sort().slice(0, 3)
    return Promise.all(paths.map((name) => readFile(join(dir, name))))
  })
}

/** Uses OpenAI Whisper CLI (`whisper`) when installed. */
export async function transcribeWithWhisper(bytes: Uint8Array, mime: string): Promise<string | undefined> {
  return withMediaFile(bytes, extForMime(mime), async (file, dir) => {
    await runOptional('whisper', [file, '--model', process.env.WHISPER_MODEL || 'tiny', '--output_format', 'txt', '--output_dir', dir], 90_000)
    const output = join(dir, `${file.split('/').pop()!.replace(/\.[^.]+$/, '')}.txt`)
    try { return (await readFile(output, 'utf8')).trim() || undefined } catch { return undefined }
  })
}
