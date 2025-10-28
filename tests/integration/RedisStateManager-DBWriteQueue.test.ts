import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { RedisStateManager } from '@/state/RedisStateManager'
import { DBWriteQueue } from '@/state/DBWriteQueue'
import { createRedisClient, createRedisPubSubClient } from '@/config/redis'
import { pool } from '@/config/database'
import { SyncState } from '@/types/session'

// Helper functions for generating unique IDs
const uniqueSessionId = () => uuidv4()
const uniqueParticipantId = () => uuidv4()

// Helper to create test state
const createTestState = (sessionId?: string): SyncState => ({
  session_id: sessionId || uniqueSessionId(),
  sync_mode: 'per_participant',
  status: 'pending',
  time_per_cycle_ms: 60000,
  increment_ms: 0,
  max_time_ms: null,
  participants: [
    {
      participant_id: uniqueParticipantId(),
      total_time_ms: 60000,
      time_remaining_ms: 60000,
      group_id: null,
    },
  ],
  active_participant_id: null,
  current_cycle: 0,
  created_at: new Date(),
  updated_at: new Date(),
  session_started_at: null,
  session_completed_at: null,
  version: 1,
})

describe('RedisStateManager + DBWriteQueue Integration', () => {
  let stateManager: RedisStateManager
  let dbQueue: DBWriteQueue
  let redis: ReturnType<typeof createRedisClient>
  let pubSub: ReturnType<typeof createRedisPubSubClient>

  beforeAll(() => {
    redis = createRedisClient()
    pubSub = createRedisPubSubClient()
    dbQueue = new DBWriteQueue(process.env.REDIS_URL!)
    // Use unique prefix to avoid conflicts with parallel tests
    const uniquePrefix = `integration-test:${Date.now()}-${Math.random()}:`
    stateManager = new RedisStateManager(redis, pubSub, dbQueue, uniquePrefix)
  })

  afterAll(async () => {
    await dbQueue.close()
    await stateManager.close()
  })

  beforeEach(async () => {
    // No cleanup needed - each test uses unique UUIDs
  })

  it('should write to PostgreSQL asynchronously when creating session', async () => {
    const state = createTestState()

    await stateManager.createSession(state)

    // Wait for async write
    await new Promise(resolve => setTimeout(resolve, 2000))

    // Verify in PostgreSQL
    const result = await pool.query('SELECT * FROM sync_sessions WHERE session_id = $1', [
      state.session_id,
    ])

    expect(result.rows.length).toBe(1)
    expect(result.rows[0].sync_mode).toBe(state.sync_mode)

    // Cleanup
    await stateManager.deleteSession(state.session_id)
    await pool.query('DELETE FROM sync_events WHERE session_id = $1', [state.session_id])
    await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', [state.session_id])
  })

  it('should write session_created event to sync_events', async () => {
    const state = createTestState()

    await stateManager.createSession(state)

    // Wait for async write
    await new Promise(resolve => setTimeout(resolve, 2000))

    // Verify event logged
    const result = await pool.query('SELECT * FROM sync_events WHERE session_id = $1', [
      state.session_id,
    ])

    expect(result.rows.length).toBeGreaterThan(0)
    expect(result.rows[0].event_type).toBe('session_created')

    // Cleanup
    await stateManager.deleteSession(state.session_id)
    await pool.query('DELETE FROM sync_events WHERE session_id = $1', [state.session_id])
    await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', [state.session_id])
  })

  it('should not block Redis writes if PostgreSQL is slow', async () => {
    const state = createTestState()

    // Measure Redis write latency (should be <10ms even if DB is slow)
    const start = Date.now()
    await stateManager.createSession(state)
    const latency = Date.now() - start

    expect(latency).toBeLessThan(50) // Should be fast even with DB write queued

    // Cleanup
    await stateManager.deleteSession(state.session_id)
    await new Promise(resolve => setTimeout(resolve, 2000))
    await pool.query('DELETE FROM sync_events WHERE session_id = $1', [state.session_id])
    await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', [state.session_id])
  })

  it('should write session_updated event when updating session', async () => {
    const state = createTestState()

    await stateManager.createSession(state)

    // Wait for initial write
    await new Promise(resolve => setTimeout(resolve, 2000))

    // Update session
    const updatedState = {
      ...state,
      status: 'running' as const,
      session_started_at: new Date(),
    }
    await stateManager.updateSession(state.session_id, updatedState)

    // Wait for update write
    await new Promise(resolve => setTimeout(resolve, 2000))

    // Verify both events logged
    const result = await pool.query(
      'SELECT * FROM sync_events WHERE session_id = $1 ORDER BY timestamp ASC',
      [state.session_id]
    )

    expect(result.rows.length).toBeGreaterThanOrEqual(2)
    expect(result.rows[0].event_type).toBe('session_created')
    expect(result.rows[1].event_type).toBe('session_updated')

    // Cleanup
    await stateManager.deleteSession(state.session_id)
    await pool.query('DELETE FROM sync_events WHERE session_id = $1', [state.session_id])
    await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', [state.session_id])
  })

  it('should store full state snapshot for recovery', async () => {
    const state = createTestState()

    await stateManager.createSession(state)

    // Wait for async write
    await new Promise(resolve => setTimeout(resolve, 2000))

    // Verify state snapshot
    const result = await pool.query(
      'SELECT state_snapshot FROM sync_events WHERE session_id = $1',
      [state.session_id]
    )

    expect(result.rows.length).toBeGreaterThan(0)
    const snapshot = result.rows[0].state_snapshot
    expect(snapshot.session_id).toBe(state.session_id)
    expect(snapshot.sync_mode).toBe(state.sync_mode)
    expect(snapshot.participants).toBeDefined()
    expect(snapshot.participants.length).toBe(1)

    // Cleanup
    await stateManager.deleteSession(state.session_id)
    await pool.query('DELETE FROM sync_events WHERE session_id = $1', [state.session_id])
    await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', [state.session_id])
  })

  it('should handle multiple rapid updates without blocking', async () => {
    const state = createTestState()

    const start = Date.now()

    // Create session
    await stateManager.createSession(state)

    // Perform 5 rapid updates
    for (let i = 0; i < 5; i++) {
      const updatedState = {
        ...state,
        current_cycle: i + 1,
        version: state.version + i,
      }
      await stateManager.updateSession(state.session_id, updatedState)
    }

    const totalLatency = Date.now() - start

    // All 6 operations (1 create + 5 updates) should be very fast
    expect(totalLatency).toBeLessThan(100) // Should complete in <100ms

    // Wait for all async writes to complete
    await new Promise(resolve => setTimeout(resolve, 3000))

    // Verify all events logged
    const result = await pool.query(
      'SELECT * FROM sync_events WHERE session_id = $1 ORDER BY timestamp ASC',
      [state.session_id]
    )

    expect(result.rows.length).toBeGreaterThanOrEqual(6) // 1 create + 5 updates

    // Cleanup
    await stateManager.deleteSession(state.session_id)
    await pool.query('DELETE FROM sync_events WHERE session_id = $1', [state.session_id])
    await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', [state.session_id])
  })

  it('should work correctly when DBWriteQueue is not provided', async () => {
    // Create state manager without DBWriteQueue
    const uniquePrefix = `integration-test:${Date.now()}-${Math.random()}:`
    const stateManagerWithoutQueue = new RedisStateManager(redis, pubSub, undefined, uniquePrefix)

    const state = createTestState()

    // Should not throw error
    await expect(stateManagerWithoutQueue.createSession(state)).resolves.not.toThrow()

    // Verify in Redis
    const retrieved = await stateManagerWithoutQueue.getSession(state.session_id)
    expect(retrieved).not.toBeNull()
    expect(retrieved?.session_id).toBe(state.session_id)

    // Verify NOT in PostgreSQL (no queue configured)
    await new Promise(resolve => setTimeout(resolve, 1000))
    const result = await pool.query('SELECT * FROM sync_sessions WHERE session_id = $1', [
      state.session_id,
    ])
    expect(result.rows.length).toBe(0)

    // Cleanup
    await stateManagerWithoutQueue.deleteSession(state.session_id)
  })

  it('should upsert sessions on multiple writes', async () => {
    const state = createTestState()

    // Create session
    await stateManager.createSession(state)
    await new Promise(resolve => setTimeout(resolve, 2000))

    // Update multiple times
    for (let i = 0; i < 3; i++) {
      const updatedState = {
        ...state,
        status: 'running' as const,
        current_cycle: i + 1,
      }
      await stateManager.updateSession(state.session_id, updatedState)
    }

    await new Promise(resolve => setTimeout(resolve, 3000))

    // Should only have 1 session row (upserted)
    const sessionResult = await pool.query(
      'SELECT * FROM sync_sessions WHERE session_id = $1',
      [state.session_id]
    )
    expect(sessionResult.rows.length).toBe(1)

    // Should have multiple event rows
    const eventResult = await pool.query('SELECT * FROM sync_events WHERE session_id = $1', [
      state.session_id,
    ])
    expect(eventResult.rows.length).toBeGreaterThanOrEqual(4) // 1 create + 3 updates

    // Cleanup
    await stateManager.deleteSession(state.session_id)
    await pool.query('DELETE FROM sync_events WHERE session_id = $1', [state.session_id])
    await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', [state.session_id])
  }, 10000)
})
