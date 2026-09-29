import type { Assessment, EvidenceItem, ExtractedClaim, SourceTier, Verdict } from '../core/types'
import { tierAuthority, tierRank } from './sources'

/**
 * Deterministic side of the final assessment. The verdict is model-written but
 * bounded by this tally: the model can explain, it cannot override evidence.
 * Absence of evidence is always "unverified", never "false".
 */

export type Stats = Pick<Assessment, 'tally' | 'evidenceScore' | 'evidenceStrength'>

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

export function computeStats(evidence: EvidenceItem[]): Stats {
  const directional = evidence.filter((item) => item.relation !== 'context')
  const weight = (item: EvidenceItem) => (item.authority / 100) * (item.relevance / 100)
  const supports = directional.filter((item) => item.relation === 'supports').reduce((sum, item) => sum + weight(item), 0)
  const contradicts = directional.filter((item) => item.relation === 'contradicts').reduce((sum, item) => sum + weight(item), 0)
  const total = supports + contradicts
  const evidenceScore = total === 0 ? 0 : Math.round((100 * (supports - contradicts)) / total)

  const distinctDomains = new Set(directional.map((item) => item.domain)).size
  const topTier: SourceTier = directional.reduce<SourceTier>((best, item) => (tierRank[item.tier] > tierRank[best] ? item.tier : best), 'unverified')
  const evidenceStrength = directional.length
    ? clamp(Math.round((Math.min(distinctDomains, 3) / 3) * 50 + (tierAuthority[topTier] / 100) * 30 + (Math.abs(evidenceScore) / 100) * 20), 0, 100)
    : 0

  return {
    tally: {
      supports: evidence.filter((item) => item.relation === 'supports').length,
      contradicts: evidence.filter((item) => item.relation === 'contradicts').length,
      context: evidence.filter((item) => item.relation === 'context').length,
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
