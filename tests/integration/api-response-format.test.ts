// REST API Response Format Tests
// Tests response structure consistency and HTTP standards compliance

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

describe('REST API Response Format Tests', () => {
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

  // Helper to generate unique session and participant IDs
  const uniqueSessionId = () => uuidv4()
  const uniqueParticipantId = () => uuidv4()
    // Clear Redis before each test
    // No longer needed - using unique prefix per test suite
  })

  describe('Success Response Format', () => {
    it('should wrap all success responses in { data: ... } property', async () => {
      const sessionId = uniqueSessionId()

      // POST /v1/sessions (create)
      const createRes = await request(app)
        .post('/v1/sessions')
        .send({
          session_id: sessionId,
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [
            { participant_id: uniqueParticipantId(), participant_index: 0, total_time_ms: 60000 },
            { participant_id: uniqueParticipantId(), participant_index: 1, total_time_ms: 60000 },
          ],
          total_time_ms: 120000,
        })
        .expect(201)

      expect(createRes.body).toHaveProperty('data')
      expect(createRes.body.data).toHaveProperty('session_id')
      expect(createRes.body.data).toHaveProperty('status')
      expect(createRes.body).not.toHaveProperty('error')

      // POST /v1/sessions/:id/start
      const startRes = await request(app).post(`/v1/sessions/${sessionId}/start`).expect(200)
      expect(startRes.body).toHaveProperty('data')
      expect(startRes.body.data).toHaveProperty('session_id')

      // GET /v1/sessions/:id
      const getRes = await request(app).get(`/v1/sessions/${sessionId}`).expect(200)
      expect(getRes.body).toHaveProperty('data')
      expect(getRes.body.data).toHaveProperty('session_id')

      // POST /v1/sessions/:id/switch
      const switchRes = await request(app).post(`/v1/sessions/${sessionId}/switch`).expect(200)
      expect(switchRes.body).toHaveProperty('data')
      expect(switchRes.body.data).toHaveProperty('active_participant_id')

      // POST /v1/sessions/:id/pause
      const pauseRes = await request(app).post(`/v1/sessions/${sessionId}/pause`).expect(200)
      expect(pauseRes.body).toHaveProperty('data')

      // POST /v1/sessions/:id/resume
      const resumeRes = await request(app).post(`/v1/sessions/${sessionId}/resume`).expect(200)
      expect(resumeRes.body).toHaveProperty('data')

      // POST /v1/sessions/:id/complete
      const completeRes = await request(app).post(`/v1/sessions/${sessionId}/complete`).expect(200)
      expect(completeRes.body).toHaveProperty('data')
    })

    it('should return empty body for DELETE (204 No Content)', async () => {
      const sessionId = uniqueSessionId()

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

      const deleteRes = await request(app).delete(`/v1/sessions/${sessionId}`).expect(204)

      // 204 No Content should have empty body
      expect(deleteRes.body).toEqual({})
      expect(deleteRes.text).toBe('')
    })
  })

  describe('Error Response Format', () => {
    it('should have consistent error structure for all error types', async () => {
      // 404 Not Found
      const notFoundRes = await request(app).get('/v1/sessions/nonexistent-id').expect(404)
      expect(notFoundRes.body).toHaveProperty('error')
      expect(notFoundRes.body.error).toHaveProperty('code')
      expect(notFoundRes.body.error).toHaveProperty('message')
      expect(notFoundRes.body.error.code).toBe('SESSION_NOT_FOUND')
      expect(notFoundRes.body).not.toHaveProperty('data')

      // 400 Bad Request (validation)
      const badRequestRes = await request(app)
        .post('/v1/sessions')
        .send({ session_id: 'invalid' })
        .expect(400)
      expect(badRequestRes.body).toHaveProperty('error')
      expect(badRequestRes.body.error).toHaveProperty('code')
      expect(badRequestRes.body.error).toHaveProperty('message')
      expect(badRequestRes.body.error.code).toBe('VALIDATION_ERROR')

      // 400 Invalid State Transition
      const sessionId = uniqueSessionId()
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
      await request(app).post(`/v1/sessions/${sessionId}/start`)

      const stateTransitionRes = await request(app)
        .post(`/v1/sessions/${sessionId}/start`)
        .expect(400)
      expect(stateTransitionRes.body.error.code).toBe('INVALID_STATE_TRANSITION')
    })

    it('should include error details when available', async () => {
      const sessionId = uniqueSessionId()

      // Create session with validation error
      const response = await request(app)
        .post('/v1/sessions')
        .send({
          session_id: sessionId,
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [], // Empty participants
          total_time_ms: 60000,
        })
        .expect(400)

      expect(response.body.error).toHaveProperty('code')
      expect(response.body.error).toHaveProperty('message')
      expect(response.body.error.code).toBe('VALIDATION_ERROR')
      expect(response.body.error.message).toBe('Request validation failed')
    })

    it('should NOT include stack trace in production', async () => {
      // Temporarily set NODE_ENV to production
      const originalEnv = process.env.NODE_ENV
      process.env.NODE_ENV = 'production'

      const response = await request(app).get('/v1/sessions/nonexistent').expect(404)

      expect(response.body.error).not.toHaveProperty('stack')

      // Restore environment
      process.env.NODE_ENV = originalEnv
    })

    it('should include stack trace in development', async () => {
      // Temporarily set NODE_ENV to development
      const originalEnv = process.env.NODE_ENV
      process.env.NODE_ENV = 'development'

      const response = await request(app).get('/v1/sessions/nonexistent').expect(404)

      expect(response.body.error).toHaveProperty('stack')

      // Restore environment
      process.env.NODE_ENV = originalEnv
    })
  })

  describe('HTTP Headers', () => {
    it('should include Content-Type: application/json for JSON responses', async () => {
      const sessionId = uniqueSessionId()

      const response = await request(app)
        .post('/v1/sessions')
        .send({
          session_id: sessionId,
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [
            { participant_id: uniqueParticipantId(), participant_index: 0, total_time_ms: 60000 },
          ],
          total_time_ms: 60000,
        })
        .expect(201)

      expect(response.headers['content-type']).toContain('application/json')
    })

    it('should include CORS headers', async () => {
      const response = await request(app).get('/health').expect(200)

      expect(response.headers).toHaveProperty('access-control-allow-origin')
      expect(response.headers).toHaveProperty('access-control-allow-credentials')
    })

    it('should include rate limit headers on limited endpoints', async () => {
      const sessionId = uniqueSessionId()

      await request(app)
        .post('/v1/sessions')
        .send({
          session_id: sessionId,
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [
            { participant_id: uniqueParticipantId(), participant_index: 0, total_time_ms: 60000 },
            { participant_id: uniqueParticipantId(), participant_index: 1, total_time_ms: 60000 },
          ],
          total_time_ms: 120000,
        })
      await request(app).post(`/v1/sessions/${sessionId}/start`)

      const response = await request(app).post(`/v1/sessions/${sessionId}/switch`).expect(200)

      // Rate limit headers should be present
      expect(response.headers).toHaveProperty('ratelimit-limit')
      expect(response.headers).toHaveProperty('ratelimit-remaining')
      expect(response.headers).toHaveProperty('ratelimit-reset')
    })

    it('should NOT include rate limit headers on health endpoints', async () => {
      const response = await request(app).get('/health').expect(200)

      // Health endpoints exempt from rate limiting, no headers
      expect(response.headers['ratelimit-limit']).toBeUndefined()
    })
  })

  describe('HTTP Status Codes', () => {
    it('should use correct status codes for each scenario', async () => {
      const sessionId = uniqueSessionId()

      // 201 Created
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
        .expect(201)

      // 200 OK (most operations)
      await request(app).post(`/v1/sessions/${sessionId}/start`).expect(200)
      await request(app).get(`/v1/sessions/${sessionId}`).expect(200)
      await request(app).post(`/v1/sessions/${sessionId}/pause`).expect(200)
      await request(app).post(`/v1/sessions/${sessionId}/resume`).expect(200)
      await request(app).post(`/v1/sessions/${sessionId}/complete`).expect(200)

      // 204 No Content (delete)
      await request(app).delete(`/v1/sessions/${sessionId}`).expect(204)

      // 404 Not Found
      await request(app).get('/v1/sessions/nonexistent').expect(404)

      // 400 Bad Request
      await request(app)
        .post('/v1/sessions')
        .send({ invalid: 'data' })
        .expect(400)
    })
  })

  describe('Data Serialization', () => {
    it('should serialize dates as ISO 8601 strings', async () => {
      const sessionId = uniqueSessionId()

      const createRes = await request(app)
        .post('/v1/sessions')
        .send({
          session_id: sessionId,
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [
            { participant_id: uniqueParticipantId(), participant_index: 0, total_time_ms: 60000 },
          ],
          total_time_ms: 60000,
        })
        .expect(201)

      // Dates should be ISO 8601 strings
      expect(typeof createRes.body.data.created_at).toBe('string')
      expect(typeof createRes.body.data.updated_at).toBe('string')

      // Should be parseable as Date
      const createdAt = new Date(createRes.body.data.created_at)
      expect(createdAt).toBeInstanceOf(Date)
      expect(isNaN(createdAt.getTime())).toBe(false)
    })

    it('should serialize numbers correctly (not as strings)', async () => {
      const sessionId = uniqueSessionId()

      const response = await request(app)
        .post('/v1/sessions')
        .send({
          session_id: sessionId,
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [
            { participant_id: uniqueParticipantId(), participant_index: 0, total_time_ms: 60000 },
          ],
          total_time_ms: 60000,
        })
        .expect(201)

      // Numbers should be numbers, not strings
      expect(typeof response.body.data.total_time_ms).toBe('number')
      expect(typeof response.body.data.version).toBe('number')
      expect(typeof response.body.data.participants[0].total_time_ms).toBe('number')
      expect(typeof response.body.data.participants[0].participant_index).toBe('number')
    })

    it('should serialize null values correctly', async () => {
      const sessionId = uniqueSessionId()

      const response = await request(app)
        .post('/v1/sessions')
        .send({
          session_id: sessionId,
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [
            { participant_id: uniqueParticipantId(), participant_index: 0, total_time_ms: 60000 },
          ],
          total_time_ms: 60000,
        })
        .expect(201)

      // Null fields should be null (not undefined or missing)
      expect(response.body.data.active_participant_id).toBeNull()
      expect(response.body.data.cycle_started_at).toBeNull()
      expect(response.body.data.session_started_at).toBeNull()
      expect(response.body.data.session_completed_at).toBeNull()
    })
  })

  describe('Special Endpoint Formats', () => {
    it('GET /v1/time should have specific format', async () => {
      const response = await request(app).get('/v1/time').expect(200)

      expect(response.body).toHaveProperty('timestamp_ms')
      expect(response.body).toHaveProperty('server_version')
      expect(response.body).toHaveProperty('drift_tolerance_ms')
      expect(typeof response.body.timestamp_ms).toBe('number')
      expect(typeof response.body.server_version).toBe('string')
      expect(typeof response.body.drift_tolerance_ms).toBe('number')
    })

    it('GET /health should have simple format', async () => {
      const response = await request(app).get('/health').expect(200)

      expect(response.body).toEqual({ status: 'ok' })
    })

    it('GET /ready should have specific format', async () => {
      const response = await request(app).get('/ready').expect(200)

      expect(response.body).toHaveProperty('status')
      expect(response.body.status).toBe('ready')
    })

    it('GET /metrics should return Prometheus text format', async () => {
      const response = await request(app).get('/metrics').expect(200)

      // Should be text/plain
      expect(response.headers['content-type']).toContain('text/plain')

      // Should contain Prometheus metrics
      expect(response.text).toContain('synckairos_http_requests_total')
      expect(response.text).toContain('HELP')
      expect(response.text).toContain('TYPE')
    })
  })
})
