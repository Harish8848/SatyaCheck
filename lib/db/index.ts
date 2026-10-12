import { UserFacingError } from '../core/errors'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL

export function assertDatabaseConfigured() {
  if (!connectionString) throw new UserFacingError('Setup required: configure DATABASE_URL or POSTGRES_URL on the server to save assessments.')
}

export const pool = new Pool({
  connectionString,
  max: 5,
  connectionTimeoutMillis: 5_000,
})
export const db = drizzle(pool, { schema })
