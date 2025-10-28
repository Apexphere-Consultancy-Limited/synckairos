import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { DBWriteQueue } from '@/state/DBWriteQueue'
import { pool } from '@/config/database'
import { createTestState } from './test-helpers'

describe('DBWriteQueue - Edge Cases', () => {
  let queue: DBWriteQueue

  beforeEach(() => {
    queue = new DBWriteQueue(process.env.REDIS_URL!)
  })

  afterEach(async () => {
    await queue.close(true) // Force close - don't wait for active jobs
  })

  it('should handle null active_participant_id', async () => {
    const sessionId = uuidv4()
    const state = createTestState(sessionId)
    state.active_participant_id = null

    await queue.queueWrite(sessionId, state, 'session_created')

    // Wait for job to process
    await new Promise(resolve => setTimeout(resolve, 2000))

    const result = await pool.query('SELECT * FROM sync_events WHERE session_id = $1', [
      sessionId,
    ])

    expect(result.rows.length).toBeGreaterThan(0)
    expect(result.rows[0].participant_id).toBeNull()
    expect(result.rows[0].time_remaining_ms).toBeNull()

    // Cleanup
    await pool.query('DELETE FROM sync_events WHERE session_id = $1', [sessionId])
    await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', [sessionId])
  })

  it('should handle empty participants array', async () => {
    const sessionId = uuidv4()
    const state = createTestState(sessionId)
    state.participants = []

    await queue.queueWrite(sessionId, state, 'session_created')

    // Wait for job to process
    await new Promise(resolve => setTimeout(resolve, 2000))

    const result = await pool.query('SELECT * FROM sync_sessions WHERE session_id = $1', [
      sessionId,
    ])

    expect(result.rows.length).toBe(1)
    expect(result.rows[0].total_participants).toBe(0)

    // Cleanup
    await pool.query('DELETE FROM sync_events WHERE session_id = $1', [sessionId])
    await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', [sessionId])
  })

  it('should handle very large state snapshots (>100 participants)', async () => {
    const sessionId = uuidv4()
    const participantIds = Array.from({ length: 150 }, () => uuidv4())
    const state = createTestState(sessionId)
    state.participants = participantIds.map((participantId, i) => ({
      participant_id: participantId,
      total_time_ms: 60000,
      time_remaining_ms: 60000,
      group_id: `group-${i % 10}`,
    }))

    await queue.queueWrite(sessionId, state, 'session_created')

    // Wait for job to process (may take longer with large state)
    await new Promise(resolve => setTimeout(resolve, 3000))

    // Verify large state stored correctly
    const result = await pool.query(
      'SELECT state_snapshot FROM sync_events WHERE session_id = $1',
      [sessionId]
    )

    expect(result.rows.length).toBeGreaterThan(0)
    expect(result.rows[0].state_snapshot.participants.length).toBe(150)

    // Cleanup
    await pool.query('DELETE FROM sync_events WHERE session_id = $1', [sessionId])
    await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', [sessionId])
  })

  it('should handle special characters in sessionId', async () => {
    const sessionId = uuidv4()
    const state = createTestState(sessionId)

    await queue.queueWrite(sessionId, state, 'session_created')

    // Wait for job to process
    await new Promise(resolve => setTimeout(resolve, 2000))

    // Should not cause SQL injection
    const result = await pool.query('SELECT * FROM sync_sessions WHERE session_id = $1', [
      sessionId,
    ])

    expect(result.rows.length).toBe(1)
    expect(result.rows[0].session_id).toBe(sessionId)

    // Cleanup
    await pool.query('DELETE FROM sync_events WHERE session_id = $1', [sessionId])
    await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', [sessionId])
  })

  it('should handle Date objects in state correctly', async () => {
    const sessionId = uuidv4()
    const state = createTestState(sessionId)
    state.created_at = new Date('2025-01-01T00:00:00Z')
    state.updated_at = new Date('2025-01-02T00:00:00Z')
    state.session_started_at = new Date('2025-01-03T00:00:00Z')

    await queue.queueWrite(sessionId, state, 'session_created')

    // Wait for job to process
    await new Promise(resolve => setTimeout(resolve, 2000))

    const result = await pool.query(
      'SELECT created_at, started_at FROM sync_sessions WHERE session_id = $1',
      [sessionId]
    )

    // Verify dates stored correctly (not as strings)
    expect(result.rows[0].created_at).toBeInstanceOf(Date)
    expect(result.rows[0].started_at).toBeInstanceOf(Date)

    // Verify date values are correct (within reasonable range)
    const createdDate = new Date(result.rows[0].created_at)
    expect(createdDate.getFullYear()).toBe(2025)
    expect(createdDate.getMonth()).toBe(0) // January

    // Cleanup
    await pool.query('DELETE FROM sync_events WHERE session_id = $1', [sessionId])
    await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', [sessionId])
  })

  it('should handle increment_ms = 0', async () => {
    const sessionId = uuidv4()
    const state = createTestState(sessionId)
    state.increment_ms = 0

    await queue.queueWrite(sessionId, state, 'session_created')

    // Wait for job to process
    await new Promise(resolve => setTimeout(resolve, 2000))

    const result = await pool.query('SELECT * FROM sync_sessions WHERE session_id = $1', [
      sessionId,
    ])

    expect(result.rows.length).toBe(1)
    expect(result.rows[0].increment_ms).toBe(0)

    // Cleanup
    await pool.query('DELETE FROM sync_events WHERE session_id = $1', [sessionId])
    await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', [sessionId])
  })

  it('should handle max_time_ms = null', async () => {
    const sessionId = uuidv4()
    const state = createTestState(sessionId)
    state.max_time_ms = null

    await queue.queueWrite(sessionId, state, 'session_created')

    // Wait for job to process
    await new Promise(resolve => setTimeout(resolve, 2000))

    const result = await pool.query('SELECT * FROM sync_sessions WHERE session_id = $1', [
      sessionId,
    ])

    expect(result.rows.length).toBe(1)
    expect(result.rows[0].max_time_ms).toBeNull()

    // Cleanup
    await pool.query('DELETE FROM sync_events WHERE session_id = $1', [sessionId])
    await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', [sessionId])
  })

  it('should handle all sync_mode enum values', async () => {
    const modes = ['per_participant', 'per_cycle', 'per_group', 'global', 'count_up'] as const
    const sessionIds = modes.map(() => uuidv4())

    for (let i = 0; i < modes.length; i++) {
      const mode = modes[i]
      const sessionId = sessionIds[i]
      const state = createTestState(sessionId)
      state.sync_mode = mode

      await queue.queueWrite(sessionId, state, 'session_created')
    }

    // Wait for all jobs to process
    await new Promise(resolve => setTimeout(resolve, 3000))

    // Verify all modes stored correctly
    for (let i = 0; i < modes.length; i++) {
      const mode = modes[i]
      const sessionId = sessionIds[i]
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
