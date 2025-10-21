/**
 * PostgreSQL Migration Runner
 *
 * Runs all migration files in order to set up the PostgreSQL schema
 * for AUDIT TRAIL (Redis is PRIMARY source of truth)
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import { pool } from '../src/config/database'

const migrations = [
  '001_initial_schema.sql',
  '002_add_indexes.sql',
]

const runMigrations = async () => {
  console.log('🚀 Running database migrations...\n')

  for (const migration of migrations) {
    const filePath = join(__dirname, '../migrations', migration)

    try {
      console.log(`📄 Running migration: ${migration}`)
      const sql = readFileSync(filePath, 'utf-8')
      await pool.query(sql)
      console.log(`✅ Migration ${migration} completed\n`)
    } catch (err) {
      console.error(`❌ Migration ${migration} failed:`, err)
      throw err
    }
  }

  console.log('✅ All migrations completed successfully')
  await pool.end()
}

runMigrations()
  .then(() => {
    console.log('\n🎉 Database setup complete!')
    process.exit(0)
  })
  .catch((err) => {
    console.error('\n💥 Migration failed:', err)
    process.exit(1)
  })
