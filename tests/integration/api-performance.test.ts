// REST API Performance Integration Tests
// Tests performance targets and latency percentiles

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

describe('REST API Performance Tests', () => {
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
    const uniquePrefix = `integration-test:${Date.now()}-${Math.random()}:`    stateManager = new RedisStateManager(redis, pubSub, dbQueue, uniquePrefix)

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
    // No longer needed - using unique prefix per test suite
  })

  describe('switchCycle Latency Percentiles', () => {
    it('should meet p50, p95, p99 latency targets', async () => {
      const sessionId = '550e8400-e29b-41d4-a716-446655440400'

      // Setup session
      await request(app)
        .post('/v1/sessions')
        .send({
          session_id: sessionId,
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [
            { participant_id: 'p1', participant_index: 0, total_time_ms: 600000 },
            { participant_id: 'p2', participant_index: 1, total_time_ms: 600000 },
          ],
          total_time_ms: 1200000,
        })
      await request(app).post(`/v1/sessions/${sessionId}/start`)

      const latencies: number[] = []

      // Make 100 sequential requests to measure latency
      for (let i = 0; i < 100; i++) {
        const start = Date.now()
        await request(app).post(`/v1/sessions/${sessionId}/switch`)
        const duration = Date.now() - start
        latencies.push(duration)
      }

      // Calculate percentiles
      latencies.sort((a, b) => a - b)

      const p50 = latencies[49]
      const p95 = latencies[94]
      const p99 = latencies[98]
      const max = latencies[99]
      const avg = latencies.reduce((sum, val) => sum + val, 0) / latencies.length

      // Log for visibility
      console.log('switchCycle Latency Stats:')
      console.log(`  p50: ${p50}ms`)
      console.log(`  p95: ${p95}ms`)
      console.log(`  p99: ${p99}ms`)
      console.log(`  max: ${max}ms`)
      console.log(`  avg: ${avg.toFixed(2)}ms`)

      // Assert against targets
      expect(p50).toBeLessThan(10) // Expected: ~5ms
      expect(p95).toBeLessThan(50) // Target: <50ms
      expect(p99).toBeLessThan(100) // Max acceptable
      expect(avg).toBeLessThan(15) // Average should be good
    })
  })

  describe('Concurrent Session Load', () => {
    it('should handle 50 concurrent sessions efficiently', async () => {
      const sessionCount = 50

      // Create session configs
      const sessions = Array.from({ length: sessionCount }, (_, i) => ({
        session_id: `550e8400-e29b-41d4-a716-4466554404${i.toString().padStart(2, '0')}`,
        sync_mode: SyncMode.PER_PARTICIPANT,
        participants: [
          { participant_id: 'p1', participant_index: 0, total_time_ms: 60000 },
          { participant_id: 'p2', participant_index: 1, total_time_ms: 60000 },
        ],
        total_time_ms: 120000,
      }))

      // Create all sessions concurrently
      const createStart = Date.now()
      await Promise.all(
        sessions.map(s => request(app).post('/v1/sessions').send(s).expect(201))
      )
      const createDuration = Date.now() - createStart
      console.log(`Created ${sessionCount} sessions in ${createDuration}ms`)

      // Start all sessions concurrently
      const startReqs = Date.now()
      await Promise.all(
        sessions.map(s => request(app).post(`/v1/sessions/${s.session_id}/start`).expect(200))
      )
      const startDuration = Date.now() - startReqs
      console.log(`Started ${sessionCount} sessions in ${startDuration}ms`)

      // Switch all sessions concurrently
      const switchStart = Date.now()
      await Promise.all(
        sessions.map(s => request(app).post(`/v1/sessions/${s.session_id}/switch`).expect(200))
      )
      const switchDuration = Date.now() - switchStart
      console.log(`Switched ${sessionCount} sessions in ${switchDuration}ms`)

      // Average latency should still be good
      const avgSwitchLatency = switchDuration / sessionCount
      expect(avgSwitchLatency).toBeLessThan(50)
    })

    it('should handle 100 concurrent sessions efficiently', async () => {
      const sessionCount = 100

      // Create session configs
      const sessions = Array.from({ length: sessionCount }, (_, i) => ({
        session_id: `550e8400-e29b-41d4-a716-4466554405${i.toString().padStart(2, '0')}`,
        sync_mode: SyncMode.PER_PARTICIPANT,
        participants: [
          { participant_id: 'p1', participant_index: 0, total_time_ms: 60000 },
          { participant_id: 'p2', participant_index: 1, total_time_ms: 60000 },
        ],
        total_time_ms: 120000,
      }))

      // Create all sessions concurrently
      await Promise.all(
        sessions.map(s => request(app).post('/v1/sessions').send(s))
      )

      // Start all sessions concurrently
      await Promise.all(
        sessions.map(s => request(app).post(`/v1/sessions/${s.session_id}/start`))
      )

      // Switch all sessions simultaneously and measure
      const start = Date.now()
      const responses = await Promise.all(
        sessions.map(s => request(app).post(`/v1/sessions/${s.session_id}/switch`))
      )
      const totalDuration = Date.now() - start

      // All should succeed
      const successful = responses.filter(r => r.status === 200)
      expect(successful.length).toBe(sessionCount)

      // Total time should be reasonable (not linear with session count)
      expect(totalDuration).toBeLessThan(sessionCount * 10) // Not more than 10ms per session

      console.log(`100 concurrent switches completed in ${totalDuration}ms`)
    })
  })

  describe('Endpoint Response Times', () => {
    it('GET /v1/sessions/:id should be fast (<10ms)', async () => {
      const sessionId = '550e8400-e29b-41d4-a716-446655440450'

      // Setup session
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

      // Measure GET latency
      const latencies: number[] = []
      for (let i = 0; i < 50; i++) {
        const start = Date.now()
        await request(app).get(`/v1/sessions/${sessionId}`).expect(200)
        latencies.push(Date.now() - start)
      }

      const avg = latencies.reduce((sum, val) => sum + val, 0) / latencies.length
      const max = Math.max(...latencies)

      console.log(`GET latency - avg: ${avg.toFixed(2)}ms, max: ${max}ms`)

      expect(avg).toBeLessThan(10)
      expect(max).toBeLessThan(20)
    })

    it('POST /v1/sessions (create) should be fast (<20ms)', async () => {
      const latencies: number[] = []

      for (let i = 0; i < 50; i++) {
        const sessionId = `550e8400-e29b-41d4-a716-4466554404${i.toString().padStart(2, '0')}`
        const start = Date.now()

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
          .expect(201)

        latencies.push(Date.now() - start)
      }

      const avg = latencies.reduce((sum, val) => sum + val, 0) / latencies.length
      console.log(`POST /v1/sessions latency avg: ${avg.toFixed(2)}ms`)

      expect(avg).toBeLessThan(20)
    })

    it('DELETE /v1/sessions/:id should be fast (<10ms)', async () => {
      // Create sessions
      const sessions = Array.from({ length: 50 }, (_, i) => ({
        session_id: `550e8400-e29b-41d4-a716-4466554406${i.toString().padStart(2, '0')}`,
        sync_mode: SyncMode.PER_PARTICIPANT,
        participants: [
          { participant_id: 'p1', participant_index: 0, total_time_ms: 60000 },
        ],
        total_time_ms: 60000,
      }))

      await Promise.all(sessions.map(s => request(app).post('/v1/sessions').send(s)))

      // Measure DELETE latency
      const latencies: number[] = []
      for (const session of sessions) {
        const start = Date.now()
        await request(app).delete(`/v1/sessions/${session.session_id}`).expect(204)
        latencies.push(Date.now() - start)
      }

      const avg = latencies.reduce((sum, val) => sum + val, 0) / latencies.length
      console.log(`DELETE latency avg: ${avg.toFixed(2)}ms`)

      expect(avg).toBeLessThan(10)
    })
  })

  describe('Stress Testing', () => {
    it('should handle rapid create/delete cycles', async () => {
      const cycles = 20

      for (let i = 0; i < cycles; i++) {
        const sessionId = `550e8400-e29b-41d4-a716-4466554407${i.toString().padStart(2, '0')}`

        // Create
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

        // Delete immediately
        await request(app).delete(`/v1/sessions/${sessionId}`).expect(204)
      }

      // All cycles should complete successfully
      expect(true).toBe(true)
    })

    it('should maintain performance under sustained load', async () => {
      const sessionId = '550e8400-e29b-41d4-a716-446655440480'

      // Setup
      await request(app)
        .post('/v1/sessions')
        .send({
          session_id: sessionId,
          sync_mode: SyncMode.PER_PARTICIPANT,
          participants: [
            { participant_id: 'p1', participant_index: 0, total_time_ms: 6000000 },
            { participant_id: 'p2', participant_index: 1, total_time_ms: 6000000 },
          ],
          total_time_ms: 12000000,
        })
      await request(app).post(`/v1/sessions/${sessionId}/start`)

      // Make 200 sequential switches
      const latencies: number[] = []
      for (let i = 0; i < 200; i++) {
        const start = Date.now()
        await request(app).post(`/v1/sessions/${sessionId}/switch`)
        latencies.push(Date.now() - start)
      }

      // Calculate stats for first 50 and last 50
      const firstBatch = latencies.slice(0, 50)
      const lastBatch = latencies.slice(-50)

      const firstAvg = firstBatch.reduce((sum, val) => sum + val, 0) / firstBatch.length
      const lastAvg = lastBatch.reduce((sum, val) => sum + val, 0) / lastBatch.length

      console.log(`First 50 avg: ${firstAvg.toFixed(2)}ms, Last 50 avg: ${lastAvg.toFixed(2)}ms`)

      // Performance should not degrade significantly over time
      expect(lastAvg).toBeLessThan(firstAvg * 2) // Last batch not more than 2x first batch
      expect(lastAvg).toBeLessThan(50) // Still under target
    })
  })
})
