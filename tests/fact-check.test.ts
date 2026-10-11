import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseFactChecks, searchFactChecks } from '../lib/pipeline/fact-check'

test('keeps original ratings, claim, publisher and review date without treating claims as endorsements', () => {
  const [source] = parseFactChecks({ claims: [{ text: 'Example claim', claimReview: [{ url: 'https://example.com/review', textualRating: 'Mostly false', publisher: { name: 'Reviewer' }, reviewDate: '2026-01-02' }] }] })
  assert.match(source.snippet, /Reviewed claim: Example claim/)
  assert.match(source.snippet, /original rating: Mostly false/)
  assert.equal(source.publisher, 'Reviewer')
  assert.equal(source.publishedAt, '2026-01-02T00:00:00.000Z')
  assert.equal(source.evidenceBasis, 'search_snippet')
})
test('empty results remain empty and unsafe review links are rejected', () => {
  assert.deepEqual(parseFactChecks({}), [])
  assert.deepEqual(parseFactChecks({ claims: [{ text: 'Claim', claimReview: [{ url: 'javascript:alert(1)' }] }] }), [])
})
test('cache avoids repeated requests; provider failure stays distinct from no matches', async () => {
  const originalFetch = globalThis.fetch
  const originalKey = process.env.GOOGLE_FACT_CHECK_API_KEY
  process.env.GOOGLE_FACT_CHECK_API_KEY = 'test-key'
  let calls = 0
  try {
    globalThis.fetch = async (url, init) => {
      calls++
      assert.ok(!String(url).includes('test-key'))
      assert.equal((init?.headers as Record<string,string>)['X-Goog-Api-Key'], 'test-key')
      return Response.json({ claims: [] })
    }
    assert.deepEqual(await searchFactChecks('unique cache query'), [])
    await searchFactChecks('unique cache query')
    assert.equal(calls, 1)
    globalThis.fetch = async () => new Response('', { status: 429 })
    await assert.rejects(searchFactChecks('quota failure'), /429/)
    globalThis.fetch = async () => Response.json({ claims: [] })
    assert.deepEqual(await searchFactChecks('quota failure'), [])
  } finally {
    globalThis.fetch = originalFetch
    if (originalKey === undefined) delete process.env.GOOGLE_FACT_CHECK_API_KEY
    else process.env.GOOGLE_FACT_CHECK_API_KEY = originalKey
  }
})
