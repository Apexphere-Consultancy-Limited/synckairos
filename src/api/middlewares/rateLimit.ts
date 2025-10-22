// Rate Limiter Middleware
// Redis-backed rate limiting for API endpoints
//
// Two limiters:
// 1. General limiter: 100 req/min per IP (all routes)
// 2. Switch cycle limiter: 10 req/sec per session (hot path protection)

import rateLimit from 'express-rate-limit'
import RedisStore from 'rate-limit-redis'
import { createRedisClient } from '@/config/redis'
import { createComponentLogger } from '@/utils/logger'

const logger = createComponentLogger('RateLimit')

// Create dedicated Redis client for rate limiting
const redisClient = createRedisClient()

/**
 * General rate limiter
 *
 * Limits: 100 requests per minute per IP
 * Applies to all API routes except /health and /metrics
 *
 * Stored in Redis with key: rl:general:<ip>
 */
export const generalLimiter = rateLimit({
  store: new RedisStore({
    // @ts-expect-error - Types mismatch between ioredis and rate-limit-redis
    sendCommand: (...args: string[]) => redisClient.call(...args),
    prefix: 'rl:general:',
  }),
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  standardHeaders: true, // Return rate limit info in RateLimit-* headers
  legacyHeaders: false, // Disable X-RateLimit-* headers
  // Use default key generator (handles IPv6 properly)
  // keyGenerator: defaults to req.ip
  handler: (_req, res) => {
    logger.warn({ ip: _req.ip }, 'General rate limit exceeded')
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
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Use session ID as rate limit key
    const sessionId = req.params.id || 'unknown'
    return sessionId
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
