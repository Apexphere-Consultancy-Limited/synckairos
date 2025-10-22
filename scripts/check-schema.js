import pg from 'pg';
import { config } from 'dotenv';

config({ path: '.env.production' });

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function checkSchema() {
  const client = await pool.connect();

  try {
    // Check types
    console.log('📋 Custom Types:');
    const types = await client.query(`
      SELECT typname FROM pg_type
      WHERE typtype = 'e' AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
    `);
    types.rows.forEach(row => console.log(`  - ${row.typname}`));

    // Check tables
    console.log('\n📋 Tables:');
    const tables = await client.query(`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    `);
    tables.rows.forEach(row => console.log(`  - ${row.tablename}`));

    if (tables.rows.length === 0) {
      console.log('  (none - migrations need to run)');
    }

  } finally {
    client.release();
    await pool.end();
  }
}

checkSchema().catch(console.error);
