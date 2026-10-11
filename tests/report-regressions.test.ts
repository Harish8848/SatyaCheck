import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyzeVideo } from '../lib/pipeline/media-integrity'
import { claimResults } from '../lib/core/claim-results'

function video(hint = '') {
 const bytes = Buffer.alloc(64 + hint.length)
 bytes.writeUInt32BE(24, 0); bytes.write('ftyp', 4); bytes.write('isom', 8)
 bytes.write('isom', 16); bytes.write('mp42', 20)
 bytes.writeUInt32BE(bytes.length - 24, 24); bytes.write('free', 28)
 bytes.write(hint, 32)
 return bytes
}
test('ordinary MP4 metadata and exporter strings never imply AI generation', async () => {
 for (const hint of ['', 'Lavf CapCut']) {
  const result = await analyzeVideo(video(hint))
  assert.equal(result.aiSignal.type, 'indeterminate')
  assert.equal(result.aiSignal.score, 0)
  assert.ok(result.aiSignal.signals.every(s => s.state !== 'flag' && s.contribution === 0))
  assert.ok(!result.container.softwareHints.some(s => s.startsWith('brand ')))
 }
})
test('unreadable video cannot appear authentic', async () => {
 const result = await analyzeVideo(new Uint8Array(8))
 assert.equal(result.aiSignal.type, 'indeterminate')
 assert.equal(result.aiSignal.coverage, 0)
})
test('support for sentencing does not verify separate courtroom remarks', () => {
 const result = claimResults([
  { id: 'sentence', text: 'The person received a life sentence.', claimType: 'factual' },
  { id: 'remarks', text: 'The person denied guilt in court.', claimType: 'factual' },
 ], [{ claimId: 'sentence', relation: 'supports', relevanceKind: 'direct', evidenceBasis: 'search_snippet', publisher: 'Example News' }])
 assert.equal(result[0].label, 'Reported support — snippets only')
 assert.match(result[0].detail, /Full article text was not checked/)
 assert.equal(result[1].unresolved, true)
})
