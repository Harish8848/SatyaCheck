import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertPublicUrl, isPrivateAddress } from '../lib/core/net-guard'
import { validateUpload } from '../lib/media/validate-upload'
import { boundedRequest } from '../lib/core/request-body'
import { readEvents } from '../lib/core/read-events'
import { readDraft, saveDraft, deleteDraft } from '../lib/pipeline/review'
import { describeError } from '../lib/core/logger'
import { ingestSubmission } from '../lib/pipeline/ingest-run'

test('unsafe URLs and IPv4/IPv6 internal or transition addresses fail before network access', async () => {
 for (const ip of ['127.0.0.1', '10.0.0.2', '169.254.169.254', '172.16.2.1', '192.168.1.1', '100.64.0.1', '::1', '::ffff:7f00:1', 'fc00::1', 'fe80::1', '2002:7f00:1::', '64:ff9b::7f00:1']) assert.equal(isPrivateAddress(ip), true, ip)
 for (const url of ['http://127.1/', 'http://2130706433/', 'http://[::1]/', 'file:///etc/passwd', 'https://user:secret@example.com/', 'https://example.com:8080/']) await assert.rejects(assertPublicUrl(url))
 assert.equal(isPrivateAddress('8.8.8.8'), false)
})
test('inaccessible link produces a useful paste-text failure and no assessment', async () => {
 await assert.rejects(ingestSubmission({ inputType: 'url', inputText: 'http://169.254.169.254/latest/meta-data/' }), /internal addresses/)
})
test('media signature validation rejects disguised executables and empty files', () => {
 assert.throws(() => validateUpload('image', { bytes: Buffer.from('<script>fetch secrets</script>'), mime: 'image/png' }))
 assert.throws(() => validateUpload('video', { bytes: new Uint8Array(), mime: 'video/mp4' }))
 assert.throws(() => validateUpload('image', { bytes: Buffer.from('<svg/>'), mime: 'image/svg+xml' }))
 assert.doesNotThrow(() => validateUpload('image', { bytes: Buffer.from([137,80,78,71,13,10,26,10]), mime: 'image/png' }))
})
test('body guard bounds chunked payloads before JSON or multipart parsing', async () => {
 const request = new Request('http://localhost/api/verifications', { method: 'POST', body: 'x'.repeat(1_000_001), headers: { 'Content-Type': 'application/json' } })
 await assert.rejects(boundedRequest(request), /size limit/)
 const small = await boundedRequest(new Request('http://localhost/', { method: 'POST', body: '{"x":1}' }))
 assert.deepEqual(await small.json(), { x: 1 })
})
test('OCR uncertainty and sampling notes survive reviewed edits; foreign drafts and invalid claims are rejected', () => {
 const token = saveDraft({ ingested: { inputType: 'image', text: 'OCR: 100 or 700?', sourceLabel: 'image', extractedChars: 16, truncated: false, reviewRequired: true, notes: ['OCR uncertainty: first digit unclear.'] }, claims: [] }, 'owner')
 const reviewed = readDraft(token, 'owner', [{ text: 'There were 700 attendees.', claimType: 'factual' }])
 assert.equal(reviewed.claims[0].text, 'There were 700 attendees.')
 assert.match(reviewed.ingested.notes.join(' '), /OCR uncertainty/)
 assert.throws(() => readDraft(token, 'someone-else', []), /expired/)
 assert.throws(() => readDraft(token, 'owner', [{ text: 'x', claimType: 'factual' }]), /Review up to/)
 deleteDraft(token); assert.throws(() => readDraft(token, 'owner', []), /expired/)
})
test('progress parser handles split UTF-8 chunks and refuses incomplete results', async () => {
 const bytes = new TextEncoder().encode('{"progress":{"stage":"ingest","detail":"é"}}\n{"review":{"token":"abc"}}\n')
 const seen: Record<string, unknown>[] = []
 await readEvents(new Response(new ReadableStream({ start(c) { for (const b of bytes) c.enqueue(new Uint8Array([b])); c.close() } }), { headers: { 'Content-Type': 'application/x-ndjson' } }), event => seen.push(event))
 assert.equal(seen.length, 2); assert.equal((seen[0].progress as { detail: string }).detail, 'é')
 await assert.rejects(readEvents(new Response('{"progress":{}}\n', { headers: { 'Content-Type': 'application/x-ndjson' } }), () => {}), /connection ended/)
})
test('provider failures do not leak uploaded text or credentials through logs', () => {
 assert.equal(describeError(new Error('secret API key plus entire uploaded transcript')), 'Error')
})
