import type { EvidenceItem, ExtractedClaim, IngestedInput } from './types'

export const assessmentVerdicts = ['Supported', 'Mostly supported', 'Mixed', 'Unsupported', 'Contradicted', 'Insufficient evidence', 'Not fact-checkable'] as const
export type EvidenceVerdict = typeof assessmentVerdicts[number]
export const defaultRubric = { direct: 35, independence: 25, quality: 20, context: 15, authenticity: 5 }
export type Rubric = typeof defaultRubric
export type ScoreComponent = { name: keyof Rubric; points: number; maximum: number; explanation: string; evidenceIds: string[] }
export type ClaimAssessment = {
  claimId: string; claim: string; verdict: EvidenceVerdict; evidenceStrength: number | null
  assessed: boolean; findings: { text: string; evidenceIds: string[] }[]; context: string[]
  components: ScoreComponent[]; limitations: string[]
}
export type EvidenceReport = {
  version: 1; checkedAt: string; summary: string; claims: ClaimAssessment[]; sources: EvidenceItem[]
  coverage: { assessed: number; total: number; description: string }; limitations: string[]
}

function normalized(text: string) { return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() }
function overlap(a: string, b: string) {
  const x = new Set(normalized(a).split(' ')), y = new Set(normalized(b).split(' '))
  return [...x].filter(t => y.has(t)).length / Math.max(1, Math.min(x.size, y.size))
}
/** Conservative origin clusters: same host, matching copy, or explicitly named wire origin.
 * Unknown independence never earns corroboration points. This is not plagiarism detection. */
export function groupSources(items: EvidenceItem[]): EvidenceItem[] {
  const parent = items.map((_, i) => i)
  const root = (i: number): number => parent[i] === i ? i : (parent[i] = root(parent[i]))
  const wire = (s: EvidenceItem) => /\b(reuters|associated press|agence france.presse)\b/i.exec(`${s.title} ${s.snippet}`)?.[1].toLowerCase()
  for (let i = 0; i < items.length; i++) for (let j = 0; j < i; j++) {
    const a = items[i], b = items[j]
    if (a.domain === b.domain || a.url === b.url ||
      (wire(a) && wire(a) === wire(b)) || normalized(a.title) === normalized(b.title) ||
      (a.snippet.length > 100 && b.snippet.length > 100 && overlap(a.snippet, b.snippet) > .85) ||
      a.snippet.includes(b.url) || b.snippet.includes(a.url)) parent[root(i)] = root(j)
  }
  return items.map((s, i) => ({ ...s, sourceGroup: `origin-${root(i) + 1}` }))
}

export function validateRubric(rubric: Rubric): Rubric {
  const values = Object.keys(defaultRubric).map(k => rubric[k as keyof Rubric])
  if (values.some(v => !Number.isInteger(v) || v < 0) || values.reduce((a, b) => a + b, 0) !== 100) throw new Error('Evidence rubric weights must be nonnegative integers and total 100.')
  return rubric
}

export function assessClaim(claim: ExtractedClaim, sources: EvidenceItem[], options: { assessed: boolean; incomplete: boolean; rubric?: Rubric }): ClaimAssessment {
  const rubric = validateRubric(options.rubric ?? defaultRubric)
  const own = sources.filter(s => s.claimId === claim.id)
  const directional = own.filter(s => s.relevanceKind === 'direct' && s.relation !== 'context' && s.contextMatch === 'matched')
  const read = directional.filter(s => s.evidenceBasis === 'article_content' && s.quoteVerified && s.substantiation !== 'not_established')
  const support = read.filter(s => s.relation === 'supports'), contradiction = read.filter(s => s.relation === 'contradicts')
  const limitations: string[] = []
  const context = own.filter(s => s.relation === 'context' || s.contextMatch !== 'matched').map(s => `${s.id}: ${s.reasoning || 'This source does not settle the exact claim.'}`)
  const groups = new Set(read.filter(s => s.independentReporting && s.sourceGroup).map(s => s.sourceGroup))
  let verdict: EvidenceVerdict = claim.claimType !== 'factual' ? 'Not fact-checkable' : 'Insufficient evidence'
  if (claim.claimType === 'factual' && options.assessed) {
    if (support.length && contradiction.length) verdict = 'Mixed'
    else if (contradiction.length) verdict = 'Contradicted'
    else if (support.length) verdict = groups.size >= 2 ? 'Supported' : 'Mostly supported'
    // Unsupported requires an explicit evidentiary finding of lack of substantiation,
    // not simply an empty search. The quoted review must actually say that.
    else if (own.some(s => s.quoteVerified && s.substantiation === 'not_established' && s.contextMatch === 'matched')) verdict = 'Unsupported'
  }
  const evaluated = verdict === 'Unsupported' ? own.filter(s => s.quoteVerified && s.substantiation === 'not_established' && s.contextMatch === 'matched') : read
  const refs = (list: EvidenceItem[]) => list.map(s => s.id)
  const component = (name: keyof Rubric, fraction: number, explanation: string, evidence: EvidenceItem[]): ScoreComponent => ({ name, points: Math.round(rubric[name] * fraction), maximum: rubric[name], explanation, evidenceIds: refs(evidence) })
  const quality = evaluated.filter(s => s.qualityBasis && s.quoteVerified)
  const components = [
    component('direct', evaluated.length ? 1 : 0, 'Exact retrieved excerpts addressing this proposition; snippets alone earn no direct-evidence points.', evaluated),
    component('independence', Math.min(1, Math.max(0, groups.size - 1) / 2), 'Two independently reported origin groups earn half credit; three earn full credit. Unknown origins earn none.', read.filter(s => s.independentReporting)),
    component('quality', quality.length ? .75 : 0, 'Relevant expertise or reporting method is explained against retrieved content; a domain reputation or official label alone earns nothing. Automated review is capped at 75% of this component.', quality),
    component('context', evaluated.length ? 1 : 0, 'Judged match of event, participants, location and time, with a verified excerpt.', evaluated),
    component('authenticity', 0, 'No document signature or account ownership was independently authenticated. Badges visible in media earn no points.', []),
  ]
  let score: number | null = ['Not fact-checkable', 'Insufficient evidence'].includes(verdict) ? null : Math.min(100, components.reduce((sum, c) => sum + c.points, 0))
  const cap = (value: number, reason: string) => { if (score !== null) score = Math.min(score, value); limitations.push(reason) }
  if (support.length && contradiction.length) cap(60, 'Unresolved direct contradictions cap evidence strength at 60.')
  if (own.some(s => s.evidenceBasis === 'search_snippet')) cap(70, 'Some sources could only be assessed as snippets; evidence strength is capped at 70.')
  if (options.incomplete) cap(60, 'Input processing or media sampling is incomplete; evidence strength is capped at 60.')
  if (!evaluated.length && claim.claimType === 'factual') limitations.push('No inspected, quoted source settles the exact claim. Search absence is not evidence of falsehood.')
  if (!options.assessed && claim.claimType === 'factual') limitations.push('This claim was not researched because of the submission limit or a processing failure.')
  limitations.push('Shared origins are grouped conservatively; undetected copying may remain. Source authenticity was not established.')
  return { claimId: claim.id, claim: claim.text, verdict, evidenceStrength: score, assessed: options.assessed && claim.claimType === 'factual',
    findings: own.filter(s => s.quoteVerified && s.quote).map(s => ({ text: `${s.publisher} reports: “${s.quote}” (${s.relation}).`, evidenceIds: [s.id] })), context, components, limitations }
}

export function buildEvidenceReport(claims: ExtractedClaim[], evidence: EvidenceItem[], input: IngestedInput, checkedIds: string[], notes: string[], rubric?: Rubric): EvidenceReport {
  const sources = groupSources(evidence)
  const results = claims.map(claim => assessClaim(claim, sources, { assessed: checkedIds.includes(claim.id), incomplete: input.truncated || Boolean(input.mediaKind) || Boolean(input.processingIncomplete), rubric }))
  const assessed = results.filter(c => c.assessed).length
  return { version: 1, checkedAt: new Date().toISOString(), claims: results, sources,
    summary: results.length === 1 ? `${results[0].verdict}. See the evidence and limitations for this claim.` : `${assessed} of ${claims.length} extracted statements researched. Each claim has a separate assessment; there is no combined truth score.`,
    coverage: { assessed, total: claims.length, description: `${input.extractedChars} extracted characters. ${input.truncated ? 'Input was truncated.' : ''} ${input.mediaKind ? 'Media interpretation is uncertain; analysis does not authenticate the file. Only the extracted text and sampled visual descriptions were checked.' : 'Checks cover extracted claims only.'}` },
    limitations: [...new Set([...input.notes, ...notes])],
  }
}
