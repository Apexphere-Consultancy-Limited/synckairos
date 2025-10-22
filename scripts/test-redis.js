#!/usr/bin/env node

/**
 * Redis Connection Test Script
 * Tests connectivity and basic operations for Upstash Redis
 */

import Redis from 'ioredis';
import { config } from 'dotenv';

// Load environment variables
config({ path: '.env.production' });

const REDIS_URL = process.env.REDIS_URL;

if (!REDIS_URL) {
  console.error('❌ REDIS_URL not found in environment variables');
  process.exit(1);
}

console.log('🔍 Testing Redis Connection...\n');
console.log(`📍 URL: ${REDIS_URL.replace(/\/\/[^@]+@/, '//***:***@')}\n`);

const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => {
    if (times > 3) {
      console.error('❌ Max retries exceeded');
      return null;
    }
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  tls: REDIS_URL.startsWith('rediss://') ? {} : undefined,
});

async function testRedis() {
  try {
    // Test 1: Connection
    console.log('📝 Test 1: Connection');
    const pingResult = await redis.ping();
    console.log(`   ✅ PING: ${pingResult}`);

    // Test 2: Set/Get
    console.log('\n📝 Test 2: SET/GET');
    await redis.set('test:connection', 'success', 'EX', 10);
    const value = await redis.get('test:connection');
    console.log(`   ✅ SET/GET: ${value}`);

    // Test 3: Hash operations (used by RedisStateManager)
    console.log('\n📝 Test 3: Hash Operations (HSET/HGET)');
    await redis.hset('test:session:123', {
      userId: 'user_456',
      deviceId: 'device_789',
      lastSync: Date.now(),
    });
    const sessionData = await redis.hgetall('test:session:123');
    console.log(`   ✅ HSET/HGETALL: ${JSON.stringify(sessionData)}`);

    // Test 4: List operations (used by DeviceQueue)
    console.log('\n📝 Test 4: List Operations (LPUSH/LRANGE)');
    await redis.lpush('test:queue', 'task1', 'task2', 'task3');
    const queueItems = await redis.lrange('test:queue', 0, -1);
    console.log(`   ✅ LPUSH/LRANGE: ${queueItems.length} items`);

    // Test 5: TTL operations
    console.log('\n📝 Test 5: TTL Operations');
    await redis.setex('test:ttl', 60, 'expires in 60s');
    const ttl = await redis.ttl('test:ttl');
    console.log(`   ✅ TTL: ${ttl}s remaining`);

    // Test 6: Pub/Sub (basic test)
    console.log('\n📝 Test 6: Pub/Sub');
    const subscriber = redis.duplicate();
    await subscriber.subscribe('test:channel');

    const pubSubPromise = new Promise((resolve) => {
      subscriber.on('message', (channel, message) => {
        console.log(`   ✅ Received: ${message} on ${channel}`);
        resolve();
      });
    });

    await redis.publish('test:channel', 'Hello from SyncKairos!');
    await pubSubPromise;
    await subscriber.quit();

    // Test 7: Info
    console.log('\n📝 Test 7: Server Info');
    const info = await redis.info('server');
    const versionMatch = info.match(/redis_version:([^\r\n]+)/);
    if (versionMatch) {
      console.log(`   ✅ Redis Version: ${versionMatch[1]}`);
    }

    // Cleanup
    console.log('\n🧹 Cleaning up test keys...');
    await redis.del('test:connection', 'test:session:123', 'test:queue', 'test:ttl');
    console.log('   ✅ Cleanup complete');

    console.log('\n✅ All Redis tests passed!\n');

    await redis.quit();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Redis test failed:', error.message);
    console.error('   Stack:', error.stack);
    await redis.quit();
    process.exit(1);
  }
}

// Handle uncaught errors
process.on('unhandledRejection', (error) => {
  console.error('\n❌ Unhandled rejection:', error);
  process.exit(1);
});

testRedis();
