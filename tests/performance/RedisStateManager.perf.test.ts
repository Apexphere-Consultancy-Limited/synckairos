// RedisStateManager Performance Tests
// Validates that operations meet performance targets

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { RedisStateManager } from '@/state/RedisStateManager'
import { createRedisClient, createRedisPubSubClient } from '@/config/redis'
import { SyncMode, SyncStatus, type SyncState } from '@/types/session'
import type Redis from 'ioredis'

describe('RedisStateManager Performance', () => {
  let stateManager: RedisStateManager
  let redisClient: Redis
  let pubSubClient: Redis

  beforeAll(async () => {
    redisClient = createRedisClient()
    pubSubClient = createRedisPubSubClient()
    // Select a different Redis database to avoid conflicts with other tests
    await redisClient.select(2)
    await pubSubClient.select(2)
    // Clear this database
    await redisClient.flushdb()
    stateManager = new RedisStateManager(redisClient, pubSubClient)
  })

  afterAll(async () => {
    await stateManager.close()
  })

  const createTestState = (sessionId: string): SyncState => ({
    session_id: sessionId,
    sync_mode: SyncMode.PER_PARTICIPANT,
    status: SyncStatus.PENDING,
    version: 1,
    participants: [
      {
        participant_id: 'p1',
        total_time_ms: 300000,
        time_remaining_ms: 300000,
        has_gone: false,
        is_active: true,
      },
      {
        participant_id: 'p2',
        total_time_ms: 300000,
        time_remaining_ms: 300000,
        has_gone: false,
        is_active: false,
      },
    ],
    active_participant_id: 'p1',
    total_time_ms: 600000,
    time_per_cycle_ms: null,
    cycle_started_at: null,
    session_started_at: null,
    session_completed_at: null,
    created_at: new Date(),
    updated_at: new Date(),
  })

  it('getSession should complete in <3ms average', async () => {
    const state = createTestState('perf-test-1')
    await stateManager.createSession(state)

    const iterations = 100
    const latencies: number[] = []

    for (let i = 0; i < iterations; i++) {
      const start = performance.now()
      await stateManager.getSession('perf-test-1')
      const latency = performance.now() - start
      latencies.push(latency)
    }

    const avgLatency = latencies.reduce((a, b) => a + b) / latencies.length
    const p95 = latencies.sort((a, b) => a - b)[Math.floor(iterations * 0.95)]

    console.log(`\n📊 getSession Performance:`)
    console.log(`   Average: ${avgLatency.toFixed(2)}ms`)
    console.log(`   P95: ${p95.toFixed(2)}ms`)
    console.log(`   Min: ${Math.min(...latencies).toFixed(2)}ms`)
    console.log(`   Max: ${Math.max(...latencies).toFixed(2)}ms`)

    expect(avgLatency).toBeLessThan(3)
    expect(p95).toBeLessThan(5)
  })

  it('updateSession should complete in <5ms average', async () => {
    const sessionId = 'perf-test-update'
    const state = createTestState(sessionId)
    await stateManager.createSession(state)

    const iterations = 100
    const latencies: number[] = []

    for (let i = 0; i < iterations; i++) {
      const current = await stateManager.getSession(sessionId)
      if (!current) {
        console.error(`Session not found at iteration ${i}`)
        throw new Error(`Session not found at iteration ${i}`)
      }
      const start = performance.now()
      await stateManager.updateSession(sessionId, current)
      const latency = performance.now() - start
      latencies.push(latency)
    }

    const avgLatency = latencies.reduce((a, b) => a + b) / latencies.length
    const p95 = latencies.sort((a, b) => a - b)[Math.floor(iterations * 0.95)]

    console.log(`\n📊 updateSession Performance:`)
    console.log(`   Average: ${avgLatency.toFixed(2)}ms`)
    console.log(`   P95: ${p95.toFixed(2)}ms`)
    console.log(`   Min: ${Math.min(...latencies).toFixed(2)}ms`)
    console.log(`   Max: ${Math.max(...latencies).toFixed(2)}ms`)

    expect(avgLatency).toBeLessThan(5)
    expect(p95).toBeLessThan(10)
  })

  it('Redis Pub/Sub should complete in <2ms', async () => {
    const iterations = 100
    const latencies: number[] = []

    for (let i = 0; i < iterations; i++) {
      const start = performance.now()
      await redisClient.publish('test-channel', JSON.stringify({ test: 'message' }))
      const latency = performance.now() - start
      latencies.push(latency)
    }

    const avgLatency = latencies.reduce((a, b) => a + b) / latencies.length
    const p95 = latencies.sort((a, b) => a - b)[Math.floor(iterations * 0.95)]

    console.log(`\n📊 Redis Pub/Sub Performance:`)
    console.log(`   Average: ${avgLatency.toFixed(2)}ms`)
    console.log(`   P95: ${p95.toFixed(2)}ms`)
    console.log(`   Min: ${Math.min(...latencies).toFixed(2)}ms`)
    console.log(`   Max: ${Math.max(...latencies).toFixed(2)}ms`)

    expect(avgLatency).toBeLessThan(2)
  })

  it('createSession should complete in <5ms', async () => {
    const iterations = 50
    const latencies: number[] = []

    for (let i = 0; i < iterations; i++) {
      const state = createTestState(`perf-create-${i}`)
      const start = performance.now()
      await stateManager.createSession(state)
      const latency = performance.now() - start
      latencies.push(latency)
    }

    const avgLatency = latencies.reduce((a, b) => a + b) / latencies.length
    const p95 = latencies.sort((a, b) => a - b)[Math.floor(iterations * 0.95)]

    console.log(`\n📊 createSession Performance:`)
    console.log(`   Average: ${avgLatency.toFixed(2)}ms`)
    console.log(`   P95: ${p95.toFixed(2)}ms`)
    console.log(`   Min: ${Math.min(...latencies).toFixed(2)}ms`)
    console.log(`   Max: ${Math.max(...latencies).toFixed(2)}ms`)

    expect(avgLatency).toBeLessThan(5)
  })

  it('deleteSession should complete in <5ms', async () => {
    // Create sessions first
    const iterations = 50
    for (let i = 0; i < iterations; i++) {
      const state = createTestState(`perf-delete-${i}`)
      await stateManager.createSession(state)
    }

    const latencies: number[] = []

    for (let i = 0; i < iterations; i++) {
      const start = performance.now()
      await stateManager.deleteSession(`perf-delete-${i}`)
      const latency = performance.now() - start
      latencies.push(latency)
    }

    const avgLatency = latencies.reduce((a, b) => a + b) / latencies.length
    const p95 = latencies.sort((a, b) => a - b)[Math.floor(iterations * 0.95)]

    console.log(`\n📊 deleteSession Performance:`)
    console.log(`   Average: ${avgLatency.toFixed(2)}ms`)
    console.log(`   P95: ${p95.toFixed(2)}ms`)
    console.log(`   Min: ${Math.min(...latencies).toFixed(2)}ms`)
    console.log(`   Max: ${Math.max(...latencies).toFixed(2)}ms`)

    expect(avgLatency).toBeLessThan(5)
  })

  it('should handle high throughput operations', async () => {
    const sessionCount = 100
    const sessions: string[] = []

    // Create many sessions
    const createStart = performance.now()
    for (let i = 0; i < sessionCount; i++) {
      const state = createTestState(`throughput-${i}`)
      await stateManager.createSession(state)
      sessions.push(`throughput-${i}`)
    }
    const createDuration = performance.now() - createStart

    // Read all sessions
    const readStart = performance.now()
    const readPromises = sessions.map(id => stateManager.getSession(id))
    await Promise.all(readPromises)
    const readDuration = performance.now() - readStart

    // Update all sessions
    const updateStart = performance.now()
    const updatePromises = sessions.map(async id => {
      const current = await stateManager.getSession(id)
      if (current) {
        await stateManager.updateSession(id, {
          ...current,
          status: SyncStatus.RUNNING,
        })
      }
    })
    await Promise.all(updatePromises)
    const updateDuration = performance.now() - updateStart

    console.log(`\n📊 High Throughput Test (${sessionCount} sessions):`)
    console.log(`   Create all: ${createDuration.toFixed(2)}ms (${(createDuration / sessionCount).toFixed(2)}ms per session)`)
    console.log(`   Read all: ${readDuration.toFixed(2)}ms (${(readDuration / sessionCount).toFixed(2)}ms per session)`)
    console.log(`   Update all: ${updateDuration.toFixed(2)}ms (${(updateDuration / sessionCount).toFixed(2)}ms per session)`)

    expect(createDuration / sessionCount).toBeLessThan(10)
    expect(readDuration / sessionCount).toBeLessThan(5)
    expect(updateDuration / sessionCount).toBeLessThan(15)
  })
})
