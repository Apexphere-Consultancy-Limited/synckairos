// REST API Integration Tests
// Tests full session lifecycle via HTTP endpoints

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

describe('REST API Integration Tests', () => {
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

  describe('Session Lifecycle', () => {
    it('should create a new session', async () => {
      const response = await request(app)
        .post('/v1/sessions')
        .send({
          session_id: '550e8400-e29b-41d4-a716-446655440001',
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [
            { participant_id: 'p1', participant_index: 0, total_time_ms: 60000 },
            { participant_id: 'p2', participant_index: 1, total_time_ms: 60000 },
          ],
          total_time_ms: 120000,
        })
        .expect(201)

      expect(response.body.data).toBeDefined()
      expect(response.body.data.status).toBe('pending')
      expect(response.body.data.session_id).toBe('550e8400-e29b-41d4-a716-446655440001')
      expect(response.body.data.participants).toHaveLength(2)
      expect(response.body.data.participants[0].time_used_ms).toBe(0)
      expect(response.body.data.participants[0].is_active).toBe(false)
    })

    it('should complete full session lifecycle', async () => {
      // 1. Create session
      const createRes = await request(app)
        .post('/v1/sessions')
        .send({
          session_id: '550e8400-e29b-41d4-a716-446655440002',
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [
            { participant_id: 'p1', participant_index: 0, total_time_ms: 60000 },
            { participant_id: 'p2', participant_index: 1, total_time_ms: 60000 },
          ],
          total_time_ms: 120000,
        })
        .expect(201)

      const sessionId = createRes.body.data.session_id

      // 2. Start session
      const startRes = await request(app).post(`/v1/sessions/${sessionId}/start`).expect(200)

      expect(startRes.body.data.status).toBe('running')
      expect(startRes.body.data.active_participant_id).toBe('p1')
      expect(startRes.body.data.cycle_started_at).toBeDefined()
      expect(startRes.body.data.session_started_at).toBeDefined()
      expect(startRes.body.data.participants[0].is_active).toBe(true)

      // 3. Get session state
      const getRes = await request(app).get(`/v1/sessions/${sessionId}`).expect(200)

      expect(getRes.body.data.session_id).toBe(sessionId)
      expect(getRes.body.data.status).toBe('running')

      // 4. Switch cycle
      await new Promise(resolve => setTimeout(resolve, 100)) // Wait 100ms

      const switchRes = await request(app).post(`/v1/sessions/${sessionId}/switch`).expect(200)

      expect(switchRes.body.data.active_participant_id).toBe('p2')
      expect(switchRes.body.data.participants[0].is_active).toBe(false)
      expect(switchRes.body.data.participants[1].is_active).toBe(true)
      expect(switchRes.body.data.participants[0].time_used_ms).toBeGreaterThan(90)
      expect(switchRes.body.data.participants[0].time_used_ms).toBeLessThan(150)

      // 5. Pause session
      const pauseRes = await request(app).post(`/v1/sessions/${sessionId}/pause`).expect(200)

      expect(pauseRes.body.data.status).toBe('paused')
      expect(pauseRes.body.data.cycle_started_at).toBeNull()

      // 6. Resume session
      const resumeRes = await request(app).post(`/v1/sessions/${sessionId}/resume`).expect(200)

      expect(resumeRes.body.data.status).toBe('running')
      expect(resumeRes.body.data.cycle_started_at).not.toBeNull()

      // 7. Complete session
      const completeRes = await request(app).post(`/v1/sessions/${sessionId}/complete`).expect(200)

      expect(completeRes.body.data.status).toBe('completed')
      expect(completeRes.body.data.session_completed_at).toBeDefined()
      expect(completeRes.body.data.participants.every((p: any) => !p.is_active)).toBe(true)

      // 8. Delete session
      await request(app).delete(`/v1/sessions/${sessionId}`).expect(204)

      // Verify deleted
      await request(app).get(`/v1/sessions/${sessionId}`).expect(404)
    })

    it('should switch to explicit next participant', async () => {
      const createRes = await request(app)
        .post('/v1/sessions')
        .send({
          session_id: '550e8400-e29b-41d4-a716-446655440003',
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [
            { participant_id: 'p1', participant_index: 0, total_time_ms: 60000 },
            { participant_id: 'p2', participant_index: 1, total_time_ms: 60000 },
            { participant_id: 'p3', participant_index: 2, total_time_ms: 60000 },
          ],
          total_time_ms: 180000,
        })
        .expect(201)

      const sessionId = createRes.body.data.session_id

      await request(app).post(`/v1/sessions/${sessionId}/start`).expect(200)

      // Switch to p3 (skip p2)
      const switchRes = await request(app)
        .post(`/v1/sessions/${sessionId}/switch`)
        .send({ next_participant_id: 'p3' })
        .expect(200)

      expect(switchRes.body.data.active_participant_id).toBe('p3')
    })
  })

  describe('Error Responses', () => {
    it('should return 404 for non-existent session', async () => {
      const response = await request(app).get('/v1/sessions/non-existent-id').expect(404)

      expect(response.body.error).toBeDefined()
      expect(response.body.error.code).toBe('SESSION_NOT_FOUND')
      expect(response.body.error.message).toContain('non-existent-id')
    })

    it('should return 400 for invalid session creation', async () => {
      const response = await request(app)
        .post('/v1/sessions')
        .send({
          // Missing required fields
          session_id: 'invalid-uuid',
        })
        .expect(400)

      expect(response.body.error).toBeDefined()
      expect(response.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('should return 400 for invalid state transition', async () => {
      // Try to start an already running session
      const createRes = await request(app)
        .post('/v1/sessions')
        .send({
          session_id: '550e8400-e29b-41d4-a716-446655440004',
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [{ participant_id: 'p1', participant_index: 0, total_time_ms: 60000 }],
          total_time_ms: 60000,
        })
        .expect(201)

      const sessionId = createRes.body.data.session_id

      await request(app).post(`/v1/sessions/${sessionId}/start`).expect(200)

      // Try to start again - should fail
      const response = await request(app).post(`/v1/sessions/${sessionId}/start`).expect(400)

      expect(response.body.error.code).toBe('INVALID_STATE_TRANSITION')
    })

    it('should return 400 for switching non-running session', async () => {
      const createRes = await request(app)
        .post('/v1/sessions')
        .send({
          session_id: '550e8400-e29b-41d4-a716-446655440005',
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [{ participant_id: 'p1', participant_index: 0, total_time_ms: 60000 }],
          total_time_ms: 60000,
        })
        .expect(201)

      const sessionId = createRes.body.data.session_id

      // Try to switch without starting - should fail
      const response = await request(app).post(`/v1/sessions/${sessionId}/switch`).expect(400)

      expect(response.body.error.message).toContain('not running')
    })
  })

  describe('Health & Metrics', () => {
    it('GET /health - should return ok', async () => {
      const response = await request(app).get('/health').expect(200)

      expect(response.body.status).toBe('ok')
    })

    it('GET /ready - should return ready', async () => {
      const response = await request(app).get('/ready').expect(200)

      expect(response.body.status).toBe('ready')
    })

    it('GET /metrics - should return Prometheus format', async () => {
      const response = await request(app).get('/metrics').expect(200)

      expect(response.headers['content-type']).toContain('text/plain')
      expect(response.text).toContain('synckairos_http_requests_total')
      expect(response.text).toContain('synckairos_http_request_duration_ms')
      expect(response.text).toContain('synckairos_switch_cycle_duration_ms')
    })

    it('GET /v1/time - should return server time', async () => {
      const before = Date.now()
      const response = await request(app).get('/v1/time').expect(200)
      const after = Date.now()

      expect(response.body.timestamp_ms).toBeGreaterThanOrEqual(before)
      expect(response.body.timestamp_ms).toBeLessThanOrEqual(after)
      expect(response.body.server_version).toBe('2.0.0')
      expect(response.body.drift_tolerance_ms).toBe(50)
    })
  })

  describe('Performance', () => {
    it('switchCycle should complete in <50ms', async () => {
      const createRes = await request(app)
        .post('/v1/sessions')
        .send({
          session_id: '550e8400-e29b-41d4-a716-446655440006',
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [
            { participant_id: 'p1', participant_index: 0, total_time_ms: 60000 },
            { participant_id: 'p2', participant_index: 1, total_time_ms: 60000 },
          ],
          total_time_ms: 120000,
        })
        .expect(201)

      const sessionId = createRes.body.data.session_id

      await request(app).post(`/v1/sessions/${sessionId}/start`).expect(200)

      // Measure switch cycle latency
      const start = Date.now()
      await request(app).post(`/v1/sessions/${sessionId}/switch`).expect(200)
      const duration = Date.now() - start

      expect(duration).toBeLessThan(50)
    })

    it('should handle multiple rapid switches', async () => {
      const createRes = await request(app)
        .post('/v1/sessions')
        .send({
          session_id: '550e8400-e29b-41d4-a716-446655440007',
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [
            { participant_id: 'p1', participant_index: 0, total_time_ms: 600000 },
            { participant_id: 'p2', participant_index: 1, total_time_ms: 600000 },
          ],
          total_time_ms: 1200000,
        })
        .expect(201)

      const sessionId = createRes.body.data.session_id

      await request(app).post(`/v1/sessions/${sessionId}/start`).expect(200)

      // Make 5 rapid switches
      for (let i = 0; i < 5; i++) {
        await request(app).post(`/v1/sessions/${sessionId}/switch`).expect(200)
      }

      // Verify final state
      const state = await request(app).get(`/v1/sessions/${sessionId}`).expect(200)

      expect(state.body.data.active_participant_id).toBe('p2') // Should be on p2 after 5 switches
    })
  })
})
