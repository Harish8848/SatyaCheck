import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL

if (!connectionString) {
  throw new Error('Database is not configured. Set DATABASE_URL (or POSTGRES_URL) in .env.local and restart the app.')
}

export const pool = new Pool({
  connectionString,
  max: 5,
  connectionTimeoutMillis: 5_000,
})
export const db = drizzle(pool, { schema })
