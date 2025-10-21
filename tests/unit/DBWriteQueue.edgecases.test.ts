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

describe('DBWriteQueue - Edge Cases', () => {
  let queue: DBWriteQueue

  beforeEach(() => {
    queue = new DBWriteQueue(process.env.REDIS_URL!)
  })

  afterEach(async () => {
    await queue.close()
  })

  it('should handle null active_participant_id', async () => {
    const state = createTestState('test-null-participant')
    state.active_participant_id = null

    await queue.queueWrite('test-null-participant', state, 'session_created')

    // Wait for job to process
    await new Promise(resolve => setTimeout(resolve, 2000))

    const result = await pool.query('SELECT * FROM sync_events WHERE session_id = $1', [
      'test-null-participant',
    ])

    expect(result.rows.length).toBeGreaterThan(0)
    expect(result.rows[0].participant_id).toBeNull()
    expect(result.rows[0].time_remaining_ms).toBeNull()

    // Cleanup
    await pool.query('DELETE FROM sync_events WHERE session_id = $1', ['test-null-participant'])
    await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', ['test-null-participant'])
  })

  it('should handle empty participants array', async () => {
    const state = createTestState('test-empty-participants')
    state.participants = []

    await queue.queueWrite('test-empty-participants', state, 'session_created')

    // Wait for job to process
    await new Promise(resolve => setTimeout(resolve, 2000))

    const result = await pool.query('SELECT * FROM sync_sessions WHERE session_id = $1', [
      'test-empty-participants',
    ])

    expect(result.rows.length).toBe(1)
    expect(result.rows[0].total_participants).toBe(0)

    // Cleanup
    await pool.query('DELETE FROM sync_events WHERE session_id = $1', ['test-empty-participants'])
    await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', ['test-empty-participants'])
  })

  it('should handle very large state snapshots (>100 participants)', async () => {
    const state = createTestState('test-large-state')
    state.participants = Array.from({ length: 150 }, (_, i) => ({
      participant_id: `participant-${i}`,
      total_time_ms: 60000,
      time_remaining_ms: 60000,
      group_id: `group-${i % 10}`,
    }))

    await queue.queueWrite('test-large-state', state, 'session_created')

    // Wait for job to process (may take longer with large state)
    await new Promise(resolve => setTimeout(resolve, 3000))

    // Verify large state stored correctly
    const result = await pool.query(
      'SELECT state_snapshot FROM sync_events WHERE session_id = $1',
      ['test-large-state']
    )

    expect(result.rows.length).toBeGreaterThan(0)
    expect(result.rows[0].state_snapshot.participants.length).toBe(150)

    // Cleanup
    await pool.query('DELETE FROM sync_events WHERE session_id = $1', ['test-large-state'])
    await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', ['test-large-state'])
  })

  it('should handle special characters in sessionId', async () => {
    const specialId = "test-session-with-'quotes\"and<html>"
    const state = createTestState(specialId)

    await queue.queueWrite(specialId, state, 'session_created')

    // Wait for job to process
    await new Promise(resolve => setTimeout(resolve, 2000))

    // Should not cause SQL injection
    const result = await pool.query('SELECT * FROM sync_sessions WHERE session_id = $1', [
      specialId,
    ])

    expect(result.rows.length).toBe(1)
    expect(result.rows[0].session_id).toBe(specialId)

    // Cleanup
    await pool.query('DELETE FROM sync_events WHERE session_id = $1', [specialId])
    await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', [specialId])
  })

  it('should handle Date objects in state correctly', async () => {
    const state = createTestState('test-date-handling')
    state.created_at = new Date('2025-01-01T00:00:00Z')
    state.updated_at = new Date('2025-01-02T00:00:00Z')
    state.session_started_at = new Date('2025-01-03T00:00:00Z')

    await queue.queueWrite('test-date-handling', state, 'session_created')

    // Wait for job to process
    await new Promise(resolve => setTimeout(resolve, 2000))

    const result = await pool.query(
      'SELECT created_at, started_at FROM sync_sessions WHERE session_id = $1',
      ['test-date-handling']
    )

    // Verify dates stored correctly (not as strings)
    expect(result.rows[0].created_at).toBeInstanceOf(Date)
    expect(result.rows[0].started_at).toBeInstanceOf(Date)

    // Verify date values are correct (within reasonable range)
    const createdDate = new Date(result.rows[0].created_at)
    expect(createdDate.getFullYear()).toBe(2025)
    expect(createdDate.getMonth()).toBe(0) // January

    // Cleanup
    await pool.query('DELETE FROM sync_events WHERE session_id = $1', ['test-date-handling'])
    await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', ['test-date-handling'])
  })

  it('should handle increment_ms = 0', async () => {
    const state = createTestState('test-zero-increment')
    state.increment_ms = 0

    await queue.queueWrite('test-zero-increment', state, 'session_created')

    // Wait for job to process
    await new Promise(resolve => setTimeout(resolve, 2000))

    const result = await pool.query('SELECT * FROM sync_sessions WHERE session_id = $1', [
      'test-zero-increment',
    ])

    expect(result.rows.length).toBe(1)
    expect(result.rows[0].increment_ms).toBe(0)

    // Cleanup
    await pool.query('DELETE FROM sync_events WHERE session_id = $1', ['test-zero-increment'])
    await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', ['test-zero-increment'])
  })

  it('should handle max_time_ms = null', async () => {
    const state = createTestState('test-null-max-time')
    state.max_time_ms = null

    await queue.queueWrite('test-null-max-time', state, 'session_created')

    // Wait for job to process
    await new Promise(resolve => setTimeout(resolve, 2000))

    const result = await pool.query('SELECT * FROM sync_sessions WHERE session_id = $1', [
      'test-null-max-time',
    ])

    expect(result.rows.length).toBe(1)
    expect(result.rows[0].max_time_ms).toBeNull()

    // Cleanup
    await pool.query('DELETE FROM sync_events WHERE session_id = $1', ['test-null-max-time'])
    await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', ['test-null-max-time'])
  })

  it('should handle all sync_mode enum values', async () => {
    const modes = ['per_participant', 'per_cycle', 'per_group', 'global', 'count_up'] as const

    for (const mode of modes) {
      const sessionId = `test-sync-mode-${mode}`
      const state = createTestState(sessionId)
      state.sync_mode = mode

      await queue.queueWrite(sessionId, state, 'session_created')
    }

    // Wait for all jobs to process
    await new Promise(resolve => setTimeout(resolve, 3000))

    // Verify all modes stored correctly
    for (const mode of modes) {
      const sessionId = `test-sync-mode-${mode}`
      const result = await pool.query('SELECT * FROM sync_sessions WHERE session_id = $1', [
        sessionId,
      ])

      expect(result.rows.length).toBe(1)
      expect(result.rows[0].sync_mode).toBe(mode)

      // Cleanup
      await pool.query('DELETE FROM sync_events WHERE session_id = $1', [sessionId])
      await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', [sessionId])
    }
  })
})
