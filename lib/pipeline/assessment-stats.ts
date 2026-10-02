import type { Assessment, EvidenceItem, ExtractedClaim, SourceTier, Verdict } from '../core/types'
import { tierAuthority, tierRank } from './sources'

/**
 * Deterministic side of the final assessment. The verdict is model-written but
 * bounded by this tally: the model can explain, it cannot override evidence.
 * Absence of evidence is always "unverified", never "false".
 */

export type Stats = Pick<Assessment, 'tally' | 'evidenceScore' | 'evidenceStrength'>

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

function sourceIdentity(item: EvidenceItem): string {
  // Google News links share one host. Use the publisher label for these links;
  // elsewhere prefer the publisher too so its GDELT and RSS copies collapse.
  let name = (item.publisher || item.domain).toLowerCase().trim().replace(/^the\s+/, '')
  name = name.replace(/\.(com|org|net|co\.uk|co\.in|com\.au)$/i, '').replace(/\s+(news|sports)$/i, '')
  name = name.replace(/[^a-z0-9]+/g, '')
  const aliases: Record<string, string> = {
    bbcnews: 'bbc',
    thenewyorktimes: 'nytimes',
    newyorktimes: 'nytimes',
    apnews: 'associatedpress',
    dailysabah: 'dailysabah',
  }
  return aliases[name] ?? (name || item.domain.toLowerCase())
}

function evidenceWeight(item: EvidenceItem): number {
  const semantic = item.relevanceKind === 'direct' ? 1 : 0.55
  const basis = item.evidenceBasis === 'article_content' ? 1 : 0.7
  const quote = item.quoteVerified ? 1 : 0.9
  return (item.authority / 100) * (item.relevance / 100) * semantic * basis * quote
}

export function computeStats(evidence: EvidenceItem[]): Stats {
  const directional = evidence.filter((item) => item.relation !== 'context')
  // Repeated items from one publisher do not multiply counts or evidential
  // weight. Preserve support and contradiction separately if an outlet reports both.
  const grouped = new Map<string, EvidenceItem>()
  for (const item of directional) {
    const key = `${item.claimId ?? ''}:${sourceIdentity(item)}:${item.relation}`
    const current = grouped.get(key)
    if (!current || evidenceWeight(item) > evidenceWeight(current)) grouped.set(key, item)
  }
  const independentItems = [...grouped.values()]
  const contextPublishers = new Set(evidence.filter((item) => item.relation === 'context').map((item) => `${item.claimId ?? ''}:${sourceIdentity(item)}`))
  const supports = independentItems.filter((item) => item.relation === 'supports').reduce((sum, item) => sum + evidenceWeight(item), 0)
  const contradicts = independentItems.filter((item) => item.relation === 'contradicts').reduce((sum, item) => sum + evidenceWeight(item), 0)
  const total = supports + contradicts
  const evidenceScore = total === 0 ? 0 : Math.round((100 * (supports - contradicts)) / total)

  const distinctDomains = new Set(independentItems.map(sourceIdentity)).size
  const topTier: SourceTier = directional.reduce<SourceTier>((best, item) => (tierRank[item.tier] > tierRank[best] ? item.tier : best), 'unverified')
  const sourceQuality = independentItems.length
    ? independentItems.reduce((sum, item) => sum + (item.authority / 100) * (item.relevanceKind === 'direct' ? 1 : 0.7) * (item.evidenceBasis === 'article_content' ? 1 : 0.7) * (item.quoteVerified ? 1 : 0.9), 0) / independentItems.length
    : 0
  const evidenceStrength = independentItems.length
    ? clamp(Math.round(((Math.min(distinctDomains, 3) / 3) * 50 + (tierAuthority[topTier] / 100) * 30 + (Math.abs(evidenceScore) / 100) * 20) * sourceQuality), 0, 100)
    : 0

  return {
    tally: {
      supports: independentItems.filter((item) => item.relation === 'supports').length,
      contradicts: independentItems.filter((item) => item.relation === 'contradicts').length,
      context: contextPublishers.size,
      distinctDomains,
      topTier,
    },
    evidenceScore,
    evidenceStrength,
  }
}

/** Verdict for submissions with nothing fact-checkable in them. */
export function nonFactualVerdict(claims: ExtractedClaim[]): Verdict {
  const count = (type: ExtractedClaim['claimType']) => claims.filter((claim) => claim.claimType === type).length
  const satire = count('satire')
  const opinion = count('opinion') + count('prediction')
  if (satire > 0 && satire >= opinion) return 'satire'
  if (opinion > 0 && opinion >= count('unverifiable')) return 'opinion'
  return 'unverified'
}

/** Verdict from the tally alone; used when no model is available. */
export function verdictFromStats(stats: Stats): Verdict {
  if (stats.evidenceStrength >= 40 && stats.evidenceScore >= 40) return 'verified'
  if (stats.evidenceStrength >= 40 && stats.evidenceScore <= -40) return 'likely_false'
  return 'unverified'
}

/** Confidence can never exceed the strength of the evidence behind it. */
export function capConfidence(confidence: number, stats: Stats): number {
  return clamp(Math.round(confidence), 0, Math.max(15, stats.evidenceStrength))
}

/** Reject verdicts the evidence contradicts. Returns the safe verdict plus a caveat if it was changed. */
export function reconcileVerdict(verdict: Verdict, stats: Stats): { verdict: Verdict; caveat?: string } {
  const directional = stats.tally.supports + stats.tally.contradicts
  if (verdict === 'verified' || verdict === 'likely_false') {
    if (directional === 0) return { verdict: 'unverified', caveat: 'No source directly supported or contradicted the claim, so the verdict was set to unverified.' }
    if (verdict === 'verified' && stats.evidenceScore <= 0) return { verdict: 'unverified', caveat: 'The evidence tally did not favour the claim, so “verified” was withheld.' }
    if (verdict === 'likely_false' && stats.evidenceScore >= 0) return { verdict: 'unverified', caveat: 'The evidence tally did not contradict the claim, so “likely false” was withheld.' }
  }
  return { verdict }
}
