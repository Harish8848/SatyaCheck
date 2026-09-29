import { z } from 'zod'
import { generateStructured } from '../core/model'
import { config } from '../core/config'
import type { ClaimType, ExtractedClaim } from '../core/types'

/**
 * Claim extraction: split the ingested text into individually checkable
 * claims, each with a verification question a researcher could answer.
 *
 * Non-factual material (opinion, satire markers, predictions, vague
 * unverifiable statements) is labelled — never sent to web search as if it
 * were a fact. The final assessment may still discuss it, but the evidence
 * stages only spend budget on `factual` claims.
 */

const claimSchema = z.object({
  claims: z
    .array(
      z.object({
        text: z.string().min(8).max(600),
        claimType: z.enum(['factual', 'opinion', 'satire', 'prediction', 'unverifiable']),
        entities: z.array(z.string().min(1).max(120)).max(8).default([]),
        verificationQuestion: z.string().min(8).max(300),
        quote: z.string().min(1).max(600).optional(),
      }),
    )
    .max(12),
})

const SYSTEM = [
  'You extract checkable claims for an evidence-based fact-checking pipeline.',
  'Split compound statements into atomic claims (one assertion each).',
  'Copy claim text faithfully from the input; do not paraphrase away specifics like names, numbers, dates.',
  'Classify each claim: factual (verifiable against external sources), opinion (value judgement),',
  'satire (comedic/absurdist framing), prediction (future event), unverifiable (too vague to check).',
  'For factual claims, write the single question a researcher must answer to verify it.',
  'Ignore boilerplate, bylines, navigation text, and duplicate restatements.',
  'If the input has no checkable content, return an empty claims array.',
].join(' ')

let counter = 0

export async function extractClaims(
  text: string,
  context: { sourceLabel: string; aiSignalSummary?: string } = { sourceLabel: 'submission' },
): Promise<{ claims: ExtractedClaim[]; model: string; factualCount: number }> {
  const trimmed = text.trim().slice(0, 12_000)
  if (!trimmed) return { claims: [], model: 'none', factualCount: 0 }

  const { output, model } = await generateStructured({
    label: 'claim-extraction',
    schema: claimSchema,
    models: [config.plannerModel, ...config.analystModels],
    system: SYSTEM,
    prompt: [`Source: ${context.sourceLabel}`, context.aiSignalSummary ? `Media context: ${context.aiSignalSummary}` : '', 'Extract claims from:', trimmed].filter(Boolean).join('\n'),
  })

  const claims: ExtractedClaim[] = output.claims.slice(0, config.maxClaims + 3).map((c) => {
    counter += 1
    return {
      id: `claim-${counter}`,
      text: c.text.trim(),
      claimType: c.claimType as ClaimType,
      entities: [...new Set(c.entities.map((e) => e.trim()).filter(Boolean))].slice(0, 8),
      verificationQuestion: c.verificationQuestion.trim(),
      quote: c.quote?.trim() || undefined,
    }
  })

  return { claims, model, factualCount: claims.filter((c) => c.claimType === 'factual').length }
}
