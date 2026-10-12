import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGdeltSearch, retryAfterMs } from '../lib/pipeline/gdelt'
import { searchAll } from '../lib/pipeline/research'

const article = { title: 'Public news report', url: 'https://example.com/report', domain: 'example.com', seendate: '20261012T040000Z' }

test('simultaneous GDELT queries are serialized with a gap after a slow response', async () => {
  let now = 0, active = 0
  const starts: number[] = []
  const search = createGdeltSearch({ now: () => now, wait: async ms => { now += ms }, fetch: async () => {
    assert.equal(active++, 0)
    starts.push(now)
    await Promise.resolve()
    now += 12_000
    active--
    return Response.json({ articles: [article] })
  } })
  const results = await Promise.all([search('Nepal'), search('Canada')])
  assert.deepEqual(starts, [0, 17_500])
  assert.ok(results.every(result => result.length === 1))
})

test('identical in-flight queries coalesce and cache preserves retrieval time until expiry', async () => {
  let now = 0, calls = 0
  const search = createGdeltSearch({ now: () => now, wait: async ms => { now += ms }, fetch: async () => {
    calls++; return Response.json({ articles: [article] })
  } })
  const [a, b] = await Promise.all([search('Nepal news'), search(' Nepal   news ')])
  assert.equal(calls, 1)
  a[0].title = 'Client mutation'
  assert.equal(b[0].title, article.title)
  now = 120_000
  assert.equal((await search('Nepal news'))[0].retrievedAt, b[0].retrievedAt)
  assert.equal(calls, 1)
  now = 300_001
  assert.notEqual((await search('Nepal news'))[0].retrievedAt, b[0].retrievedAt)
  assert.equal(calls, 2)
})

test('429 honors Retry-After, cancels queued lookups and recovers without caching failure', async () => {
  let now = 0, calls = 0
  const search = createGdeltSearch({ now: () => now, wait: async ms => { now += ms }, fetch: async () => {
    calls++
    return calls === 1 ? new Response('Rate limited', { status: 429, headers: { 'Retry-After': '120' } }) : Response.json({ articles: [] })
  } })
  const results = await Promise.allSettled([search('first'), search('second')])
  assert.ok(results.every(result => result.status === 'rejected'))
  assert.equal(calls, 1)
  now = 119_999
  await assert.rejects(search('first'), /Temporarily paused/)
  assert.equal(calls, 1)
  now = 120_000
  assert.deepEqual(await search('first'), [])
  assert.equal(calls, 2)
})

test('Retry-After supports HTTP dates and rejects invalid or past values', () => {
  const now = Date.parse('2026-10-12T00:00:00Z')
  assert.equal(retryAfterMs('Mon, 12 Oct 2026 00:02:00 GMT', now), 120_000)
  assert.equal(retryAfterMs('10', now), 10_000)
  assert.equal(retryAfterMs('bad', now), 0)
  assert.equal(retryAfterMs('Mon, 12 Oct 2026 00:00:00 GMT', now + 1000), 0)
})

test('plain-text quota responses trigger cooldown; invalid responses never become empty evidence', async () => {
  for (const response of [new Response('Please limit requests to one every 5 seconds'), new Response('Your query was too short'), Response.json({ error: 'Invalid query' })]) {
    let calls = 0
    const search = createGdeltSearch({ now: () => 0, fetch: async () => { calls++; return response } })
    await assert.rejects(search('Nepal'))
    await assert.rejects(search('Canada'), /Temporarily paused/)
    assert.equal(calls, 1)
  }
})

test('a hanging active request cannot create an unbounded GDELT queue', async () => {
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  const search = createGdeltSearch({ fetch: async () => { await pending; return new Response('', { status: 429 }) } })
  const first = search('first'), second = search('second')
  await assert.rejects(search('third'), /queue is busy/)
  release()
  await Promise.allSettled([first, second])
})

test('timeouts and server errors do not launch immediate retries', async () => {
  for (const failure of ['timeout', 'server']) {
    let calls = 0
    const search = createGdeltSearch({ fetch: async () => {
      calls++
      if (failure === 'timeout') throw new DOMException('Timed out', 'TimeoutError')
      return new Response('', { status: 503 })
    } })
    await assert.rejects(search('one'))
    await assert.rejects(search('two'), /Temporarily paused/)
    assert.equal(calls, 1)
  }
})

test('other research providers remain usable while the disabled GDELT adapter is isolated', async () => {
  const original = globalThis.fetch
  let gdeltCalls = 0
  globalThis.fetch = async url => {
    const target = String(url)
    if (target.includes('api.gdeltproject.org')) { gdeltCalls++; return new Response('', { status: 429 }) }
    if (target.includes('news.google.com')) return new Response('<rss><channel><item><title>Independent news report - Example News</title><link>https://example.com/news</link></item></channel></rss>')
    if (target.includes('wikipedia.org')) return Response.json({ query: { search: [] } })
    if (target.includes('crossref.org')) return Response.json({ message: { items: [] } })
    if (target.includes('factchecktools.googleapis.com')) return Response.json({ claims: [] })
    throw new Error('Unexpected provider')
  }
  try {
    const result = await searchAll('gdelt outage fixture')
    assert.ok(result.sources.some(s => s.provider === 'Google News'))
    assert.equal(result.failures.some(f => /GDELT/.test(f)), false)
    const later = await searchAll('gdelt cooldown fixture')
    assert.ok(later.sources.some(s => s.provider === 'Google News'))
    assert.equal(later.failures.some(f => /GDELT/.test(f)), false)
    assert.equal(gdeltCalls, 0)
  } finally { globalThis.fetch = original }
})
