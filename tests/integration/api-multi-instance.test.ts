// Multi-Instance API Integration Tests
// Tests that multiple Express app instances can work together via shared Redis
// Validates the core "Distributed-First" architecture principle

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

describe('Multi-Instance API Integration Tests', () => {
  // Simulate two separate server instances
  let app1: Application
  let app2: Application

  let syncEngine1: SyncEngine
  let syncEngine2: SyncEngine

  let redis1: Redis
  let redis2: Redis
  let pubSub1: Redis
  let pubSub2: Redis

  let dbQueue1: DBWriteQueue
  let dbQueue2: DBWriteQueue

  let stateManager1: RedisStateManager
  let stateManager2: RedisStateManager

  beforeAll(async () => {
    // Create Instance 1
    redis1 = createRedisClient()
    pubSub1 = createRedisPubSubClient()
    dbQueue1 = new DBWriteQueue(process.env.REDIS_URL!)
    stateManager1 = new RedisStateManager(redis1, pubSub1, dbQueue1)
    syncEngine1 = new SyncEngine(stateManager1)
    app1 = createApp({ syncEngine: syncEngine1 })

    // Create Instance 2 (separate connections, same Redis)
    redis2 = createRedisClient()
    pubSub2 = createRedisPubSubClient()
    dbQueue2 = new DBWriteQueue(process.env.REDIS_URL!)
    stateManager2 = new RedisStateManager(redis2, pubSub2, dbQueue2)
    syncEngine2 = new SyncEngine(stateManager2)
    app2 = createApp({ syncEngine: syncEngine2 })
  })

  afterAll(async () => {
    // Cleanup both instances
    await dbQueue1.close()
    await dbQueue2.close()
    await redis1.quit()
    await redis2.quit()
    await pubSub1.quit()
    await pubSub2.quit()
  })

  beforeEach(async () => {
    // Clear Redis before each test
    await redis1.flushdb()
  })

  describe('Session State Sharing Across Instances', () => {
    it('should allow Instance 2 to read session created by Instance 1', async () => {
      const sessionId = '550e8400-e29b-41d4-a716-446655440700'

      // Instance 1: Create session
      await request(app1)
        .post('/v1/sessions')
        .send({
          session_id: sessionId,
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [
            { participant_id: '223e4567-e89b-12d3-a456-426614174201', participant_index: 0, total_time_ms: 60000 },
            { participant_id: '223e4567-e89b-12d3-a456-426614174202', participant_index: 1, total_time_ms: 60000 },
          ],
          total_time_ms: 120000,
        })
        .expect(201)

      // Instance 2: Read same session
      const getRes = await request(app2).get(`/v1/sessions/${sessionId}`).expect(200)

      expect(getRes.body.data.session_id).toBe(sessionId)
      expect(getRes.body.data.participants).toHaveLength(2)
      expect(getRes.body.data.status).toBe('pending')
    })

    it('should allow Instance 2 to modify session created by Instance 1', async () => {
      const sessionId = '550e8400-e29b-41d4-a716-446655440701'

      // Instance 1: Create session
      await request(app1)
        .post('/v1/sessions')
        .send({
          session_id: sessionId,
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [
            { participant_id: '223e4567-e89b-12d3-a456-426614174203', participant_index: 0, total_time_ms: 60000 },
            { participant_id: '223e4567-e89b-12d3-a456-426614174204', participant_index: 1, total_time_ms: 60000 },
          ],
          total_time_ms: 120000,
        })

      // Instance 2: Start the session
      const startRes = await request(app2).post(`/v1/sessions/${sessionId}/start`).expect(200)

      expect(startRes.body.data.status).toBe('running')
      expect(startRes.body.data.active_participant_id).toBe('p1')

      // Instance 1: Verify it can see the change
      const getRes = await request(app1).get(`/v1/sessions/${sessionId}`).expect(200)
      expect(getRes.body.data.status).toBe('running')
      expect(getRes.body.data.active_participant_id).toBe('p1')
    })

    it('should allow instances to alternate operations on same session', async () => {
      const sessionId = '550e8400-e29b-41d4-a716-446655440702'

      // Instance 1: Create
      await request(app1)
        .post('/v1/sessions')
        .send({
          session_id: sessionId,
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [
            { participant_id: '223e4567-e89b-12d3-a456-426614174205', participant_index: 0, total_time_ms: 60000 },
            { participant_id: '223e4567-e89b-12d3-a456-426614174206', participant_index: 1, total_time_ms: 60000 },
          ],
          total_time_ms: 120000,
        })

      // Instance 2: Start
      await request(app2).post(`/v1/sessions/${sessionId}/start`)

      // Instance 1: Switch
      const switch1 = await request(app1).post(`/v1/sessions/${sessionId}/switch`).expect(200)
      expect(switch1.body.data.active_participant_id).toBe('p2')

      // Instance 2: Pause
      const pause = await request(app2).post(`/v1/sessions/${sessionId}/pause`).expect(200)
      expect(pause.body.data.status).toBe('paused')

      // Instance 1: Resume
      const resume = await request(app1).post(`/v1/sessions/${sessionId}/resume`).expect(200)
      expect(resume.body.data.status).toBe('running')

      // Instance 2: Complete
      const complete = await request(app2).post(`/v1/sessions/${sessionId}/complete`).expect(200)
      expect(complete.body.data.status).toBe('completed')

      // Instance 1: Delete
      await request(app1).delete(`/v1/sessions/${sessionId}`).expect(204)

      // Instance 2: Verify deleted
      await request(app2).get(`/v1/sessions/${sessionId}`).expect(404)
    })
  })

  describe('Concurrent Operations Across Instances', () => {
    it('should handle concurrent switch operations from different instances', async () => {
      const sessionId = '550e8400-e29b-41d4-a716-446655440703'

      // Setup
      await request(app1)
        .post('/v1/sessions')
        .send({
          session_id: sessionId,
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [
            { participant_id: '223e4567-e89b-12d3-a456-426614174207', participant_index: 0, total_time_ms: 600000 },
            { participant_id: '223e4567-e89b-12d3-a456-426614174208', participant_index: 1, total_time_ms: 600000 },
            { participant_id: '223e4567-e89b-12d3-a456-426614174209', participant_index: 2, total_time_ms: 600000 },
          ],
          total_time_ms: 1800000,
        })
      await request(app1).post(`/v1/sessions/${sessionId}/start`)

      // Concurrent switches from both instances
      const [switch1, switch2] = await Promise.all([
        request(app1).post(`/v1/sessions/${sessionId}/switch`),
        request(app2).post(`/v1/sessions/${sessionId}/switch`),
      ])

      // Both should succeed or one should get 409 (conflict)
      expect([200, 409]).toContain(switch1.status)
      expect([200, 409]).toContain(switch2.status)

      // At least one should succeed
      const successful = [switch1, switch2].filter(r => r.status === 200)
      expect(successful.length).toBeGreaterThan(0)

      // Final state should be consistent
      const state1 = await request(app1).get(`/v1/sessions/${sessionId}`)
      const state2 = await request(app2).get(`/v1/sessions/${sessionId}`)

      expect(state1.body.data.active_participant_id).toBe(state2.body.data.active_participant_id)
      expect(state1.body.data.version).toBe(state2.body.data.version)
    })

    it('should handle load balancer scenario: rapid requests across instances', async () => {
      const sessionId = '550e8400-e29b-41d4-a716-446655440704'

      // Setup
      await request(app1)
        .post('/v1/sessions')
        .send({
          session_id: sessionId,
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [
            { participant_id: '223e4567-e89b-12d3-a456-426614174210', participant_index: 0, total_time_ms: 600000 },
            { participant_id: '223e4567-e89b-12d3-a456-426614174211', participant_index: 1, total_time_ms: 600000 },
          ],
          total_time_ms: 1200000,
        })
      await request(app1).post(`/v1/sessions/${sessionId}/start`)

      // Simulate load balancer routing requests to different instances
      const requests = []
      for (let i = 0; i < 10; i++) {
        // Alternate between instances
        const app = i % 2 === 0 ? app1 : app2
        requests.push(request(app).post(`/v1/sessions/${sessionId}/switch`))
      }

      const responses = await Promise.all(requests)

      // Most should succeed (some might conflict)
      const successful = responses.filter(r => r.status === 200)
      expect(successful.length).toBeGreaterThan(5)

      // Final state should be consistent across instances
      const finalState1 = await request(app1).get(`/v1/sessions/${sessionId}`)
      const finalState2 = await request(app2).get(`/v1/sessions/${sessionId}`)

      expect(finalState1.body.data.version).toBe(finalState2.body.data.version)
      expect(finalState1.body.data.active_participant_id).toBe(
        finalState2.body.data.active_participant_id
      )
    })
  })

  describe('Pub/Sub Broadcasting Across Instances', () => {
    it('should broadcast updates from Instance 1 to Instance 2 subscribers', async () => {
      const sessionId = '550e8400-e29b-41d4-a716-446655440705'

      const receivedUpdates: Array<{ sessionId: string; state: any }> = []

      // Instance 2: Subscribe to updates
      stateManager2.subscribeToUpdates((sid, state) => {
        receivedUpdates.push({ sessionId: sid, state })
      })

      // Wait for subscription
      await new Promise(resolve => setTimeout(resolve, 100))

      // Instance 1: Create and update session
      await request(app1)
        .post('/v1/sessions')
        .send({
          session_id: sessionId,
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [
            { participant_id: '223e4567-e89b-12d3-a456-426614174212', participant_index: 0, total_time_ms: 60000 },
          ],
          total_time_ms: 60000,
        })

      await request(app1).post(`/v1/sessions/${sessionId}/start`)

      // Wait for Pub/Sub
      await new Promise(resolve => setTimeout(resolve, 200))

      // Verify Instance 2 received the broadcast
      expect(receivedUpdates.length).toBeGreaterThan(0)
      const update = receivedUpdates.find(u => u.sessionId === sessionId)
      expect(update).toBeDefined()
    })

    it('should broadcast deletions from Instance 1 to Instance 2', async () => {
      const sessionId = '550e8400-e29b-41d4-a716-446655440706'

      const deletions: string[] = []

      // Instance 2: Subscribe
      stateManager2.subscribeToUpdates((sid, state) => {
        if (state === null) {
          deletions.push(sid)
        }
      })

      await new Promise(resolve => setTimeout(resolve, 100))

      // Instance 1: Create then delete
      await request(app1)
        .post('/v1/sessions')
        .send({
          session_id: sessionId,
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [
            { participant_id: '223e4567-e89b-12d3-a456-426614174213', participant_index: 0, total_time_ms: 60000 },
          ],
          total_time_ms: 60000,
        })

      await request(app1).delete(`/v1/sessions/${sessionId}`)

      await new Promise(resolve => setTimeout(resolve, 200))

      // Verify Instance 2 got deletion notification
      expect(deletions).toContain(sessionId)
    })
  })

  describe('No Instance-Local State Validation', () => {
    it('should NOT cache state locally - always read from Redis', async () => {
      const sessionId = '550e8400-e29b-41d4-a716-446655440707'

      // Instance 1: Create session
      await request(app1)
        .post('/v1/sessions')
        .send({
          session_id: sessionId,
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [
            { participant_id: '223e4567-e89b-12d3-a456-426614174214', participant_index: 0, total_time_ms: 60000 },
          ],
          total_time_ms: 60000,
        })

      // Instance 1: Read (might cache locally if broken)
      const read1 = await request(app1).get(`/v1/sessions/${sessionId}`)
      expect(read1.body.data.status).toBe('pending')

      // Instance 2: Update state
      await request(app2).post(`/v1/sessions/${sessionId}/start`)

      // Instance 1: Read again (should see Instance 2's change)
      const read2 = await request(app1).get(`/v1/sessions/${sessionId}`)
      expect(read2.body.data.status).toBe('running') // NOT 'pending'

      // This proves no local caching - always reads from Redis
    })
  })

  describe('Rate Limiting Across Instances', () => {
    it('should share rate limit counters across instances (Redis-backed)', async () => {
      const sessionId = '550e8400-e29b-41d4-a716-446655440708'

      // Setup
      await request(app1)
        .post('/v1/sessions')
        .send({
          session_id: sessionId,
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [
            { participant_id: '223e4567-e89b-12d3-a456-426614174215', participant_index: 0, total_time_ms: 600000 },
            { participant_id: '223e4567-e89b-12d3-a456-426614174216', participant_index: 1, total_time_ms: 600000 },
          ],
          total_time_ms: 1200000,
        })
      await request(app1).post(`/v1/sessions/${sessionId}/start`)

      // Instance 1: Use up 5 requests
      const instance1Requests = Array.from({ length: 5 }, () =>
        request(app1).post(`/v1/sessions/${sessionId}/switch`)
      )
      await Promise.all(instance1Requests)

      // Instance 2: Make 6 more requests (total 11, limit is 10 req/sec)
      const instance2Requests = Array.from({ length: 6 }, () =>
        request(app2).post(`/v1/sessions/${sessionId}/switch`)
      )
      const responses = await Promise.all(instance2Requests)

      // At least one from Instance 2 should be rate limited
      // because Instance 1 already used 5 of the 10 allowed
      const rateLimited = responses.filter(r => r.status === 429)
      expect(rateLimited.length).toBeGreaterThan(0)
    })
  })

  describe('Performance Across Instances', () => {
    it('should maintain performance even with cross-instance operations', async () => {
      const sessionId = '550e8400-e29b-41d4-a716-446655440709'

      // Setup
      await request(app1)
        .post('/v1/sessions')
        .send({
          session_id: sessionId,
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [
            { participant_id: '223e4567-e89b-12d3-a456-426614174217', participant_index: 0, total_time_ms: 600000 },
            { participant_id: '223e4567-e89b-12d3-a456-426614174218', participant_index: 1, total_time_ms: 600000 },
          ],
          total_time_ms: 1200000,
        })
      await request(app1).post(`/v1/sessions/${sessionId}/start`)

      // Measure cross-instance operations
      const latencies: number[] = []
      for (let i = 0; i < 20; i++) {
        const app = i % 2 === 0 ? app1 : app2
        const start = Date.now()
        await request(app).post(`/v1/sessions/${sessionId}/switch`)
        latencies.push(Date.now() - start)
      }

      const avg = latencies.reduce((sum, val) => sum + val, 0) / latencies.length

      console.log(`Cross-instance avg latency: ${avg.toFixed(2)}ms`)

      // Should still meet performance targets
      expect(avg).toBeLessThan(50)
    })
  })
})
