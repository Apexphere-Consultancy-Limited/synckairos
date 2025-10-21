import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DBWriteQueue } from '@/state/DBWriteQueue'
import { pool } from '@/config/database'
import { SyncState } from '@/types/session'

// Helper to create test state
const createTestState = (sessionId: string): SyncState => ({
  session_id: sessionId,
  sync_mode: 'per_participant',
  status: 'pending',
  time_per_cycle_ms: 60000,
  increment_ms: 0,
  max_time_ms: null,
  participants: [
    {
      participant_id: 'participant-1',
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

describe('DBWriteQueue', () => {
  let queue: DBWriteQueue

  beforeEach(() => {
    queue = new DBWriteQueue(process.env.REDIS_URL!)
  })

  afterEach(async () => {
    await queue.close()
  })

  it('should initialize queue successfully', async () => {
    const metrics = await queue.getMetrics()
    expect(metrics).toBeDefined()
    expect(metrics.waiting).toBeGreaterThanOrEqual(0)
  })

  it('should queue a write job', async () => {
    const state = createTestState('test-session-queue-1')

    await queue.queueWrite('test-session-queue-1', state, 'session_created')

    const metrics = await queue.getMetrics()
    expect(metrics.waiting + metrics.active).toBeGreaterThan(0)
  })

  it('should return queue metrics', async () => {
    const metrics = await queue.getMetrics()

    expect(metrics).toEqual({
      waiting: expect.any(Number),
      active: expect.any(Number),
      completed: expect.any(Number),
      failed: expect.any(Number),
      delayed: expect.any(Number),
    })
  })

  it('should accept multiple job types', async () => {
    const state = createTestState('test-session-multiple-1')

    await queue.queueWrite('test-session-multiple-1', state, 'session_created')
    await queue.queueWrite('test-session-multiple-1', state, 'session_started')
    await queue.queueWrite('test-session-multiple-1', state, 'cycle_switched')

    const metrics = await queue.getMetrics()
    expect(metrics.waiting + metrics.active).toBeGreaterThanOrEqual(3)
  })

  it('should close queue and worker cleanly', async () => {
    await expect(queue.close()).resolves.not.toThrow()
  })
})

describe('DBWriteQueue - Database Writes', () => {
  let queue: DBWriteQueue

  beforeEach(() => {
    queue = new DBWriteQueue(process.env.REDIS_URL!)
  })

  afterEach(async () => {
    await queue.close()
  })

  it('should write session to sync_sessions table', async () => {
    const state = createTestState('test-session-write-1')

    await queue.queueWrite('test-session-write-1', state, 'session_created')

    // Wait for job to process
    await new Promise((resolve) => setTimeout(resolve, 2000))

    const result = await pool.query('SELECT * FROM sync_sessions WHERE session_id = $1', [
      'test-session-write-1',
    ])

    expect(result.rows.length).toBe(1)
    expect(result.rows[0].sync_mode).toBe(state.sync_mode)

    // Cleanup
    await pool.query('DELETE FROM sync_events WHERE session_id = $1', ['test-session-write-1'])
    await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', ['test-session-write-1'])
  })

  it('should write event to sync_events table', async () => {
    const state = createTestState('test-session-write-2')

    await queue.queueWrite('test-session-write-2', state, 'session_started')

    // Wait for job to process
    await new Promise((resolve) => setTimeout(resolve, 2000))

    const result = await pool.query(
      'SELECT * FROM sync_events WHERE session_id = $1 ORDER BY timestamp DESC',
      ['test-session-write-2']
    )

    expect(result.rows.length).toBeGreaterThan(0)
    expect(result.rows[0].event_type).toBe('session_started')

    // Cleanup
    await pool.query('DELETE FROM sync_events WHERE session_id = $1', ['test-session-write-2'])
    await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', ['test-session-write-2'])
  })

  it('should store full state snapshot in sync_events', async () => {
    const state = createTestState('test-session-write-3')

    await queue.queueWrite('test-session-write-3', state, 'cycle_switched')

    // Wait for job to process
    await new Promise((resolve) => setTimeout(resolve, 2000))

    const result = await pool.query(
      'SELECT state_snapshot FROM sync_events WHERE session_id = $1',
      ['test-session-write-3']
    )

    expect(result.rows.length).toBeGreaterThan(0)
    const snapshot = result.rows[0].state_snapshot
    expect(snapshot.session_id).toBe('test-session-write-3')
    expect(snapshot.participants).toBeDefined()

    // Cleanup
    await pool.query('DELETE FROM sync_events WHERE session_id = $1', ['test-session-write-3'])
    await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', ['test-session-write-3'])
  })

  it('should upsert session data on conflict', async () => {
    const state = createTestState('test-session-upsert-1')

    // First write
    await queue.queueWrite('test-session-upsert-1', state, 'session_created')
    await new Promise((resolve) => setTimeout(resolve, 2000))

    // Second write with updated state
    const updatedState = {
      ...state,
      status: 'running' as const,
      session_started_at: new Date(),
    }
    await queue.queueWrite('test-session-upsert-1', updatedState, 'session_started')
    await new Promise((resolve) => setTimeout(resolve, 2000))

    const result = await pool.query('SELECT * FROM sync_sessions WHERE session_id = $1', [
      'test-session-upsert-1',
    ])

    expect(result.rows.length).toBe(1)
    expect(result.rows[0].final_status).toBe('running')
    expect(result.rows[0].started_at).not.toBeNull()

    // Cleanup
    await pool.query('DELETE FROM sync_events WHERE session_id = $1', ['test-session-upsert-1'])
    await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', ['test-session-upsert-1'])
  })
})

describe('DBWriteQueue - Metrics', () => {
  let queue: DBWriteQueue

  beforeEach(() => {
    queue = new DBWriteQueue(process.env.REDIS_URL!)
  })

  afterEach(async () => {
    await queue.close()
  })

  it('should track waiting jobs', async () => {
    const state = createTestState('test-metrics-1')

    await queue.queueWrite('test-metrics-1', state, 'session_created')

    const metrics = await queue.getMetrics()
    expect(metrics.waiting + metrics.active).toBeGreaterThan(0)
  })

  it('should track completed jobs', async () => {
    const state = createTestState('test-metrics-2')

    await queue.queueWrite('test-metrics-2', state, 'session_created')

    // Wait for completion
    await new Promise((resolve) => setTimeout(resolve, 2000))

    const metrics = await queue.getMetrics()
    expect(metrics.completed).toBeGreaterThan(0)

    // Cleanup
    await pool.query('DELETE FROM sync_events WHERE session_id = $1', ['test-metrics-2'])
    await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', ['test-metrics-2'])
  })

  it('should handle multiple concurrent jobs', async () => {
    const jobs = Array.from({ length: 5 }, (_, i) => {
      const sessionId = `test-concurrent-${i}`
      const state = createTestState(sessionId)
      return queue.queueWrite(sessionId, state, 'session_created')
    })

    await Promise.all(jobs)

    const metrics = await queue.getMetrics()
    expect(metrics.waiting + metrics.active + metrics.completed).toBeGreaterThanOrEqual(5)

    // Wait for processing
    await new Promise((resolve) => setTimeout(resolve, 3000))

    // Cleanup
    for (let i = 0; i < 5; i++) {
      const sessionId = `test-concurrent-${i}`
      await pool.query('DELETE FROM sync_events WHERE session_id = $1', [sessionId])
      await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', [sessionId])
    }
  })
})
