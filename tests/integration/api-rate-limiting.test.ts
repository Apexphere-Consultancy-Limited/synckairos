// REST API Rate Limiting Integration Tests
// Tests rate limiting behavior for API endpoints

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import request from 'supertest'
import { Application } from 'express'
import { createApp } from '@/api/app'
import { SyncEngine } from '@/engine/SyncEngine'
import { RedisStateManager } from '@/state/RedisStateManager'
import { DBWriteQueue } from '@/state/DBWriteQueue'
import { createRedisClient, createRedisPubSubClient } from '@/config/redis'
import { SyncMode } from '@/types/session'
import type Redis from 'ioredis'
import { clearRateLimitKeys } from '../helpers/rateLimitHelper'

// Helper functions for generating unique IDs
const uniqueSessionId = (_suffix?: string) => uuidv4()
const uniqueParticipantId = (_name?: string) => uuidv4()

describe('REST API Rate Limiting Tests', () => {
  let app: Application
  let syncEngine: SyncEngine
  let redis: Redis
  let pubSub: Redis
  let dbQueue: DBWriteQueue
  let stateManager: RedisStateManager

  beforeAll(async () => {
    // Create Redis connections
    redis = createRedisClient()
    pubSub = createRedisPubSubClient()

    // Create DBWriteQueue
    dbQueue = new DBWriteQueue(process.env.REDIS_URL!)

    // Create RedisStateManager
    // Use unique prefix to avoid conflicts with parallel tests
    const uniquePrefix = `integration-test:${Date.now()}-${Math.random()}:`
    stateManager = new RedisStateManager(redis, pubSub, dbQueue, uniquePrefix)

    // Create SyncEngine
    syncEngine = new SyncEngine(stateManager)

    // Create Express app
    app = createApp({ syncEngine })
  })

  afterAll(async () => {
    // Cleanup connections
    await dbQueue.close()
    await redis.quit()
    await pubSub.quit()
  })

  beforeEach(async () => {
    // Clear rate limit keys to ensure test isolation
    // This prevents rate limit exhaustion in one test from affecting others
    await clearRateLimitKeys(redis)
  })

  describe('Switch Cycle Rate Limiting', () => {
    it('should return 429 when switchCycle rate limit exceeded (10 req/sec per session)', async () => {
      // Create session
      const sessionId = uniqueSessionId()
      await request(app)
        .post('/v1/sessions')
        .send({
          session_id: sessionId,
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [
            { participant_id: uniqueParticipantId(), participant_index: 0, total_time_ms: 600000 },
            { participant_id: uniqueParticipantId(), participant_index: 1, total_time_ms: 600000 },
          ],
          total_time_ms: 1200000,
        })
        .expect(201)

      // Start session
      await request(app).post(`/v1/sessions/${sessionId}/start`).expect(200)

      // Make 11 requests rapidly (limit is 10 req/sec per session)
      const requests = []
      for (let i = 0; i < 11; i++) {
        requests.push(request(app).post(`/v1/sessions/${sessionId}/switch`))
      }

      const responses = await Promise.all(requests)
      const rateLimited = responses.filter(r => r.status === 429)
      const successful = responses.filter(r => r.status === 200)

      // At least one request should be rate limited
      expect(rateLimited.length).toBeGreaterThan(0)
      expect(successful.length).toBeLessThanOrEqual(10)

      // Verify 429 response structure
      expect(rateLimited[0].body.error).toBeDefined()
      expect(rateLimited[0].body.error.code).toBe('RATE_LIMIT_EXCEEDED')
      expect(rateLimited[0].body.error.message).toContain('Too many cycle switches')
      expect(rateLimited[0].body.error.retry_after_seconds).toBe(1)
    })

    it('should reset rate limit after window expires', async () => {
      const sessionId = uniqueSessionId()

      // Create and start session
      await request(app)
        .post('/v1/sessions')
        .send({
          session_id: sessionId,
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [
            { participant_id: uniqueParticipantId(), participant_index: 0, total_time_ms: 600000 },
            { participant_id: uniqueParticipantId(), participant_index: 1, total_time_ms: 600000 },
          ],
          total_time_ms: 1200000,
        })
      await request(app).post(`/v1/sessions/${sessionId}/start`)

      // Hit rate limit
      const requests1 = Array.from({ length: 11 }, () =>
        request(app).post(`/v1/sessions/${sessionId}/switch`)
      )
      const responses1 = await Promise.all(requests1)
      const rateLimited1 = responses1.filter(r => r.status === 429)
      expect(rateLimited1.length).toBeGreaterThan(0)

      // Wait for rate limit window to reset (1 second)
      await new Promise(resolve => setTimeout(resolve, 1100))

      // Should succeed after reset
      const response = await request(app)
        .post(`/v1/sessions/${sessionId}/switch`)
        .expect(200)

      expect(response.body.data).toBeDefined()
    })

    it('should apply rate limit per session (different sessions independent)', async () => {
      const session1Id = uniqueSessionId()
      const session2Id = uniqueSessionId()

      // Create two sessions
      for (const sessionId of [session1Id, session2Id]) {
        await request(app)
          .post('/v1/sessions')
          .send({
            session_id: sessionId,
            sync_mode: SyncMode.PER_PARTICIPANT,
            participants: [
              { participant_id: uniqueParticipantId(), participant_index: 0, total_time_ms: 600000 },
              { participant_id: uniqueParticipantId(), participant_index: 1, total_time_ms: 600000 },
            ],
            total_time_ms: 1200000,
          })
        await request(app).post(`/v1/sessions/${sessionId}/start`)
      }

      // Exhaust rate limit for session1
      const requests1 = Array.from({ length: 11 }, () =>
        request(app).post(`/v1/sessions/${session1Id}/switch`)
      )
      await Promise.all(requests1)

      // Session2 should NOT be rate limited
      const response = await request(app)
        .post(`/v1/sessions/${session2Id}/switch`)
        .expect(200)

      // Should have switched to a participant (could be p1 or p2 depending on start)
      expect(response.body.data.active_participant_id).toBeDefined()
    })
  })

  describe('General Rate Limiting', () => {
    it('should return 429 when general rate limit exceeded (100 req/min per IP)', async () => {
      // Make 101 requests rapidly to /v1/time endpoint
      // (Using /v1/time to avoid session setup overhead)
      const requests = Array.from({ length: 101 }, () =>
        request(app).get('/v1/time')
      )

      const responses = await Promise.all(requests)
      const rateLimited = responses.filter(r => r.status === 429)
      const successful = responses.filter(r => r.status === 200)

      // At least one request should be rate limited
      expect(rateLimited.length).toBeGreaterThan(0)
      expect(successful.length).toBeLessThanOrEqual(100)

      // Verify 429 response structure
      expect(rateLimited[0].body.error).toBeDefined()
      expect(rateLimited[0].body.error.code).toBe('RATE_LIMIT_EXCEEDED')
      expect(rateLimited[0].body.error.message).toContain('Too many requests')
      expect(rateLimited[0].body.error.retry_after_seconds).toBe(60)
    })

    it('should NOT rate limit health/metrics endpoints', async () => {
      // Make 150 requests to /health (exceeds general limit)
      const requests = Array.from({ length: 150 }, () =>
        request(app).get('/health')
      )

      const responses = await Promise.all(requests)
      const allSuccessful = responses.every(r => r.status === 200)

      // All should succeed (health endpoints exempt from rate limiting)
      expect(allSuccessful).toBe(true)
    })

    it('should NOT rate limit /metrics endpoint', async () => {
      // Make 150 requests to /metrics (exceeds general limit)
      const requests = Array.from({ length: 150 }, () =>
        request(app).get('/metrics')
      )

      const responses = await Promise.all(requests)
      const allSuccessful = responses.every(r => r.status === 200)

      // All should succeed (metrics endpoints exempt from rate limiting)
      expect(allSuccessful).toBe(true)
    })
  })

  describe('Rate Limit Headers', () => {
    it('should include rate limit headers in response', async () => {
      const sessionId = uniqueSessionId()

      // Create session - verify it succeeds
      const createRes = await request(app)
        .post('/v1/sessions')
        .send({
          session_id: sessionId,
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [
            { participant_id: uniqueParticipantId(), participant_index: 0, total_time_ms: 600000 },
            { participant_id: uniqueParticipantId(), participant_index: 1, total_time_ms: 600000 },
          ],
          total_time_ms: 1200000,
        })
        .expect(201)

      // Start session - verify it succeeds
      await request(app)
        .post(`/v1/sessions/${sessionId}/start`)
        .expect(200)

      // Make a switch request (should succeed with clean rate limits)
      const response = await request(app)
        .post(`/v1/sessions/${sessionId}/switch`)
        .expect(200)

      // Check for RateLimit-* headers
      expect(response.headers['ratelimit-limit']).toBeDefined()
      expect(response.headers['ratelimit-remaining']).toBeDefined()
      expect(response.headers['ratelimit-reset']).toBeDefined()
    })
  })
})
