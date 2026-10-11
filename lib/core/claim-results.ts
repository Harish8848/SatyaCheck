import type { EvidenceItem, ExtractedClaim } from './types'

type Source = Pick<EvidenceItem, 'claimId' | 'relation' | 'relevanceKind' | 'evidenceBasis' | 'publisher'>
export function claimResults(claims: Pick<ExtractedClaim, 'id' | 'text' | 'claimType'>[], sources: Source[]) {
  return claims.filter(c => c.claimType === 'factual').map(claim => {
    const evidence = sources.filter(s => s.claimId === claim.id && s.relevanceKind === 'direct' && s.relation !== 'context')
    const supports = evidence.some(s => s.relation === 'supports')
    const contradicts = evidence.some(s => s.relation === 'contradicts')
    const snippetsOnly = evidence.length > 0 && evidence.every(s => s.evidenceBasis === 'search_snippet')
    const label = supports && contradicts ? 'Conflicting evidence' : supports ? (snippetsOnly ? 'Reported support — snippets only' : 'Supporting evidence found') : contradicts ? (snippetsOnly ? 'Reported contradiction — snippets only' : 'Contradicting evidence found') : 'Unverified — insufficient evidence'
    const detail = evidence.length ? `Sources: ${[...new Set(evidence.map(s => s.publisher))].join(', ')}.${snippetsOnly ? ' Full article text was not checked.' : ' Evidence is limited to the retrieved sources.'}` : 'No retrieved source directly establishes or contradicts this specific claim.'
    return { id: claim.id, text: claim.text, label, detail, unresolved: !supports && !contradicts }
  })
}
