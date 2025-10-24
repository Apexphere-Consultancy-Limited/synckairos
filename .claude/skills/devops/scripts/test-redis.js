#!/usr/bin/env node

/**
 * Redis Connection Test Script
 * Tests Redis connectivity and validates configuration
 * Usage: node test-redis.js [redis-url]
 */

import { createClient } from 'redis';
import { config } from 'dotenv';

config();

const REDIS_URL = process.argv[2] || process.env.REDIS_URL;

if (!REDIS_URL) {
  console.error('❌ ERROR: REDIS_URL not provided');
  console.error('Usage: node test-redis.js [redis-url]');
  console.error('   or: REDIS_URL=... node test-redis.js');
  process.exit(1);
}

async function testRedis() {
  console.log('🔍 Testing Redis Connection...\n');
  console.log(`URL: ${REDIS_URL.replace(/:[^:@]+@/, ':****@')}\n`);

  const client = createClient({
    url: REDIS_URL,
    socket: {
      connectTimeout: 10000,
      reconnectStrategy: false
    }
  });

  client.on('error', (err) => {
    console.error('❌ Redis Client Error:', err.message);
  });

  try {
    // Test 1: Connection
    console.log('Test 1: Connection...');
    await client.connect();
    console.log('✅ Connected successfully\n');

    // Test 2: PING
    console.log('Test 2: PING...');
    const pong = await client.ping();
    console.log(`✅ PING response: ${pong}\n`);

    // Test 3: SET/GET
    console.log('Test 3: SET/GET...');
    const testKey = 'test:connection:' + Date.now();
    const testValue = 'Hello from SyncKairos';
    await client.set(testKey, testValue, { EX: 60 });
    const retrieved = await client.get(testKey);
    if (retrieved === testValue) {
      console.log('✅ SET/GET working correctly\n');
    } else {
      console.log('❌ SET/GET mismatch\n');
    }
    await client.del(testKey);

    // Test 4: INFO
    console.log('Test 4: Server Info...');
    const info = await client.info('server');
    const version = info.match(/redis_version:([^\r\n]+)/)?.[1];
    console.log(`✅ Redis version: ${version}\n`);

    // Test 5: Memory
    console.log('Test 5: Memory Info...');
    const memory = await client.info('memory');
    const usedMemory = memory.match(/used_memory_human:([^\r\n]+)/)?.[1];
    const maxMemory = memory.match(/maxmemory_human:([^\r\n]+)/)?.[1];
    console.log(`✅ Used memory: ${usedMemory}`);
    console.log(`✅ Max memory: ${maxMemory || 'unlimited'}\n`);

    // Test 6: Eviction Policy
    console.log('Test 6: Eviction Policy...');
    const config = await client.configGet('maxmemory-policy');
    const policy = config['maxmemory-policy'];
    if (policy === 'noeviction') {
      console.log('✅ Eviction policy: noeviction (RECOMMENDED)\n');
    } else {
      console.log(`⚠️  Eviction policy: ${policy} (Should be "noeviction" for state storage)\n`);
    }

    // Test 7: Latency
    console.log('Test 7: Latency Test...');
    const start = Date.now();
    await client.ping();
    const latency = Date.now() - start;
    console.log(`✅ Ping latency: ${latency}ms\n`);

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ All Redis tests passed successfully!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  } finally {
    await client.quit();
  }
}

testRedis();
