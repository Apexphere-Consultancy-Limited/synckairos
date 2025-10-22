import pg from 'pg';
import { readFileSync } from 'fs';
import { config } from 'dotenv';

config({ path: '.env.production' });

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function fixMigration() {
  const client = await pool.connect();

  try {
    console.log('📄 Reading migration file...');
    const sql = readFileSync('./migrations/001_initial_schema.sql', 'utf-8');

    // Split by statement and execute one by one
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s && !s.startsWith('--') && s.length > 5);

    console.log(`Found ${statements.length} statements\n`);

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      if (!stmt) continue;

      try {
        await client.query(stmt);
        console.log(`✅ Statement ${i + 1} executed`);
      } catch (err) {
        if (err.code === '42710' || err.code === '42P07') {
          console.log(`⚠️  Statement ${i + 1} skipped (already exists)`);
        } else {
          console.error(`❌ Statement ${i + 1} failed:`, err.message);
          throw err;
        }
      }
    }

    console.log('\n✅ Migration 001 completed');

    // Run migration 002
    console.log('\n📄 Reading migration 002...');
    const sql2 = readFileSync('./migrations/002_add_indexes.sql', 'utf-8');
    const statements2 = sql2
      .split(';')
      .map(s => s.trim())
      .filter(s => s && !s.startsWith('--') && s.length > 5);

    for (let i = 0; i < statements2.length; i++) {
      const stmt = statements2[i];
      if (!stmt) continue;

      try {
        await client.query(stmt);
        console.log(`✅ Index ${i + 1} created`);
      } catch (err) {
        if (err.code === '42P07') {
          console.log(`⚠️  Index ${i + 1} skipped (already exists)`);
        } else {
          console.error(`❌ Index ${i + 1} failed:`, err.message);
        }
      }
    }

    console.log('\n✅ All migrations completed');
  } finally {
    client.release();
    await pool.end();
  }
}

fixMigration().catch(err => {
  console.error('💥 Migration failed:', err);
  process.exit(1);
});
