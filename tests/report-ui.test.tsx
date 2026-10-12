import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { EvidenceReport } from '../components/evidence-report'
import { buildEvidenceReport } from '../lib/core/evidence-report'

test('public report renders coverage, expandable claims, citations and no truth percentage', () => {
 const claim = { id: 'c1', text: 'A bridge opened on the stated date.', claimType: 'factual' as const, entities: [], verificationQuestion: 'When did it open?' }
 const report = buildEvidenceReport([claim], [{ id: 'ev1', claimId: 'c1', title: 'Inspection record', url: 'https://records.example/a', domain: 'records.example', publisher: 'Records office', tier: 'primary', relation: 'supports', relevanceKind: 'direct', evidenceBasis: 'article_content', quoteVerified: true, quote: 'The bridge opened on the stated date.', snippet: 'The bridge opened on the stated date.', relevance: 100, authority: 100, provider: 'fixture', contextMatch: 'matched', retrievedAt: '2026-10-12T03:00:00Z' }], { inputType: 'text', text: claim.text, extractedChars: 34, truncated: false, notes: [], sourceLabel: 'text' }, ['c1'], [])
 const html = renderToStaticMarkup(createElement(EvidenceReport, { report }))
 assert.match(html, /Mostly supported/); assert.match(html, /50\/100 evidence strength/)
 assert.match(html, /href="https:\/\/records.example\/a"/); assert.match(html, /<details/)
 assert.match(html, /Coverage/); assert.match(html, /Checked:/)
 assert.doesNotMatch(html, /50%/)
 const empty = renderToStaticMarkup(createElement(EvidenceReport, { report: buildEvidenceReport([claim], [], { inputType: 'text', text: claim.text, extractedChars: 34, truncated: false, notes: [], sourceLabel: 'text' }, ['c1'], []) }))
 assert.match(empty, /Insufficient evidence/); assert.doesNotMatch(empty, /\/100 evidence strength/)
})
