import pg from 'pg';
import { config } from 'dotenv';

config({ path: '.env.production' });

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function checkAllSchemas() {
  const client = await pool.connect();

  try {
    // Check all schemas
    console.log('📋 All Schemas:');
    const schemas = await client.query(`
      SELECT schema_name FROM information_schema.schemata
      WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
    `);
    schemas.rows.forEach(row => console.log(`  - ${row.schema_name}`));

    // Check tables in all schemas
    console.log('\n📋 All Tables (all schemas):');
    const tables = await client.query(`
      SELECT schemaname, tablename FROM pg_tables
      WHERE schemaname NOT IN ('information_schema', 'pg_catalog')
      ORDER BY schemaname, tablename
    `);
    tables.rows.forEach(row => console.log(`  - ${row.schemaname}.${row.tablename}`));

    // Check types in all schemas
    console.log('\n📋 All Custom Types:');
    const types = await client.query(`
      SELECT n.nspname as schema, t.typname as type
      FROM pg_type t
      JOIN pg_namespace n ON t.typnamespace = n.oid
      WHERE t.typtype = 'e' AND n.nspname NOT IN ('information_schema', 'pg_catalog')
    `);
    types.rows.forEach(row => console.log(`  - ${row.schema}.${row.type}`));

  } finally {
    client.release();
    await pool.end();
  }
}

checkAllSchemas().catch(console.error);
