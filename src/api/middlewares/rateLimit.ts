// Rate Limiter Middleware
// Redis-backed rate limiting for API endpoints
//
// Two limiters:
// 1. General limiter: 100 req/min per IP (all routes) - 500 req/min in test/dev
// 2. Switch cycle limiter: 10 req/sec per session (hot path protection)
//
// Test Environment Handling:
// - Uses Redis DB 1 (isolated from production DB 0)
// - Higher limits (500 req/min) to prevent false failures
// - Session-based keys for test isolation between parallel workers

import rateLimit from 'express-rate-limit'
import RedisStore from 'rate-limit-redis'
import { createRedisClient } from '@/config/redis'
import { createComponentLogger } from '@/utils/logger'

const logger = createComponentLogger('RateLimit')

// Determine if we're in test/development mode
const isTestOrDev = process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development'

// In test mode, use process PID to isolate rate limits between parallel test processes
// This prevents rate limit exhaustion in one test file from affecting others
const TEST_WORKER_ID = isTestOrDev ? `w${process.pid}:` : ''

// Configurable rate limits via environment variables
const GENERAL_RATE_LIMIT = parseInt(process.env.RATE_LIMIT_GENERAL || '100', 10)
const SWITCH_RATE_LIMIT = parseInt(process.env.RATE_LIMIT_SWITCH || '10', 10)
const RATE_LIMIT_REDIS_DB = parseInt(
  process.env.RATE_LIMIT_REDIS_DB || (isTestOrDev ? '1' : '0'),
  10
)

logger.info(
  {
    generalLimit: `${GENERAL_RATE_LIMIT} req/min`,
    switchLimit: `${SWITCH_RATE_LIMIT} req/sec`,
    redisDB: RATE_LIMIT_REDIS_DB,
    mode: process.env.NODE_ENV,
  },
  'Rate limiter configuration'
)

// Create dedicated Redis client for rate limiting
// Use configured Redis DB (default: DB 1 for test/dev, DB 0 for production)
const redisClient = createRedisClient()
if (RATE_LIMIT_REDIS_DB !== 0) {
  redisClient.select(RATE_LIMIT_REDIS_DB)
  logger.info(`Using Redis DB ${RATE_LIMIT_REDIS_DB} for rate limiting`)
}

/**
 * General rate limiter
 *
 * Limits:
 * - Production: 100 requests per minute per IP
 * - Test/Dev: 500 requests per minute (per session if available, otherwise per IP)
 *
 * Applies to all API routes except /health and /metrics
 *
 * Stored in Redis with key: rl:general:<ip> or rl:general:test:<sessionId>
 */
export const generalLimiter = rateLimit({
  store: new RedisStore({
    // @ts-expect-error - Types mismatch between ioredis and rate-limit-redis
    sendCommand: (...args: string[]) => redisClient.call(...args),
    prefix: 'rl:general:',
  }),
  windowMs: 60 * 1000, // 1 minute
  max: GENERAL_RATE_LIMIT, // Configurable via RATE_LIMIT_GENERAL env var
  standardHeaders: true, // Return rate limit info in RateLimit-* headers
  legacyHeaders: false, // Disable X-RateLimit-* headers

  // Smart key generator for test isolation
  keyGenerator: req => {
    // In test/dev: Use session ID from URL to isolate parallel test workers
    if (isTestOrDev) {
      // Extract session ID from path like /v1/sessions/:id or /v1/sessions/:id/start
      const sessionMatch = req.path.match(/\/v1\/sessions\/([a-zA-Z0-9-]+)/)
      if (sessionMatch) {
        const sessionId = sessionMatch[1]
        return `${TEST_WORKER_ID}test:${sessionId}` // Each session gets its own rate limit bucket
      }
      // Fallback to IP for non-session routes (like POST /v1/sessions)
      return `${TEST_WORKER_ID}test:${req.ip}`
    }
    // Production: Use IP address
    return req.ip || 'unknown'
  },

  // Disable validations for custom key generator (we handle our own logic)
  validate: false,

  handler: (_req, res) => {
    logger.warn({ ip: _req.ip, path: _req.path }, 'General rate limit exceeded')
    res.status(429).json({
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests, please try again later',
        retry_after_seconds: 60,
      },
    })
  },
})

/**
 * Switch cycle rate limiter
 *
 * Limits: 10 requests per second per session
 * Applies ONLY to POST /v1/sessions/:id/switch endpoint
 *
 * This prevents abuse of the hot path by limiting how fast
 * a single session can cycle through participants.
 *
 * Stored in Redis with key: rl:switch:<sessionId>
 */
export const switchCycleLimiter = rateLimit({
  store: new RedisStore({
    // @ts-expect-error - Types mismatch between ioredis and rate-limit-redis
    sendCommand: (...args: string[]) => redisClient.call(...args),
    prefix: 'rl:switch:',
  }),
  windowMs: 1000, // 1 second
  max: SWITCH_RATE_LIMIT, // Configurable via RATE_LIMIT_SWITCH env var
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => {
    // Use session ID as rate limit key
    const sessionId = req.params.id || 'unknown'
    // In test mode, prefix with worker ID to isolate parallel test processes
    return isTestOrDev ? `${TEST_WORKER_ID}${sessionId}` : sessionId
  },
  skipSuccessfulRequests: false, // Count all requests, not just failed ones
  handler: (req, res) => {
    logger.warn({ session_id: req.params.id }, 'Switch cycle rate limit exceeded')
    res.status(429).json({
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many cycle switches for this session, please slow down',
        retry_after_seconds: 1,
      },
    })
  },
})

logger.info('Rate limiters initialized')
