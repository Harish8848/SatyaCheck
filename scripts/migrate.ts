import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Pool } from 'pg'

/** Applies db/schema.sql. The file is idempotent (create ... if not exists / add column if not exists). */
async function main() {
  const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL
  if (!connectionString) throw new Error('DATABASE_URL (or POSTGRES_URL) is not set.')
  const sql = readFileSync(join(__dirname, '..', 'db', 'schema.sql'), 'utf8')
  const pool = new Pool({ connectionString })
  try {
    await pool.query('create extension if not exists pgcrypto')
    await pool.query(sql)
    console.log('Migration applied.')
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error('Migration failed:', error instanceof Error ? error.message : error)
  process.exit(1)
})
