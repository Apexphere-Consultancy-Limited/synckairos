#!/usr/bin/env node

/**
 * PostgreSQL Connection Test Script
 * Tests connectivity and schema validation for Supabase PostgreSQL
 */

import pg from 'pg';
import { config } from 'dotenv';

const { Pool } = pg;

// Load environment variables
config({ path: '.env.production' });

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL not found in environment variables');
  process.exit(1);
}

console.log('🔍 Testing PostgreSQL Connection...\n');
console.log(`📍 URL: ${DATABASE_URL.replace(/\/\/[^@]+@/, '//***:***@')}\n`);

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('supabase') || DATABASE_URL.includes('neon')
    ? { rejectUnauthorized: false }
    : false,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

async function testPostgreSQL() {
  let client;

  try {
    // Test 1: Connection
    console.log('📝 Test 1: Connection');
    client = await pool.connect();
    const result = await client.query('SELECT NOW() as current_time, version()');
    console.log(`   ✅ Connected at: ${result.rows[0].current_time}`);
    console.log(`   ✅ Version: ${result.rows[0].version.split(' ').slice(0, 2).join(' ')}`);
    client.release();

    // Test 2: Schema validation
    console.log('\n📝 Test 2: Schema Validation');
    client = await pool.connect();

    // Check if tables exist
    const tablesQuery = `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `;
    const tables = await client.query(tablesQuery);
    console.log(`   ✅ Found ${tables.rows.length} tables:`);
    tables.rows.forEach((row) => {
      console.log(`      - ${row.table_name}`);
    });

    // Expected tables for SyncKairos
    const expectedTables = ['users', 'devices', 'sessions', 'sync_operations'];
    const existingTableNames = tables.rows.map((r) => r.table_name);
    const missingTables = expectedTables.filter((t) => !existingTableNames.includes(t));

    if (missingTables.length > 0) {
      console.log(`\n   ⚠️  Missing tables: ${missingTables.join(', ')}`);
      console.log('      Run migrations: pnpm run migrate:production');
    }

    client.release();

    // Test 3: Basic CRUD operations (if tables exist)
    if (existingTableNames.includes('users')) {
      console.log('\n📝 Test 3: Basic CRUD Operations');
      client = await pool.connect();

      await client.query('BEGIN');

      try {
        // Insert test user
        await client.query(
          `INSERT INTO users (id, email, created_at, updated_at)
           VALUES ($1, $2, NOW(), NOW())
           ON CONFLICT (id) DO NOTHING`,
          ['test_user_123', 'test@synckairos.dev']
        );
        console.log('   ✅ INSERT successful');

        // Select test user
        const selectResult = await client.query(
          'SELECT id, email FROM users WHERE id = $1',
          ['test_user_123']
        );
        console.log(`   ✅ SELECT successful: ${selectResult.rows.length} row(s)`);

        // Update test user
        await client.query(
          'UPDATE users SET updated_at = NOW() WHERE id = $1',
          ['test_user_123']
        );
        console.log('   ✅ UPDATE successful');

        // Delete test user
        await client.query('DELETE FROM users WHERE id = $1', ['test_user_123']);
        console.log('   ✅ DELETE successful');

        await client.query('ROLLBACK');
        console.log('   ✅ Transaction rolled back (test data cleaned up)');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }

      client.release();
    }

    // Test 4: Connection pool
    console.log('\n📝 Test 4: Connection Pool');
    const poolInfo = {
      total: pool.totalCount,
      idle: pool.idleCount,
      waiting: pool.waitingCount,
    };
    console.log(`   ✅ Pool status: ${JSON.stringify(poolInfo)}`);

    // Test 5: Query performance
    console.log('\n📝 Test 5: Query Performance');
    client = await pool.connect();
    const startTime = Date.now();
    await client.query('SELECT 1');
    const queryTime = Date.now() - startTime;
    console.log(`   ✅ Query latency: ${queryTime}ms`);
    client.release();

    console.log('\n✅ All PostgreSQL tests passed!\n');

    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ PostgreSQL test failed:', error.message);
    console.error('   Stack:', error.stack);

    if (client) {
      try {
        await client.query('ROLLBACK');
        client.release();
      } catch (rollbackError) {
        // Ignore rollback errors
      }
    }

    await pool.end();
    process.exit(1);
  }
}

// Handle uncaught errors
process.on('unhandledRejection', (error) => {
  console.error('\n❌ Unhandled rejection:', error);
  process.exit(1);
});

testPostgreSQL();
