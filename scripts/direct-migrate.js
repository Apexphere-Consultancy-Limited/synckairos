import pg from 'pg';
import { readFileSync } from 'fs';
import { config } from 'dotenv';

config({ path: '.env.production' });

const { Client } = pg;

async function directMigrate() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    // Read migration 001
    console.log('📄 Running migration 001...');
    const sql1 = readFileSync('./migrations/001_initial_schema.sql', 'utf-8');
    await client.query(sql1);
    console.log('✅ Migration 001 complete\n');

    // Read migration 002
    console.log('📄 Running migration 002...');
    const sql2 = readFileSync('./migrations/002_add_indexes.sql', 'utf-8');
    await client.query(sql2);
    console.log('✅ Migration 002 complete\n');

    // Verify tables
    console.log('📋 Verifying tables...');
    const result = await client.query(`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    `);
    console.log('Tables created:', result.rows.map(r => r.tablename));

    console.log('\n✅ All migrations completed!');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    console.error(err);
  } finally {
    await client.end();
  }
}

directMigrate();
