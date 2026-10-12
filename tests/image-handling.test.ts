import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { z } from 'zod'
import { prepareImage } from '../lib/media/prepare-image'
import { ingestSubmission } from '../lib/pipeline/ingest-run'
import { generateStructured, ModelUnavailableError } from '../lib/core/model'

const require = createRequire(import.meta.url)
const sharp = createRequire(require.resolve('next/package.json'))('sharp')
test('large images are reduced proportionally and small images stay untouched', async () => {
 const bytes = await sharp({ create: { width: 3200, height: 1600, channels: 3, background: 'white' } }).png().toBuffer()
 const prepared = await prepareImage({ bytes, mime: 'image/png' })
 const metadata = await sharp(prepared.bytes).metadata()
 assert.equal(metadata.width, 2400)
 assert.equal(metadata.height, 1200)
 assert.equal((await sharp(bytes).metadata()).width, 3200)
 const small = await sharp({create:{width:200,height:100,channels:3,background:'white'}}).png().toBuffer()
 assert.equal((await prepareImage({bytes:small,mime:'image/png'})).bytes, small)
})
test('image without readable text or caption is rejected, supplied caption is retained', async () => {
 await assert.rejects(ingestSubmission({inputType:'image'}), /Image could not be read/)
 const result = await ingestSubmission({inputType:'image',inputText:'A caption to check'})
 assert.match(result.text, /A caption to check/)
})
test('image attempt budget prevents a second provider request after timeout', async () => {
 const previousFetch = globalThis.fetch
 const previousKey = process.env.GEMINI_API_KEY
 const previousGoogleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY
 process.env.GEMINI_API_KEY='test-key'
 delete process.env.GOOGLE_GENERATIVE_AI_API_KEY
 let calls = 0
 globalThis.fetch = async () => { calls++; throw new DOMException('Timed out', 'TimeoutError') }
 try {
  await assert.rejects(generateStructured({label:'image-transcription',schema:z.object({text:z.string()}),system:'Transcribe',prompt:'Test',models:['gemini','gemini'],maxTotalAttempts:1}), ModelUnavailableError)
  assert.equal(calls,1)
 } finally {
  globalThis.fetch=previousFetch
  if(previousKey === undefined) delete process.env.GEMINI_API_KEY
  else process.env.GEMINI_API_KEY=previousKey
  if(previousGoogleKey === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY
  else process.env.GOOGLE_GENERATIVE_AI_API_KEY=previousGoogleKey
 }
})
