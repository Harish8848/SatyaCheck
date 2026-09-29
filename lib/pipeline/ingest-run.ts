import { z } from 'zod'
import { config } from '../core/config'
import { UserFacingError } from '../core/errors'
import { describeError, log } from '../core/logger'
import { generateStructured } from '../core/model'
import type { InputType, IngestedInput } from '../core/types'
import { blockedUrl, collapseWhitespace } from './ingest'
import { extractPage } from './url-extract'

/**
 * Ingest stage: turn any submission into plain text plus provenance notes.
 * Media is transcribed by the vision model; that transcript is a *reading of
 * the file*, and is labelled as such so it is never mistaken for verified fact.
 */

export type Submission = {
  inputType: InputType
  inputText?: string
  sourceName?: string
  media?: { bytes: Uint8Array; mime: string }
}

const transcriptSchema = z.object({
  visibleText: z.string().max(8000).default(''),
  spokenText: z.string().max(8000).default(''),
  description: z.string().max(1500).default(''),
})

const VISION_SYSTEM = [
  'You transcribe media for a fact-checking pipeline.',
  'Copy any visible text (headlines, captions, overlays, chyrons) and any clearly audible speech verbatim.',
  'Describe only what is literally visible: people, places, objects, actions.',
  'Do NOT identify people from their faces, do NOT guess dates or locations, and do NOT judge whether the content is true or AI-generated.',
  'Leave a field empty when there is nothing to report.',
].join(' ')

async function transcribeMedia(kind: 'image' | 'video', media: { bytes: Uint8Array; mime: string }, notes: string[]): Promise<string> {
  try {
    const { output, model } = await generateStructured({
      label: `${kind}-transcription`,
      schema: transcriptSchema,
      system: VISION_SYSTEM,
      prompt: `Transcribe this ${kind}.`,
      models: [...config.visionModels],
      files: [{ data: media.bytes, mediaType: media.mime }],
    })
    const parts = [
      output.visibleText.trim() && `Text visible in the ${kind}: ${output.visibleText.trim()}`,
      output.spokenText.trim() && `Speech in the ${kind}: ${output.spokenText.trim()}`,
    ].filter(Boolean) as string[]
    if (output.description.trim()) notes.push(`Vision description (${model}): ${output.description.trim()}`)
    if (!parts.length) notes.push(`No readable text or speech was found in the ${kind}.`)
    return parts.join('\n')
  } catch (error) {
    log('warn', 'media transcription unavailable', { kind, error: describeError(error) })
    notes.push(`The ${kind} could not be read by the vision model, so only the accompanying text (if any) was checked.`)
    return ''
  }
}

export async function ingestSubmission(submission: Submission): Promise<IngestedInput> {
  const notes: string[] = []
  const typed = submission.inputText?.trim() ?? ''

  if (submission.inputType === 'text') {
    if (!typed) throw new UserFacingError('Provide the text you want checked.')
    const truncated = typed.length > config.maxContextChars
    if (truncated) notes.push(`Text truncated to ${config.maxContextChars.toLocaleString()} characters.`)
    return { inputType: 'text', text: typed.slice(0, config.maxContextChars), sourceLabel: 'Pasted text', extractedChars: typed.length, truncated, notes }
  }

  if (submission.inputType === 'url') {
    const url = typed
    const blocked = blockedUrl(url)
    if (!url || blocked) throw new UserFacingError(blocked ?? 'Provide the article URL you want checked.')
    let page
    try {
      page = await extractPage(url)
    } catch (error) {
      if (error instanceof UserFacingError) throw error
      throw new UserFacingError(`The page could not be fetched (${describeError(error)}). Paste the article text instead.`)
    }
    if (!page.text) throw new UserFacingError('No readable article text was found at that URL. Paste the text instead.')
    const header = [page.title && `Title: ${page.title}`, page.author && `Author: ${page.author}`, page.publishedAt && `Published: ${page.publishedAt}`].filter(Boolean).join('\n')
    return {
      inputType: 'url', text: [header, page.text].filter(Boolean).join('\n\n'), sourceLabel: page.title ?? page.finalUrl, url: page.finalUrl,
      pageTitle: page.title, pageAuthor: page.author, pagePublishedAt: page.publishedAt, extractedChars: page.extractedChars, truncated: page.truncated, notes: [...notes, ...page.notes],
    }
  }

  const kind = submission.inputType
  const media = submission.media
  const transcript = media ? await transcribeMedia(kind, media, notes) : ''
  const text = collapseWhitespaceKeepingLines([typed && `Caption / claim supplied by the user: ${typed}`, transcript].filter(Boolean).join('\n'))
  if (!media) notes.push(`No ${kind} file was attached; only the supplied text was checked.`)
  return {
    inputType: kind, text, sourceLabel: submission.sourceName || `Uploaded ${kind}`, extractedChars: text.length, truncated: false,
    mediaName: submission.sourceName, mediaBytes: media?.bytes.length, mediaKind: kind, notes,
  }
}

function collapseWhitespaceKeepingLines(text: string): string {
  return text.split('\n').map(collapseWhitespace).filter(Boolean).join('\n')
}
