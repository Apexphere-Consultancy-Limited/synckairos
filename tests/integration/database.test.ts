/**
 * PostgreSQL Database Integration Tests
 *
 * Tests the PostgreSQL schema setup and connection
 * Note: PostgreSQL is AUDIT ONLY - Redis is PRIMARY source of truth
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { pool, healthCheck } from '@/config/database'

describe('PostgreSQL Database', () => {
  beforeAll(async () => {
    // Ensure migrations have been run
    // Run: pnpm run migrate
  })

  afterAll(async () => {
    await pool.end()
  })

  it('should connect to database', async () => {
    const isHealthy = await healthCheck()
    expect(isHealthy).toBe(true)
  })

  it('should have sync_sessions table', async () => {
    const result = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_name = 'sync_sessions'
    `)
    expect(result.rows.length).toBe(1)
  })

  it('should have sync_events table', async () => {
    const result = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_name = 'sync_events'
    `)
    expect(result.rows.length).toBe(1)
  })

  it('should have sync_participants table', async () => {
    const result = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_name = 'sync_participants'
    `)
    expect(result.rows.length).toBe(1)
  })

  it('should have sync_mode enum', async () => {
    const result = await pool.query(`
      SELECT typname, typelem
      FROM pg_type
      WHERE typname = 'sync_mode'
    `)
    expect(result.rows.length).toBe(1)
  })

  it('should have sync_status enum', async () => {
    const result = await pool.query(`
      SELECT typname, typelem
      FROM pg_type
      WHERE typname = 'sync_status'
    `)
    expect(result.rows.length).toBe(1)
  })

  it('should insert into sync_sessions', async () => {
    const sessionId = `test-session-${Date.now()}`

    await pool.query(`
      INSERT INTO sync_sessions (session_id, sync_mode, created_at)
      VALUES ($1, $2, NOW())
    `, [sessionId, 'per_participant'])

    const result = await pool.query(`
      SELECT * FROM sync_sessions WHERE session_id = $1
    `, [sessionId])

    expect(result.rows.length).toBe(1)
    expect(result.rows[0].sync_mode).toBe('per_participant')
    expect(result.rows[0].total_cycles).toBe(0)
    expect(result.rows[0].total_participants).toBe(0)

    // Cleanup
    await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', [sessionId])
  })

  it('should insert into sync_events', async () => {
    const sessionId = `test-session-${Date.now()}`

    // First create session
    await pool.query(`
      INSERT INTO sync_sessions (session_id, sync_mode)
      VALUES ($1, $2)
    `, [sessionId, 'per_participant'])

    // Then create event
    await pool.query(`
      INSERT INTO sync_events (session_id, event_type, timestamp)
      VALUES ($1, $2, NOW())
    `, [sessionId, 'session_created'])

    const result = await pool.query(`
      SELECT * FROM sync_events WHERE session_id = $1
    `, [sessionId])

    expect(result.rows.length).toBe(1)
    expect(result.rows[0].event_type).toBe('session_created')

    // Cleanup
    await pool.query('DELETE FROM sync_events WHERE session_id = $1', [sessionId])
    await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', [sessionId])
  })

  it('should insert into sync_participants', async () => {
    const sessionId = `test-session-${Date.now()}`
    const participantId = `test-participant-${Date.now()}`

    // First create session
    await pool.query(`
      INSERT INTO sync_sessions (session_id, sync_mode)
      VALUES ($1, $2)
    `, [sessionId, 'per_participant'])

    // Then create participant
    await pool.query(`
      INSERT INTO sync_participants (session_id, participant_id, total_time_ms)
      VALUES ($1, $2, $3)
    `, [sessionId, participantId, 60000])

    const result = await pool.query(`
      SELECT * FROM sync_participants WHERE session_id = $1 AND participant_id = $2
    `, [sessionId, participantId])

    expect(result.rows.length).toBe(1)
    expect(result.rows[0].total_time_ms).toBe(60000)
    expect(result.rows[0].total_cycles).toBe(0)

    // Cleanup
    await pool.query('DELETE FROM sync_participants WHERE session_id = $1', [sessionId])
    await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', [sessionId])
  })

  it('should enforce unique_session_participant constraint', async () => {
    const sessionId = `test-session-${Date.now()}`
    const participantId = `test-participant-${Date.now()}`

    // Create session
    await pool.query(`
      INSERT INTO sync_sessions (session_id, sync_mode)
      VALUES ($1, $2)
    `, [sessionId, 'per_participant'])

    // Create first participant
    await pool.query(`
      INSERT INTO sync_participants (session_id, participant_id, total_time_ms)
      VALUES ($1, $2, $3)
    `, [sessionId, participantId, 60000])

    // Try to create duplicate - should fail
    await expect(
      pool.query(`
        INSERT INTO sync_participants (session_id, participant_id, total_time_ms)
        VALUES ($1, $2, $3)
      `, [sessionId, participantId, 60000])
    ).rejects.toThrow()

    // Cleanup
    await pool.query('DELETE FROM sync_participants WHERE session_id = $1', [sessionId])
    await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', [sessionId])
  })

  it('should verify indexes exist', async () => {
    const result = await pool.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename IN ('sync_sessions', 'sync_events', 'sync_participants')
    `)

    const indexNames = result.rows.map(row => row.indexname)

    // Check for key indexes
    expect(indexNames).toContain('idx_sync_sessions_created')
    expect(indexNames).toContain('idx_sync_sessions_status')
    expect(indexNames).toContain('idx_sync_sessions_mode')
    expect(indexNames).toContain('idx_sync_events_session')
    expect(indexNames).toContain('idx_sync_events_type')
    expect(indexNames).toContain('idx_sync_events_timestamp')
    expect(indexNames).toContain('idx_sync_events_participant')
    expect(indexNames).toContain('idx_sync_participants_session')
    expect(indexNames).toContain('idx_sync_participants_group')
  })

  it('should store JSONB metadata correctly', async () => {
    const sessionId = `test-session-${Date.now()}`
    const metadata = {
      creator: 'test-user',
      source: 'integration-test',
      tags: ['test', 'integration']
    }

    await pool.query(`
      INSERT INTO sync_sessions (session_id, sync_mode, metadata)
      VALUES ($1, $2, $3)
    `, [sessionId, 'per_participant', JSON.stringify(metadata)])

    const result = await pool.query(`
      SELECT metadata FROM sync_sessions WHERE session_id = $1
    `, [sessionId])

    expect(result.rows.length).toBe(1)
    expect(result.rows[0].metadata).toEqual(metadata)

    // Cleanup
    await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', [sessionId])
  })

  it('should store state_snapshot JSONB in sync_events', async () => {
    const sessionId = `test-session-${Date.now()}`
    const stateSnapshot = {
      session_id: sessionId,
      sync_mode: 'per_participant',
      status: 'running',
      version: 5,
      time_remaining_ms: 45000
    }

    // Create session
    await pool.query(`
      INSERT INTO sync_sessions (session_id, sync_mode)
      VALUES ($1, $2)
    `, [sessionId, 'per_participant'])

    // Create event with state snapshot
    await pool.query(`
      INSERT INTO sync_events (session_id, event_type, state_snapshot)
      VALUES ($1, $2, $3)
    `, [sessionId, 'cycle_switched', JSON.stringify(stateSnapshot)])

    const result = await pool.query(`
      SELECT state_snapshot FROM sync_events WHERE session_id = $1
    `, [sessionId])

    expect(result.rows.length).toBe(1)
    expect(result.rows[0].state_snapshot).toEqual(stateSnapshot)

    // Cleanup
    await pool.query('DELETE FROM sync_events WHERE session_id = $1', [sessionId])
    await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', [sessionId])
  })
})
