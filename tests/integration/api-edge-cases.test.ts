// REST API Edge Cases Integration Tests
// Tests edge cases and boundary conditions

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import { Application } from 'express'
import { createApp } from '@/api/app'
import { SyncEngine } from '@/engine/SyncEngine'
import { RedisStateManager } from '@/state/RedisStateManager'
import { DBWriteQueue } from '@/state/DBWriteQueue'
import { createRedisClient, createRedisPubSubClient } from '@/config/redis'
import { SyncMode } from '@/types/session'
import type Redis from 'ioredis'

describe('REST API Edge Cases Tests', () => {
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
    stateManager = new RedisStateManager(redis, pubSub, dbQueue)

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
    // Clear Redis before each test
    await redis.flushdb()
  })

  describe('Participant Expiration', () => {
    it('should handle participant time expiration correctly', async () => {
      const sessionId = '550e8400-e29b-41d4-a716-446655440300'

      // Create session with very short time for p1
      await request(app)
        .post('/v1/sessions')
        .send({
          session_id: sessionId,
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [
            { participant_id: 'p1', participant_index: 0, total_time_ms: 100 }, // 100ms only
            { participant_id: 'p2', participant_index: 1, total_time_ms: 60000 },
          ],
          total_time_ms: 60100,
        })
        .expect(201)

      await request(app).post(`/v1/sessions/${sessionId}/start`).expect(200)

      // Wait for p1 to expire
      await new Promise(resolve => setTimeout(resolve, 200))

      // Switch cycle
      const switchRes = await request(app)
        .post(`/v1/sessions/${sessionId}/switch`)
        .expect(200)

      // Verify p1 expired
      expect(switchRes.body.data.expired_participant_id).toBe('p1')
      expect(switchRes.body.data.participants[0].has_expired).toBe(true)
      expect(switchRes.body.data.participants[0].total_time_ms).toBe(0)
      expect(switchRes.body.data.active_participant_id).toBe('p2')
    })

    it('should not add increment time to expired participant', async () => {
      const sessionId = '550e8400-e29b-41d4-a716-446655440301'

      // Create session with increment and short time
      await request(app)
        .post('/v1/sessions')
        .send({
          session_id: sessionId,
          sync_mode: SyncMode.PER_PARTICIPANT,
          increment_ms: 5000, // Add 5 seconds per turn
          participants: [
            { participant_id: 'p1', participant_index: 0, total_time_ms: 100 },
            { participant_id: 'p2', participant_index: 1, total_time_ms: 60000 },
          ],
          total_time_ms: 60100,
        })

      await request(app).post(`/v1/sessions/${sessionId}/start`)
      await new Promise(resolve => setTimeout(resolve, 200))

      const switchRes = await request(app).post(`/v1/sessions/${sessionId}/switch`).expect(200)

      // Expired participant should have 0 time (not 5000 from increment)
      expect(switchRes.body.data.participants[0].total_time_ms).toBe(0)
    })
  })

  describe('Invalid Input Validation', () => {
    it('should reject invalid UUID format', async () => {
      const response = await request(app)
        .post('/v1/sessions')
        .send({
          session_id: 'not-a-uuid',
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [
            { participant_id: 'p1', participant_index: 0, total_time_ms: 60000 },
          ],
          total_time_ms: 60000,
        })
        .expect(400)

      expect(response.body.error.code).toBe('VALIDATION_ERROR')
      expect(response.body.error.message).toContain('Invalid session_id format')
    })

    it('should reject empty participants array', async () => {
      const response = await request(app)
        .post('/v1/sessions')
        .send({
          session_id: '550e8400-e29b-41d4-a716-446655440302',
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [],
          total_time_ms: 60000,
        })
        .expect(400)

      expect(response.body.error.code).toBe('VALIDATION_ERROR')
      expect(response.body.error.message).toContain('participants required')
    })

    it('should reject negative time values', async () => {
      const response = await request(app)
        .post('/v1/sessions')
        .send({
          session_id: '550e8400-e29b-41d4-a716-446655440303',
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [
            { participant_id: 'p1', participant_index: 0, total_time_ms: -1000 },
          ],
          total_time_ms: -1000,
        })
        .expect(400)

      expect(response.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('should reject time values below minimum (1 second)', async () => {
      const response = await request(app)
        .post('/v1/sessions')
        .send({
          session_id: '550e8400-e29b-41d4-a716-446655440304',
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [
            { participant_id: 'p1', participant_index: 0, total_time_ms: 500 }, // <1 second
          ],
          total_time_ms: 500,
        })
        .expect(400)

      expect(response.body.error.message).toContain('at least 1000ms')
    })

    it('should reject duplicate participant IDs', async () => {
      const response = await request(app)
        .post('/v1/sessions')
        .send({
          session_id: '550e8400-e29b-41d4-a716-446655440305',
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [
            { participant_id: 'p1', participant_index: 0, total_time_ms: 60000 },
            { participant_id: 'p1', participant_index: 1, total_time_ms: 60000 }, // Duplicate
          ],
          total_time_ms: 120000,
        })
        .expect(400)

      expect(response.body.error.message).toContain('Duplicate participant_id')
    })
  })

  describe('Boundary Conditions', () => {
    it('should handle single participant session', async () => {
      const sessionId = '550e8400-e29b-41d4-a716-446655440306'

      await request(app)
        .post('/v1/sessions')
        .send({
          session_id: sessionId,
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [
            { participant_id: 'p1', participant_index: 0, total_time_ms: 60000 },
          ],
          total_time_ms: 60000,
        })
        .expect(201)

      await request(app).post(`/v1/sessions/${sessionId}/start`).expect(200)

      // Switch should work (cycles back to p1)
      const switchRes = await request(app)
        .post(`/v1/sessions/${sessionId}/switch`)
        .expect(200)

      expect(switchRes.body.data.active_participant_id).toBe('p1')
    })

    it('should handle large participant count (100+)', async () => {
      const sessionId = '550e8400-e29b-41d4-a716-446655440307'

      const participants = Array.from({ length: 100 }, (_, i) => ({
        participant_id: `p${i}`,
        participant_index: i,
        total_time_ms: 60000,
      }))

      const response = await request(app)
        .post('/v1/sessions')
        .send({
          session_id: sessionId,
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants,
          total_time_ms: 6000000,
        })
        .expect(201)

      expect(response.body.data.participants).toHaveLength(100)

      // Verify can start and switch
      await request(app).post(`/v1/sessions/${sessionId}/start`).expect(200)
      const switchRes = await request(app)
        .post(`/v1/sessions/${sessionId}/switch`)
        .expect(200)

      expect(switchRes.body.data.active_participant_id).toBe('p1')
    })

    it('should handle very short cycle times (100ms)', async () => {
      const sessionId = '550e8400-e29b-41d4-a716-446655440308'

      await request(app)
        .post('/v1/sessions')
        .send({
          session_id: sessionId,
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [
            { participant_id: 'p1', participant_index: 0, total_time_ms: 1000 },
            { participant_id: 'p2', participant_index: 1, total_time_ms: 1000 },
          ],
          total_time_ms: 2000,
        })

      await request(app).post(`/v1/sessions/${sessionId}/start`)
      await new Promise(resolve => setTimeout(resolve, 150))

      const switchRes = await request(app).post(`/v1/sessions/${sessionId}/switch`).expect(200)

      expect(switchRes.body.data.participants[0].time_used_ms).toBeGreaterThan(100)
      expect(switchRes.body.data.participants[0].time_used_ms).toBeLessThan(200)
    })

    it('should handle maximum time values (24 hours)', async () => {
      const sessionId = '550e8400-e29b-41d4-a716-446655440309'
      const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000

      const response = await request(app)
        .post('/v1/sessions')
        .send({
          session_id: sessionId,
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [
            { participant_id: 'p1', participant_index: 0, total_time_ms: TWENTY_FOUR_HOURS },
          ],
          total_time_ms: TWENTY_FOUR_HOURS,
        })
        .expect(201)

      expect(response.body.data.participants[0].total_time_ms).toBe(TWENTY_FOUR_HOURS)
    })
  })

  describe('Invalid State Transitions', () => {
    it('should reject switching a paused session', async () => {
      const sessionId = '550e8400-e29b-41d4-a716-446655440310'

      // Create, start, then pause
      await request(app)
        .post('/v1/sessions')
        .send({
          session_id: sessionId,
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [
            { participant_id: 'p1', participant_index: 0, total_time_ms: 60000 },
            { participant_id: 'p2', participant_index: 1, total_time_ms: 60000 },
          ],
          total_time_ms: 120000,
        })
      await request(app).post(`/v1/sessions/${sessionId}/start`)
      await request(app).post(`/v1/sessions/${sessionId}/pause`)

      // Try to switch while paused
      const response = await request(app)
        .post(`/v1/sessions/${sessionId}/switch`)
        .expect(400)

      expect(response.body.error.code).toBe('INVALID_STATE_TRANSITION')
      expect(response.body.error.message).toContain('not running')
    })

    it('should reject pausing a completed session', async () => {
      const sessionId = '550e8400-e29b-41d4-a716-446655440311'

      // Create, start, complete
      await request(app)
        .post('/v1/sessions')
        .send({
          session_id: sessionId,
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [
            { participant_id: 'p1', participant_index: 0, total_time_ms: 60000 },
          ],
          total_time_ms: 60000,
        })
      await request(app).post(`/v1/sessions/${sessionId}/start`)
      await request(app).post(`/v1/sessions/${sessionId}/complete`)

      // Try to pause completed session
      const response = await request(app)
        .post(`/v1/sessions/${sessionId}/pause`)
        .expect(400)

      expect(response.body.error.code).toBe('INVALID_STATE_TRANSITION')
    })

    it('should reject resuming a running session', async () => {
      const sessionId = '550e8400-e29b-41d4-a716-446655440312'

      // Create and start
      await request(app)
        .post('/v1/sessions')
        .send({
          session_id: sessionId,
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [
            { participant_id: 'p1', participant_index: 0, total_time_ms: 60000 },
          ],
          total_time_ms: 60000,
        })
      await request(app).post(`/v1/sessions/${sessionId}/start`)

      // Try to resume while already running
      const response = await request(app)
        .post(`/v1/sessions/${sessionId}/resume`)
        .expect(400)

      expect(response.body.error.code).toBe('INVALID_STATE_TRANSITION')
      expect(response.body.error.message).toContain('cannot be resumed')
    })

    it('should allow operations on completed session (GET only)', async () => {
      const sessionId = '550e8400-e29b-41d4-a716-446655440313'

      // Create, start, complete
      await request(app)
        .post('/v1/sessions')
        .send({
          session_id: sessionId,
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [
            { participant_id: 'p1', participant_index: 0, total_time_ms: 60000 },
          ],
          total_time_ms: 60000,
        })
      await request(app).post(`/v1/sessions/${sessionId}/start`)
      await request(app).post(`/v1/sessions/${sessionId}/complete`)

      // GET should still work
      const getRes = await request(app).get(`/v1/sessions/${sessionId}`).expect(200)
      expect(getRes.body.data.status).toBe('completed')

      // DELETE should work
      await request(app).delete(`/v1/sessions/${sessionId}`).expect(204)
    })
  })

  describe('Special Characters and Unicode', () => {
    it('should handle participant IDs with special characters', async () => {
      const sessionId = '550e8400-e29b-41d4-a716-446655440314'

      const response = await request(app)
        .post('/v1/sessions')
        .send({
          session_id: sessionId,
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [
            { participant_id: 'user@example.com', participant_index: 0, total_time_ms: 60000 },
            { participant_id: 'user-123_456', participant_index: 1, total_time_ms: 60000 },
            { participant_id: 'user.name', participant_index: 2, total_time_ms: 60000 },
          ],
          total_time_ms: 180000,
        })
        .expect(201)

      expect(response.body.data.participants).toHaveLength(3)
    })

    it('should handle Unicode participant IDs', async () => {
      const sessionId = '550e8400-e29b-41d4-a716-446655440315'

      const response = await request(app)
        .post('/v1/sessions')
        .send({
          session_id: sessionId,
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [
            { participant_id: 'ユーザー1', participant_index: 0, total_time_ms: 60000 },
            { participant_id: 'пользователь2', participant_index: 1, total_time_ms: 60000 },
          ],
          total_time_ms: 120000,
        })
        .expect(201)

      expect(response.body.data.participants[0].participant_id).toBe('ユーザー1')
      expect(response.body.data.participants[1].participant_id).toBe('пользователь2')
    })
  })
})
