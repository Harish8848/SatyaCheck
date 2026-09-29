import { generateStructured } from '../core/model'
import { describeError, log } from '../core/logger'
import type { Assessment } from '../core/types'
import { ASSESSMENT_SYSTEM, assessmentSchema, buildPrompt, mediaCaveat, type AssessInput } from './assessment-prompt'
import { capConfidence, computeStats, nonFactualVerdict, reconcileVerdict, verdictFromStats } from './assessment-stats'

export { computeStats } from './assessment-stats'
export type { AssessInput } from './assessment-prompt'

/**
 * Final assessment: model-written explanation bounded by the deterministic
 * evidence tally. The model can explain the evidence but cannot override it.
 */
export async function assess(input: AssessInput): Promise<Assessment> {
  const factual = input.claims.filter((claim) => claim.claimType === 'factual')
  const stats = computeStats(input.evidence)
  const baseCaveats = [...input.notes, ...mediaCaveat(input.aiSignal)]
  if (input.uncheckedClaims > 0) baseCaveats.push(`${input.uncheckedClaims} further factual claim(s) were listed but not checked because of the per-submission limit.`)
  const finish = (partial: Pick<Assessment, 'verdict' | 'confidence' | 'headline' | 'reasoning' | 'model'> & { caveats: string[] }): Assessment => ({
    ...partial,
    ...stats,
    caveats: [...new Set(partial.caveats)].slice(0, 10),
  })

  if (!input.claims.length) {
    return finish({ verdict: 'unverified', confidence: 10, headline: 'No checkable claim was found in this submission.', reasoning: 'Nothing in the submitted content could be extracted as a specific, checkable claim, so there was nothing to compare against external sources.', caveats: baseCaveats, model: 'deterministic' })
  }
  if (!factual.length) {
    const verdict = nonFactualVerdict(input.claims)
    const headline = verdict === 'satire' ? 'The content reads as satire, not a factual report.' : verdict === 'opinion' ? 'The content is opinion or prediction, which cannot be fact-checked.' : 'The content is too vague to fact-check.'
    return finish({ verdict, confidence: 60, headline, reasoning: 'None of the extracted statements is a checkable factual claim, so no web evidence was gathered. The confidence reflects how the content was classified, not a factual finding.', caveats: baseCaveats, model: 'deterministic' })
  }

  try {
    const { output, model } = await generateStructured({ label: 'final-assessment', schema: assessmentSchema, system: ASSESSMENT_SYSTEM, prompt: buildPrompt(input, factual, stats) })
    const reconciled = reconcileVerdict(output.verdict, stats)
    return finish({
      verdict: reconciled.verdict,
      confidence: capConfidence(reconciled.verdict === output.verdict ? output.confidence : 15, stats),
      headline: output.headline,
      reasoning: output.reasoning,
      caveats: [...baseCaveats, ...output.caveats, ...(reconciled.caveat ? [reconciled.caveat] : [])],
      model,
    })
  } catch (error) {
    log('warn', 'assessment model unavailable; using deterministic fallback', { error: describeError(error) })
    const verdict = verdictFromStats(stats)
    return finish({
      verdict,
      confidence: capConfidence(verdict === 'unverified' ? 15 : stats.evidenceStrength, stats),
      headline: verdict === 'verified' ? 'Sources found support the claim.' : verdict === 'likely_false' ? 'Sources found contradict the claim.' : 'The available evidence is not enough to verify the claim.',
      reasoning: `The analysis model was unavailable, so this result comes from the evidence tally alone: ${stats.tally.supports} supporting and ${stats.tally.contradicts} contradicting source(s) across ${stats.tally.distinctDomains} domain(s).`,
      caveats: [...baseCaveats, 'The explanatory model was unavailable; no written analysis was produced.'],
      model: 'deterministic-fallback',
    })
  }
}
