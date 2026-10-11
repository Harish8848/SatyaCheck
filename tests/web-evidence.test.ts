import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tokenize, planQueries } from '../lib/pipeline/evidence-rank'
import { classifySource } from '../lib/pipeline/sources'

test('sports queries retain the exact numeric margin', () => {
 const claim = { text: 'Nepal wins over Canada by 24 runs in CWC League 2', entities: ['Nepal', 'Canada'], verificationQuestion: 'Did Nepal win by 24 runs?' }
 assert.ok(tokenize(claim.text).includes('24'))
 const queries = planQueries(claim)
 assert.equal(queries.length, 2)
 assert.ok(queries.every(q => q.includes('24')))
})
test('publisher labels cannot impersonate trusted websites or social accounts', () => {
 assert.equal(classifySource({ url: 'https://untrusted.example/post', publisher: 'Reuters' }).tier, 'unverified')
 assert.equal(classifySource({ url: 'https://x.com/random/status/123', publisher: 'BBC' }).tier, 'unverified')
 assert.equal(classifySource({ url: 'https://www.icc-cricket.com/match' }).tier, 'primary')
 assert.equal(classifySource({ url: 'https://icc-cricket.com.evil.example/match' }).tier, 'unverified')
})
