// Test helper for managing rate limits in integration tests
// Ensures test isolation by clearing rate limit keys between tests

import type Redis from 'ioredis'

/**
 * Clears all rate limit keys from Redis
 *
 * This prevents rate limit exhaustion in one test from affecting others.
 * Rate limit keys follow the pattern: rl:general:<ip> or rl:switch:<sessionId>
 *
 * @param redis - Redis client instance
 */
export async function clearRateLimitKeys(redis: Redis): Promise<void> {
  const rateLimitKeys = await redis.keys('rl:*')
  if (rateLimitKeys.length > 0) {
    await redis.del(...rateLimitKeys)
  }
}
