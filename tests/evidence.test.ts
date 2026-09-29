import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isPrivateAddress } from '../lib/core/net-guard'
import { rateLimit } from '../lib/core/rate-limit'
import { classifySource } from '../lib/pipeline/sources'
import { planQueries, recencyScore, relevanceScore, verifyQuote } from '../lib/pipeline/evidence-rank'
import type { ExtractedClaim } from '../lib/core/types'

const claim = (over: Partial<ExtractedClaim> = {}): ExtractedClaim => ({
  id: 'c1', text: 'The ministry announced a permanent four-day academic week', claimType: 'factual',
  entities: ['Ministry of Education'], verificationQuestion: 'Did the ministry announce a four-day week?', ...over,
})

test('isPrivateAddress blocks loopback, private, link-local and metadata ranges', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
    assert.equal(isPrivateAddress(ip), true, ip)
  }
})

test('isPrivateAddress allows public addresses and rejects non-IP input', () => {
  assert.equal(isPrivateAddress('8.8.8.8'), false)
  assert.equal(isPrivateAddress('172.32.0.1'), false)
  assert.equal(isPrivateAddress('2606:4700:4700::1111'), false)
  assert.equal(isPrivateAddress('not-an-ip'), true)
})

test('classifySource tiers government, newsroom, reference and unknown domains', () => {
  assert.equal(classifySource({ url: 'https://www.who.int/news' }).tier, 'primary')
  assert.equal(classifySource({ url: 'https://data.gov.uk/x' }).tier, 'primary')
  assert.equal(classifySource({ url: 'https://www.bbc.co.uk/news/1' }).tier, 'reputable')
  assert.equal(classifySource({ url: 'https://en.wikipedia.org/wiki/X' }).tier, 'reference')
  assert.equal(classifySource({ url: 'https://randomblog.example/post' }).tier, 'unverified')
})

test('classifySource does not trust look-alike domains', () => {
  assert.equal(classifySource({ url: 'https://reuters.com.evil.example/a' }).tier, 'unverified')
  assert.equal(classifySource({ url: 'https://notgov.example/a' }).tier, 'unverified')
})

test('classifySource uses the publisher for Google News links but never trusts the aggregator itself', () => {
  assert.equal(classifySource({ url: 'https://news.google.com/rss/articles/abc', publisher: 'Reuters' }).tier, 'reputable')
  assert.equal(classifySource({ url: 'https://news.google.com/rss/articles/abc', publisher: 'Some Blog' }).tier, 'unverified')
})

test('relevanceScore rewards overlap and is zero for unrelated text', () => {
  const related = relevanceScore(claim(), { title: 'Ministry announces four-day academic week', snippet: 'permanent change to the academic week' })
  const unrelated = relevanceScore(claim(), { title: 'Football results', snippet: 'weekend league scores' })
  assert.ok(related > 50, `related=${related}`)
  assert.equal(unrelated, 0)
})

test('planQueries returns distinct, non-empty queries within the configured limit', () => {
  const queries = planQueries(claim())
  assert.ok(queries.length >= 1 && queries.length <= 2)
  assert.equal(new Set(queries.map((q) => q.toLowerCase())).size, queries.length)
})

test('verifyQuote accepts verbatim spans only', () => {
  const source = 'Officials said the schedule   remains unchanged this term.'
  assert.equal(verifyQuote('the schedule remains unchanged', source), true)
  assert.equal(verifyQuote('schedule will change next term', source), false)
  assert.equal(verifyQuote(undefined, source), false)
  assert.equal(verifyQuote('short', 'short text'), false)
})

test('recencyScore decays with age and is undefined for bad dates', () => {
  const now = Date.parse('2026-01-01T00:00:00Z')
  assert.equal(recencyScore('2026-01-01T00:00:00Z', now), 100)
  assert.equal(recencyScore('2024-01-01T00:00:00Z', now), 0)
  assert.equal(recencyScore('garbage', now), undefined)
  assert.equal(recencyScore(undefined, now), undefined)
})

test('rateLimit allows the configured budget then blocks with a retry hint', () => {
  const key = `test-${Math.random()}`
  const now = Date.now()
  for (let i = 0; i < 20; i += 1) assert.equal(rateLimit(key, now).ok, true)
  const blocked = rateLimit(key, now)
  assert.equal(blocked.ok, false)
  assert.ok(blocked.retryAfterSeconds > 0)
  assert.equal(rateLimit(key, now + 61_000).ok, true)
})
