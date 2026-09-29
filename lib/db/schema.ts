import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import type { AiContentSignal, Assessment, ExtractedClaim, IngestedInput, StageResult } from '@/lib/core/types'

export const verificationRequests = pgTable('verification_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  inputType: text('input_type').notNull(),
  inputText: text('input_text'),
  sourceName: text('source_name'),
  status: text('status').notNull().default('completed'),
  verdict: text('verdict'),
  confidence: integer('confidence'),
  summary: text('summary'),
  aiSignal: jsonb('ai_signal').$type<AiContentSignal>(),
  inputMeta: jsonb('input_meta').$type<IngestedInput>(),
  claims: jsonb('claims').$type<ExtractedClaim[]>(),
  stages: jsonb('stages').$type<StageResult[]>(),
  assessment: jsonb('assessment').$type<Assessment>(),
  finalVerdict: text('final_verdict'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
})

export const verificationEvidence = pgTable('verification_evidence', {
  id: uuid('id').defaultRandom().primaryKey(),
  requestId: uuid('request_id').notNull(),
  sourceType: text('source_type').notNull(),
  title: text('title').notNull(),
  relation: text('relation').notNull(),
  explanation: text('explanation').notNull(),
  sourceUrl: text('source_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const verificationSources = pgTable('verification_sources', {
  id: uuid('id').defaultRandom().primaryKey(),
  requestId: uuid('request_id').notNull(),
  claimId: text('claim_id').notNull(),
  title: text('title').notNull(),
  url: text('url').notNull(),
  domain: text('domain').notNull(),
  publisher: text('publisher').notNull(),
  tier: text('tier').notNull(),
  relation: text('relation').notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  snippet: text('snippet').notNull(),
  quote: text('quote'),
  relevance: integer('relevance').notNull(),
  authority: integer('authority').notNull(),
  recency: integer('recency'),
  provider: text('provider').notNull(),
  reasoning: text('reasoning'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export type VerificationRequestRow = typeof verificationRequests.$inferSelect
export type VerificationEvidenceRow = typeof verificationEvidence.$inferSelect
