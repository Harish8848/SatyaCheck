import { boundedRequest } from '@/lib/core/request-body'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { UserFacingError } from '@/lib/core/errors'
import { ModelUnavailableError } from '@/lib/core/model'
import { clientKey, rateLimit } from '@/lib/core/rate-limit'
import { createVerification, listVerifications } from '@/lib/verification'
import { deleteDraft, prepareReview, readDraft } from '@/lib/pipeline/review'
import type { Submission } from '@/lib/pipeline/ingest-run'
import type { Progress } from '@/lib/pipeline/orchestrator'
import { validateUpload } from '@/lib/media/validate-upload'

export const runtime = 'nodejs'
export const maxDuration = 300
const inputSchema = z.object({ inputType: z.enum(['text', 'url', 'image', 'video', 'audio']), inputText: z.string().trim().max(200_000).optional(), sourceName: z.string().max(200).optional(), action: z.enum(['preview', 'assess']).optional() })
function errorMessage(error: unknown) {
  if (error instanceof UserFacingError) return error.message
  if (error instanceof ModelUnavailableError) return error.quotaLimited ? 'Provider quota reached. Please retry after your quota resets.' : 'Setup required: the analysis model is unavailable. Check server API credentials and model configuration.'
  return 'Unable to complete this check. The server or database may be unavailable; try again.'
}
export async function GET() {
  try { return NextResponse.json({ data: await listVerifications() }) }
  catch (error) { return NextResponse.json({ error: errorMessage(error) }, { status: 503 }) }
}

export async function POST(original: Request) {
  const owner = clientKey(original), limit = rateLimit(owner)
  if (!limit.ok) return NextResponse.json({ error: 'Too many requests. Please wait and try again.' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } })
  try {
    const request = await boundedRequest(original)
    let submission: Submission, action: 'preview' | 'assess' | undefined, token: string | undefined
    let prepared: ReturnType<typeof readDraft> | undefined
    if (request.headers.get('content-type')?.includes('multipart/form-data')) {
      const form = await request.formData()
      const fields = inputSchema.parse({ inputType: form.get('inputType'), inputText: form.get('inputText') ?? undefined, action: form.get('action') ?? undefined })
      if (!['image', 'video', 'audio'].includes(fields.inputType)) throw new UserFacingError('Only media inputs accept file uploads.')
      const file = form.get('file')
      if (!(file instanceof File)) throw new UserFacingError('Attach a media file.')
      const media = { bytes: new Uint8Array(await file.arrayBuffer()), mime: file.type }
      validateUpload(fields.inputType as 'image' | 'video' | 'audio', media)
      submission = { ...fields, sourceName: file.name.slice(0, 200), media }; action = fields.action
    } else {
      const body = await request.json()
      if (typeof body?.token === 'string') {
        token = body.token
        prepared = readDraft(body.token, owner, body.claims)
        submission = { inputType: prepared.ingested.inputType, sourceName: prepared.ingested.sourceLabel }
        action = 'assess'
      } else {
        const fields = inputSchema.parse(body)
        if (!fields.inputText) throw new UserFacingError('Provide text, a public URL, or a media upload.')
        submission = fields; action = fields.action
      }
    }
    const run = async (progress?: Progress) => {
      if (action === 'preview') return { review: await prepareReview(submission, owner, progress) }
      const data = await createVerification(submission, progress, prepared)
      if (token && data.status === 'completed') deleteDraft(token)
      return { data }
    }
    if (!original.headers.get('accept')?.includes('application/x-ndjson')) return NextResponse.json(await run(), { status: 201 })
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        let closed = false
        const send = (event: unknown) => { if (!closed) try { controller.enqueue(encoder.encode(JSON.stringify(event) + '\n')) } catch { closed = true } }
        try { send(await run(stage => send({ progress: stage }))) }
        catch (error) { send({ error: errorMessage(error) }) }
        finally { if (!closed) { try { controller.close() } catch { /* Client disconnected. */ } } }
      },
    })
    return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } })
  } catch (error) {
    const message = error instanceof z.ZodError || error instanceof SyntaxError ? 'Invalid input. Check the type, text length, and selected file.' : errorMessage(error)
    return NextResponse.json({ error: message }, { status: error instanceof ModelUnavailableError ? 503 : 422 })
  }
}
