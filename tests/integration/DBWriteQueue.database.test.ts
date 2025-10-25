import { describe, it, expect, beforeEach, afterEach } from 'vitest'
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

describe('DBWriteQueue - Database Integration', () => {
  let queue: DBWriteQueue

  beforeEach(() => {
    queue = new DBWriteQueue(process.env.REDIS_URL!)
  })

  afterEach(async () => {
    await queue.close(true) // Force close - don't wait for active jobs
  })

  it('should write session to sync_sessions table', async () => {
    const sessionId = '123e4567-e89b-12d3-a456-426614174001'
    const state = createTestState(sessionId)

    await queue.queueWrite(sessionId, state, 'session_created')

    // Wait for job to process
    await new Promise((resolve) => setTimeout(resolve, 2000))

    const result = await pool.query('SELECT * FROM sync_sessions WHERE session_id = $1', [
      sessionId,
    ])

    expect(result.rows.length).toBe(1)
    expect(result.rows[0].sync_mode).toBe(state.sync_mode)

    // Cleanup
    await pool.query('DELETE FROM sync_events WHERE session_id = $1', [sessionId])
    await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', [sessionId])
  })

  it('should write event to sync_events table', async () => {
    const sessionId = '123e4567-e89b-12d3-a456-426614174002'
    const state = createTestState(sessionId)

    await queue.queueWrite(sessionId, state, 'session_started')

    // Wait for job to process
    await new Promise((resolve) => setTimeout(resolve, 2000))

    const result = await pool.query(
      'SELECT * FROM sync_events WHERE session_id = $1 ORDER BY timestamp DESC',
      [sessionId]
    )

    expect(result.rows.length).toBeGreaterThan(0)
    expect(result.rows[0].event_type).toBe('session_started')

    // Cleanup
    await pool.query('DELETE FROM sync_events WHERE session_id = $1', [sessionId])
    await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', [sessionId])
  })

  it('should store full state snapshot in sync_events', async () => {
    const sessionId = '123e4567-e89b-12d3-a456-426614174003'
    const state = createTestState(sessionId)

    await queue.queueWrite(sessionId, state, 'cycle_switched')

    // Wait for job to process
    await new Promise((resolve) => setTimeout(resolve, 2000))

    const result = await pool.query(
      'SELECT state_snapshot FROM sync_events WHERE session_id = $1',
      [sessionId]
    )

    expect(result.rows.length).toBeGreaterThan(0)
    const snapshot = result.rows[0].state_snapshot
    expect(snapshot.session_id).toBe(sessionId)
    expect(snapshot.participants).toBeDefined()

    // Cleanup
    await pool.query('DELETE FROM sync_events WHERE session_id = $1', [sessionId])
    await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', [sessionId])
  })

  it('should upsert session data on conflict', async () => {
    const sessionId = '123e4567-e89b-12d3-a456-426614174004'
    const state = createTestState(sessionId)

    // First write
    await queue.queueWrite(sessionId, state, 'session_created')
    await new Promise((resolve) => setTimeout(resolve, 2000))

    // Second write with updated state
    const updatedState = {
      ...state,
      status: 'running' as const,
      session_started_at: new Date(),
    }
    await queue.queueWrite(sessionId, updatedState, 'session_started')
    await new Promise((resolve) => setTimeout(resolve, 2000))

    const result = await pool.query('SELECT * FROM sync_sessions WHERE session_id = $1', [
      sessionId,
    ])

    expect(result.rows.length).toBe(1)
    expect(result.rows[0].final_status).toBe('running')
    expect(result.rows[0].started_at).not.toBeNull()

    // Cleanup
    await pool.query('DELETE FROM sync_events WHERE session_id = $1', [sessionId])
    await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', [sessionId])
  })

  it('should track completed jobs', async () => {
    const sessionId = '123e4567-e89b-12d3-a456-426614174005'
    const state = createTestState(sessionId)

    await queue.queueWrite(sessionId, state, 'session_created')

    // Wait for completion
    await new Promise((resolve) => setTimeout(resolve, 2000))

    const metrics = await queue.getMetrics()
    expect(metrics.completed).toBeGreaterThan(0)

    // Cleanup
    await pool.query('DELETE FROM sync_events WHERE session_id = $1', [sessionId])
    await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', [sessionId])
  })

  it('should handle multiple concurrent jobs', async () => {
    const sessionIds = [
      '123e4567-e89b-12d3-a456-426614174006',
      '123e4567-e89b-12d3-a456-426614174007',
      '123e4567-e89b-12d3-a456-426614174008',
      '123e4567-e89b-12d3-a456-426614174009',
      '123e4567-e89b-12d3-a456-426614174010',
    ]

    const jobs = sessionIds.map((sessionId) => {
      const state = createTestState(sessionId)
      return queue.queueWrite(sessionId, state, 'session_created')
    })

    await Promise.all(jobs)

    const metrics = await queue.getMetrics()
    expect(metrics.waiting + metrics.active + metrics.completed).toBeGreaterThanOrEqual(5)

    // Wait for processing
    await new Promise((resolve) => setTimeout(resolve, 3000))

    // Cleanup
    for (const sessionId of sessionIds) {
      await pool.query('DELETE FROM sync_events WHERE session_id = $1', [sessionId])
      await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', [sessionId])
    }
  })
})
