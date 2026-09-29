import assert from 'node:assert/strict'
import { test } from 'node:test'
import { capConfidence, computeStats, nonFactualVerdict, reconcileVerdict, verdictFromStats } from '../lib/pipeline/assessment-stats'
import type { EvidenceItem, ExtractedClaim } from '../lib/core/types'

const item = (over: Partial<EvidenceItem> = {}): EvidenceItem => ({
  id: 'e1', claimId: 'c1', title: 't', url: 'https://reuters.com/a', domain: 'reuters.com', publisher: 'Reuters', tier: 'reputable',
  relation: 'supports', snippet: 's', relevance: 80, authority: 85, provider: 'GDELT', ...over,
})

const gov = (over: Partial<EvidenceItem> = {}) => item({ id: 'e3', domain: 'who.int', tier: 'primary', authority: 95, ...over })
const bbc = (over: Partial<EvidenceItem> = {}) => item({ id: 'e2', domain: 'bbc.com', ...over })
const cl = (claimType: ExtractedClaim['claimType']): ExtractedClaim => ({ id: 'c', text: 'some statement text', claimType, entities: [], verificationQuestion: 'question?' })

test('computeStats: context-only evidence has zero strength and score', () => {
  const stats = computeStats([item({ relation: 'context' })])
  assert.equal(stats.evidenceStrength, 0)
  assert.equal(stats.evidenceScore, 0)
  assert.equal(stats.tally.context, 1)
})

test('computeStats: several authoritative supporting domains give a strong positive score', () => {
  const stats = computeStats([item(), bbc(), gov()])
  assert.equal(stats.evidenceScore, 100)
  assert.ok(stats.evidenceStrength >= 80)
  assert.equal(stats.tally.topTier, 'primary')
})

test('computeStats: mixed evidence lowers the score', () => {
  const stats = computeStats([item(), bbc({ relation: 'contradicts' })])
  assert.ok(Math.abs(stats.evidenceScore) < 30)
})

test('reconcileVerdict never lets the model claim verified or false without directional evidence', () => {
  const none = computeStats([item({ relation: 'context' })])
  assert.equal(reconcileVerdict('verified', none).verdict, 'unverified')
  assert.equal(reconcileVerdict('likely_false', none).verdict, 'unverified')
  assert.equal(reconcileVerdict('opinion', none).verdict, 'opinion')
})

test('reconcileVerdict rejects verdicts that contradict the tally', () => {
  assert.equal(reconcileVerdict('verified', computeStats([item({ relation: 'contradicts' })])).verdict, 'unverified')
  const supporting = computeStats([item()])
  assert.equal(reconcileVerdict('likely_false', supporting).verdict, 'unverified')
  assert.equal(reconcileVerdict('verified', supporting).verdict, 'verified')
})

test('capConfidence bounds confidence by evidence strength but keeps a small floor', () => {
  assert.equal(capConfidence(95, computeStats([])), 15)
  const strong = computeStats([item(), bbc(), gov()])
  assert.equal(capConfidence(100, strong), strong.evidenceStrength)
})

test('verdictFromStats falls back to unverified without strong evidence', () => {
  assert.equal(verdictFromStats(computeStats([])), 'unverified')
  const contradicting = [item({ relation: 'contradicts' }), bbc({ relation: 'contradicts' }), gov({ relation: 'contradicts' })]
  assert.equal(verdictFromStats(computeStats(contradicting)), 'likely_false')
})

test('nonFactualVerdict distinguishes satire, opinion and vague content', () => {
  assert.equal(nonFactualVerdict([cl('satire')]), 'satire')
  assert.equal(nonFactualVerdict([cl('opinion')]), 'opinion')
  assert.equal(nonFactualVerdict([cl('prediction')]), 'opinion')
  assert.equal(nonFactualVerdict([cl('unverifiable')]), 'unverified')
})
