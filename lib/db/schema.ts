import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const verificationRequests = pgTable('verification_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  inputType: text('input_type').notNull(),
  inputText: text('input_text'),
  sourceName: text('source_name'),
  status: text('status').notNull().default('completed'),
  verdict: text('verdict'),
  confidence: integer('confidence'),
  summary: text('summary'),
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

export type VerificationRequestRow = typeof verificationRequests.$inferSelect
export type VerificationEvidenceRow = typeof verificationEvidence.$inferSelect
