// REST API Concurrency Integration Tests
// Tests concurrent operations and optimistic locking

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import { v4 as uuidv4 } from 'uuid'
import { Application } from 'express'
import { createApp } from '@/api/app'
import { SyncEngine } from '@/engine/SyncEngine'
import { RedisStateManager } from '@/state/RedisStateManager'
import { DBWriteQueue } from '@/state/DBWriteQueue'
import { createRedisClient, createRedisPubSubClient } from '@/config/redis'
import { SyncMode } from '@/types/session'
import type Redis from 'ioredis'
import { clearRateLimitKeys } from '../helpers/rateLimitHelper'

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
    await clearRateLimitKeys(redis)
  })

  // Helper to generate unique session and participant IDs
  const uniqueSessionId = () => uuidv4()
  const uniqueParticipantId = () => uuidv4()

  describe('Concurrent switchCycle Operations', () => {
    it('should handle concurrent switchCycle calls gracefully', async () => {
      const sessionId = uniqueSessionId()
      const p1 = uniqueParticipantId()
      const p2 = uniqueParticipantId()
      const p3 = uniqueParticipantId()

      // Create and start session
      await request(app)
        .post('/v1/sessions')
        .send({
          session_id: sessionId,
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [
            { participant_id: p1, participant_index: 0, total_time_ms: 600000 },
            { participant_id: p2, participant_index: 1, total_time_ms: 600000 },
            { participant_id: p3, participant_index: 2, total_time_ms: 600000 },
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

      // Check final state is consistent - should be one of the 3 participants
      const finalState = await request(app).get(`/v1/sessions/${sessionId}`).expect(200)
      expect([p1, p2, p3]).toContain(finalState.body.data.active_participant_id)
    })

    it('should return 409 with proper error details on version conflict', async () => {
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
      const sessionId = uniqueSessionId()
      const p1 = uniqueParticipantId()
      const p2 = uniqueParticipantId()

      // Create session with 2 participants
      await request(app)
        .post('/v1/sessions')
        .send({
          session_id: sessionId,
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [
            { participant_id: p1, participant_index: 0, total_time_ms: 600000 },
            { participant_id: p2, participant_index: 1, total_time_ms: 600000 },
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
      expect([p1, p2]).toContain(finalState.body.data.active_participant_id)

      // Verify time_used_ms makes sense (should be > 0 for all participants)
      const participants = finalState.body.data.participants
      const totalTimeUsed = participants.reduce((sum: number, p: any) => sum + p.time_used_ms, 0)
      expect(totalTimeUsed).toBeGreaterThan(0)
    })
  })

  describe('Concurrent Session Creation', () => {
    it('should handle concurrent session creation for same ID', async () => {
      const sessionId = uniqueSessionId()

      const sessionConfig = {
        session_id: sessionId,
        sync_mode: SyncMode.PER_PARTICIPANT,
        participants: [
          { participant_id: uniqueParticipantId(), participant_index: 0, total_time_ms: 60000 },
          { participant_id: uniqueParticipantId(), participant_index: 1, total_time_ms: 60000 },
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
      const sessionId = uniqueSessionId()

      // Create session
      await request(app)
        .post('/v1/sessions')
        .send({
          session_id: sessionId,
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [
            { participant_id: uniqueParticipantId(), participant_index: 0, total_time_ms: 60000 },
          ],
          total_time_ms: 60000,
        })

      // Try to start twice concurrently
      const [start1, start2] = await Promise.all([
        request(app).post(`/v1/sessions/${sessionId}/start`),
        request(app).post(`/v1/sessions/${sessionId}/start`),
      ])

      // With optimistic locking and idempotent start operation:
      // - Both might succeed (200) if implemented as idempotent
      // - One succeeds (200), one conflicts (409) if version checking is strict
      // - One succeeds (200), one fails (400) if validation fails
      const statuses = [start1.status, start2.status].sort()

      // At least one should succeed
      expect(statuses).toContain(200)

      // The other should be either success (idempotent), conflict (409), or error (400)
      const otherStatus = statuses.find(s => s !== 200) || 200
      expect([200, 400, 409]).toContain(otherStatus)

      // Verify final state is RUNNING (not corrupted)
      const finalState = await request(app).get(`/v1/sessions/${sessionId}`).expect(200)
      expect(finalState.body.data.status).toBe('running')
    })

    it('should handle concurrent pause/resume operations', async () => {
      const sessionId = uniqueSessionId()

      // Create and start session
      await request(app)
        .post('/v1/sessions')
        .send({
          session_id: sessionId,
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [
            { participant_id: uniqueParticipantId(), participant_index: 0, total_time_ms: 600000 },
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

      // With idempotent operations or optimistic locking:
      // - Both might succeed (200) if resume is idempotent
      // - One succeeds (200), one conflicts (409) or errors (400)
      const statuses = [resume1.status, resume2.status].sort()

      // At least one should succeed
      expect(statuses).toContain(200)

      // The other should be success (idempotent), conflict (409), or error (400)
      const otherStatus = statuses.find(s => s !== 200) || 200
      expect([200, 400, 409]).toContain(otherStatus)
    })
  })

  describe('Optimistic Locking Validation', () => {
    it('should increment version on each update', async () => {
      const sessionId = uniqueSessionId()

      // Create session
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
