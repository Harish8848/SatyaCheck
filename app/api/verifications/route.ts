import { NextResponse } from 'next/server'
import { config } from '@/lib/core/config'
import { UserFacingError } from '@/lib/core/errors'
import { clientKey, rateLimit } from '@/lib/core/rate-limit'
import { createVerification, inputTypes, listVerifications, type InputType } from '@/lib/verification'

export const runtime = 'nodejs'
/** The pipeline makes several model and network calls; allow it time on hosts that honour this. */
export const maxDuration = 120

const MAX_TEXT_CHARS = 200_000

function failure(error: unknown) {
  if (error instanceof UserFacingError) return NextResponse.json({ error: error.message }, { status: 422 })
  console.error('Failed to create verification:', error)
  return NextResponse.json({ error: 'Unable to save verification.' }, { status: 500 })
}

function isInputType(value: unknown): value is InputType {
  return typeof value === 'string' && inputTypes.includes(value as InputType)
}

export async function GET() {
  try {
    return NextResponse.json({ data: await listVerifications() })
  } catch (error) {
    console.error('Failed to list verifications:', error)
    return NextResponse.json({ error: 'Unable to load verification history.' }, { status: 500 })
  }
}

const mediaMimePrefix: Record<'image' | 'video' | 'audio', string> = { image: 'image/', video: 'video/', audio: 'audio/' }

/** Handles multipart uploads: fields inputType / inputText plus a `file` part. Size is enforced before any parsing. */
async function handleMultipart(request: Request) {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Request body must be valid multipart form data.' }, { status: 400 })
  }

  const inputType = form.get('inputType')
  if (inputType !== 'image' && inputType !== 'video' && inputType !== 'audio') {
    return NextResponse.json({ error: 'File uploads are only supported for image, video, or audio input.' }, { status: 400 })
  }
  const file = form.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: `Attach the ${inputType} file to check.` }, { status: 400 })
  }
  if (!file.type.startsWith(mediaMimePrefix[inputType])) {
    return NextResponse.json({ error: `The attached file is not a ${inputType}.` }, { status: 415 })
  }
  const ceiling = inputType === 'video' || inputType === 'audio' ? config.maxVideoBytes : config.maxImageBytes
  if (file.size > ceiling) {
    return NextResponse.json({ error: `The ${inputType} is ${(file.size / 1_048_576).toFixed(1)} MB; the limit is ${(ceiling / 1_048_576).toFixed(0)} MB.` }, { status: 413 })
  }
  const rawText = form.get('inputText')
  if (rawText !== null && typeof rawText !== 'string') {
    return NextResponse.json({ error: 'inputText must be a string.' }, { status: 400 })
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const verification = await createVerification({
      inputType,
      inputText: rawText?.trim() || undefined,
      sourceName: file.name.slice(0, 200),
      media: { bytes, mime: file.type },
    })
    return NextResponse.json({ data: verification }, { status: 201 })
  } catch (error) {
    return failure(error)
  }
}

export async function POST(request: Request) {
  const limit = rateLimit(clientKey(request))
  if (!limit.ok) {
    return NextResponse.json({ error: 'Too many verification requests. Please wait and try again.' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } })
  }
  if (request.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data')) {
    return handleMultipart(request)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 })
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Request body must be an object.' }, { status: 400 })
  }

  const payload = body as Record<string, unknown>
  const inputType = payload.inputType
  const inputText = payload.inputText
  const sourceName = payload.sourceName

  if (!isInputType(inputType)) {
    return NextResponse.json({ error: 'inputType must be text, image, video, audio, or url.' }, { status: 400 })
  }
  if (inputText !== undefined && typeof inputText !== 'string') {
    return NextResponse.json({ error: 'inputText must be a string.' }, { status: 400 })
  }
  if (sourceName !== undefined && typeof sourceName !== 'string') {
    return NextResponse.json({ error: 'sourceName must be a string.' }, { status: 400 })
  }
  if ((inputType === 'image' || inputType === 'video' || inputType === 'audio') && !inputText?.trim()) {
    return NextResponse.json({ error: `Upload the ${inputType} file as multipart form data, or describe it in inputText.` }, { status: 400 })
  }
  if (!inputText?.trim()) {
    return NextResponse.json({ error: 'Provide inputText.' }, { status: 400 })
  }
  if (inputText.length > MAX_TEXT_CHARS) {
    return NextResponse.json({ error: `inputText is limited to ${MAX_TEXT_CHARS.toLocaleString()} characters.` }, { status: 413 })
  }

  try {
    const verification = await createVerification({
      inputType,
      inputText: inputText.trim(),
      sourceName: sourceName?.trim().slice(0, 200),
    })
    return NextResponse.json({ data: verification }, { status: 201 })
  } catch (error) {
    return failure(error)
  }
}
