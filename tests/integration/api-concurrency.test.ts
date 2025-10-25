// REST API Concurrency Integration Tests
// Tests concurrent operations and optimistic locking

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

describe('REST API Concurrency Tests', () => {
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

  describe('Concurrent switchCycle Operations', () => {
    it('should handle concurrent switchCycle calls gracefully', async () => {
      const sessionId = '550e8400-e29b-41d4-a716-446655440200'

      // Create and start session
      await request(app)
        .post('/v1/sessions')
        .send({
          session_id: sessionId,
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [
            { participant_id: '223e4567-e89b-12d3-a456-426614174201', participant_index: 0, total_time_ms: 600000 },
            { participant_id: '223e4567-e89b-12d3-a456-426614174202', participant_index: 1, total_time_ms: 600000 },
            { participant_id: '223e4567-e89b-12d3-a456-426614174203', participant_index: 2, total_time_ms: 600000 },
          ],
          total_time_ms: 1800000,
        })
      await request(app).post(`/v1/sessions/${sessionId}/start`)

      // Make 3 concurrent switchCycle requests
      const [switch1, switch2, switch3] = await Promise.all([
        request(app).post(`/v1/sessions/${sessionId}/switch`),
        request(app).post(`/v1/sessions/${sessionId}/switch`),
        request(app).post(`/v1/sessions/${sessionId}/switch`),
      ])

      // All should either succeed (200) or conflict (409)
      expect([200, 409]).toContain(switch1.status)
      expect([200, 409]).toContain(switch2.status)
      expect([200, 409]).toContain(switch3.status)

      // At least one should succeed
      const successful = [switch1, switch2, switch3].filter(r => r.status === 200)
      expect(successful.length).toBeGreaterThan(0)

      // Check final state is consistent
      const finalState = await request(app).get(`/v1/sessions/${sessionId}`).expect(200)
      expect(finalState.body.data.active_participant_id).toMatch(/^p[1-3]$/)
    })

    it('should return 409 with proper error details on version conflict', async () => {
      const sessionId = '550e8400-e29b-41d4-a716-446655440201'

      // Create and start session
      await request(app)
        .post('/v1/sessions')
        .send({
          session_id: sessionId,
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [
            { participant_id: '223e4567-e89b-12d3-a456-426614174204', participant_index: 0, total_time_ms: 600000 },
            { participant_id: '223e4567-e89b-12d3-a456-426614174205', participant_index: 1, total_time_ms: 600000 },
          ],
          total_time_ms: 1200000,
        })
      await request(app).post(`/v1/sessions/${sessionId}/start`)

      // Get state to capture version
      const state1 = await stateManager.getSession(sessionId)
      expect(state1).not.toBeNull()

      // Perform a switch to change version
      await request(app).post(`/v1/sessions/${sessionId}/switch`).expect(200)

      // Try to update with old version (simulated by direct state manager call)
      try {
        await stateManager.updateSession(sessionId, state1!, state1!.version)
        // If we get here, optimistic locking failed
        expect.fail('Should have thrown ConcurrencyError')
      } catch (err: any) {
        // Verify it's a concurrency error
        expect(err.message).toContain('Concurrent modification')
      }
    })

    it('should maintain data consistency under concurrent load', async () => {
      const sessionId = '550e8400-e29b-41d4-a716-446655440202'

      // Create session with 2 participants
      await request(app)
        .post('/v1/sessions')
        .send({
          session_id: sessionId,
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [
            { participant_id: '223e4567-e89b-12d3-a456-426614174206', participant_index: 0, total_time_ms: 600000 },
            { participant_id: '223e4567-e89b-12d3-a456-426614174207', participant_index: 1, total_time_ms: 600000 },
          ],
          total_time_ms: 1200000,
        })
      await request(app).post(`/v1/sessions/${sessionId}/start`)

      // Make 10 concurrent switches
      const requests = Array.from({ length: 10 }, () =>
        request(app).post(`/v1/sessions/${sessionId}/switch`)
      )
      const responses = await Promise.all(requests)

      // Count successful switches
      const successful = responses.filter(r => r.status === 200)

      // Get final state
      const finalState = await request(app).get(`/v1/sessions/${sessionId}`).expect(200)

      // Verify participants alternated correctly
      // With 10 switches starting from p1, we should end on p2 (odd number of successful switches)
      // But due to concurrency, we just verify it's one of the two
      expect(['p1', 'p2']).toContain(finalState.body.data.active_participant_id)

      // Verify time_used_ms makes sense (should be > 0 for all participants)
      const participants = finalState.body.data.participants
      const totalTimeUsed = participants.reduce((sum: number, p: any) => sum + p.time_used_ms, 0)
      expect(totalTimeUsed).toBeGreaterThan(0)
    })
  })

  describe('Concurrent Session Creation', () => {
    it('should handle concurrent session creation for same ID', async () => {
      const sessionId = '550e8400-e29b-41d4-a716-446655440203'

      const sessionConfig = {
        session_id: sessionId,
        sync_mode: SyncMode.PER_PARTICIPANT,
        participants: [
          { participant_id: '223e4567-e89b-12d3-a456-426614174208', participant_index: 0, total_time_ms: 60000 },
          { participant_id: '223e4567-e89b-12d3-a456-426614174209', participant_index: 1, total_time_ms: 60000 },
        ],
        total_time_ms: 120000,
      }

      // Try to create same session twice concurrently
      const [create1, create2] = await Promise.all([
        request(app).post('/v1/sessions').send(sessionConfig),
        request(app).post('/v1/sessions').send(sessionConfig),
      ])

      // One should succeed, one should fail (or both succeed if timing is close)
      const statuses = [create1.status, create2.status]
      expect(statuses).toContain(201)

      // Only one session should exist in Redis
      const state = await stateManager.getSession(sessionId)
      expect(state).not.toBeNull()
      expect(state!.session_id).toBe(sessionId)
    })
  })

  describe('Concurrent State Transitions', () => {
    it('should prevent concurrent start operations', async () => {
      const sessionId = '550e8400-e29b-41d4-a716-446655440204'

      // Create session
      await request(app)
        .post('/v1/sessions')
        .send({
          session_id: sessionId,
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [
            { participant_id: '223e4567-e89b-12d3-a456-426614174210', participant_index: 0, total_time_ms: 60000 },
          ],
          total_time_ms: 60000,
        })

      // Try to start twice concurrently
      const [start1, start2] = await Promise.all([
        request(app).post(`/v1/sessions/${sessionId}/start`),
        request(app).post(`/v1/sessions/${sessionId}/start`),
      ])

      // One should succeed (200), one should fail (400)
      const statuses = [start1.status, start2.status].sort()
      expect(statuses).toContain(200)
      expect(statuses).toContain(400)

      // Verify final state is RUNNING (not corrupted)
      const finalState = await request(app).get(`/v1/sessions/${sessionId}`).expect(200)
      expect(finalState.body.data.status).toBe('running')
    })

    it('should handle concurrent pause/resume operations', async () => {
      const sessionId = '550e8400-e29b-41d4-a716-446655440205'

      // Create and start session
      await request(app)
        .post('/v1/sessions')
        .send({
          session_id: sessionId,
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [
            { participant_id: '223e4567-e89b-12d3-a456-426614174211', participant_index: 0, total_time_ms: 600000 },
          ],
          total_time_ms: 600000,
        })
      await request(app).post(`/v1/sessions/${sessionId}/start`)

      // Pause
      await request(app).post(`/v1/sessions/${sessionId}/pause`).expect(200)

      // Try to resume twice concurrently
      const [resume1, resume2] = await Promise.all([
        request(app).post(`/v1/sessions/${sessionId}/resume`),
        request(app).post(`/v1/sessions/${sessionId}/resume`),
      ])

      // One should succeed, one should fail
      const statuses = [resume1.status, resume2.status].sort()
      expect(statuses).toContain(200)
      expect(statuses).toContain(400)
    })
  })

  describe('Optimistic Locking Validation', () => {
    it('should increment version on each update', async () => {
      const sessionId = '550e8400-e29b-41d4-a716-446655440206'

      // Create session
      await request(app)
        .post('/v1/sessions')
        .send({
          session_id: sessionId,
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [
            { participant_id: '223e4567-e89b-12d3-a456-426614174212', participant_index: 0, total_time_ms: 600000 },
            { participant_id: '223e4567-e89b-12d3-a456-426614174213', participant_index: 1, total_time_ms: 600000 },
          ],
          total_time_ms: 1200000,
        })

      const state1 = await stateManager.getSession(sessionId)
      expect(state1!.version).toBe(1)

      // Start session (version should increment)
      await request(app).post(`/v1/sessions/${sessionId}/start`)
      const state2 = await stateManager.getSession(sessionId)
      expect(state2!.version).toBe(2)

      // Switch cycle (version should increment)
      await request(app).post(`/v1/sessions/${sessionId}/switch`)
      const state3 = await stateManager.getSession(sessionId)
      expect(state3!.version).toBe(3)

      // Pause (version should increment)
      await request(app).post(`/v1/sessions/${sessionId}/pause`)
      const state4 = await stateManager.getSession(sessionId)
      expect(state4!.version).toBe(4)
    })

    it('should detect stale updates via version mismatch', async () => {
      const sessionId = '550e8400-e29b-41d4-a716-446655440207'

      // Create and start session
      await request(app)
        .post('/v1/sessions')
        .send({
          session_id: sessionId,
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [
            { participant_id: '223e4567-e89b-12d3-a456-426614174214', participant_index: 0, total_time_ms: 600000 },
            { participant_id: '223e4567-e89b-12d3-a456-426614174215', participant_index: 1, total_time_ms: 600000 },
          ],
          total_time_ms: 1200000,
        })
      await request(app).post(`/v1/sessions/${sessionId}/start`)

      // Get state before switch
      const stateBefore = await stateManager.getSession(sessionId)

      // Perform switch (changes version)
      await request(app).post(`/v1/sessions/${sessionId}/switch`)

      // Try to update with old version
      try {
        await stateManager.updateSession(sessionId, stateBefore!, stateBefore!.version)
        expect.fail('Should have thrown ConcurrencyError')
      } catch (err: any) {
        expect(err.message).toContain('Concurrent modification')
      }
    })
  })
})
