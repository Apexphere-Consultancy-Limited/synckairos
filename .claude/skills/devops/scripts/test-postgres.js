#!/usr/bin/env node

/**
 * PostgreSQL Connection Test Script
 * Tests PostgreSQL connectivity and validates configuration
 * Usage: node test-postgres.js [database-url]
 */

import pg from 'pg';
import { config } from 'dotenv';

const { Client } = pg;

config();

const DATABASE_URL = process.argv[2] || process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ ERROR: DATABASE_URL not provided');
  console.error('Usage: node test-postgres.js [database-url]');
  console.error('   or: DATABASE_URL=... node test-postgres.js');
  process.exit(1);
}

async function testPostgres() {
  console.log('🔍 Testing PostgreSQL Connection...\n');
  console.log(`URL: ${DATABASE_URL.replace(/:[^:@]+@/, ':****@')}\n`);

  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes('localhost')
      ? false
      : { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000
  });

  try {
    // Test 1: Connection
    console.log('Test 1: Connection...');
    const start = Date.now();
    await client.connect();
    const connectTime = Date.now() - start;
    console.log(`✅ Connected successfully (${connectTime}ms)\n`);

    // Test 2: Version
    console.log('Test 2: PostgreSQL Version...');
    const versionResult = await client.query('SELECT version()');
    const version = versionResult.rows[0].version;
    console.log(`✅ ${version}\n`);

    // Test 3: Database Name
    console.log('Test 3: Current Database...');
    const dbResult = await client.query('SELECT current_database()');
    console.log(`✅ Database: ${dbResult.rows[0].current_database}\n`);

    // Test 4: Latency
    console.log('Test 4: Query Latency...');
    const latencyStart = Date.now();
    await client.query('SELECT 1');
    const latency = Date.now() - latencyStart;
    console.log(`✅ Query latency: ${latency}ms\n`);

    // Test 5: Tables
    console.log('Test 5: Existing Tables...');
    const tablesResult = await client.query(`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `);
    if (tablesResult.rows.length > 0) {
      console.log('✅ Tables found:');
      tablesResult.rows.forEach(row => {
        console.log(`   - ${row.tablename}`);
      });
      console.log();
    } else {
      console.log('⚠️  No tables found (migrations may not have run)\n');
    }

    // Test 6: Write Test
    console.log('Test 6: Write Test...');
    const testTable = 'test_connection_' + Date.now();
    await client.query(`CREATE TEMP TABLE ${testTable} (id INT, data TEXT)`);
    await client.query(`INSERT INTO ${testTable} VALUES (1, 'test')`);
    const writeResult = await client.query(`SELECT * FROM ${testTable}`);
    if (writeResult.rows[0].data === 'test') {
      console.log('✅ Write/Read working correctly\n');
    } else {
      console.log('❌ Write/Read test failed\n');
    }

    // Test 7: Connection Pool Info
    console.log('Test 7: Connection Info...');
    const connResult = await client.query(`
      SELECT
        count(*) as total_connections,
        max_conn
      FROM pg_stat_activity,
           (SELECT setting::int AS max_conn FROM pg_settings WHERE name='max_connections') AS mc
      GROUP BY max_conn
    `);
    if (connResult.rows.length > 0) {
      const { total_connections, max_conn } = connResult.rows[0];
      console.log(`✅ Active connections: ${total_connections}/${max_conn}\n`);
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ All PostgreSQL tests passed successfully!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (error) {
    console.error('\n❌ Test failed:');
    console.error('Error code:', error.code);
    console.error('Error message:', error.message);

    // Common errors with helpful messages
    if (error.code === '28P01') {
      console.error('\n💡 Tip: Password authentication failed. Check:');
      console.error('   - Username and password are correct');
      console.error('   - Special characters in password are URL-encoded (# → %23, & → %26)');
    } else if (error.code === 'ECONNREFUSED') {
      console.error('\n💡 Tip: Connection refused. Check:');
      console.error('   - PostgreSQL server is running');
      console.error('   - Host and port are correct');
      console.error('   - Firewall allows connections');
    } else if (error.message.includes('SSL')) {
      console.error('\n💡 Tip: SSL connection error. Try:');
      console.error('   - For local: Add ?sslmode=disable to connection string');
      console.error('   - For remote: Ensure SSL is properly configured');
    }

    process.exit(1);
  } finally {
    await client.end();
  }
}

testPostgres();
