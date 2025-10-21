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

  describe('Enum Validation', () => {
    it('should have all sync_mode enum values', async () => {
      const result = await pool.query(`
        SELECT enumlabel
        FROM pg_enum
        WHERE enumtypid = 'sync_mode'::regtype
        ORDER BY enumsortorder
      `)

      const values = result.rows.map(r => r.enumlabel)
      expect(values).toEqual([
        'per_participant',
        'per_cycle',
        'per_group',
        'global',
        'count_up',
      ])
    })

    it('should have all sync_status enum values', async () => {
      const result = await pool.query(`
        SELECT enumlabel
        FROM pg_enum
        WHERE enumtypid = 'sync_status'::regtype
        ORDER BY enumsortorder
      `)

      const values = result.rows.map(r => r.enumlabel)
      expect(values).toEqual([
        'pending',
        'running',
        'paused',
        'expired',
        'completed',
        'cancelled',
      ])
    })

    it('should reject invalid sync_mode values', async () => {
      const sessionId = `test-session-${Date.now()}`

      await expect(
        pool.query(`
          INSERT INTO sync_sessions (session_id, sync_mode)
          VALUES ($1, $2)
        `, [sessionId, 'invalid_mode'])
      ).rejects.toThrow()
    })

    it('should reject invalid sync_status values', async () => {
      const sessionId = `test-session-${Date.now()}`

      await pool.query(`
        INSERT INTO sync_sessions (session_id, sync_mode)
        VALUES ($1, $2)
      `, [sessionId, 'per_participant'])

      await expect(
        pool.query(`
          UPDATE sync_sessions SET final_status = $1 WHERE session_id = $2
        `, ['invalid_status', sessionId])
      ).rejects.toThrow()

      // Cleanup
      await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', [sessionId])
    })
  })

  describe('Constraint Validation', () => {
    it('should enforce NOT NULL on session_id', async () => {
      await expect(
        pool.query(`
          INSERT INTO sync_sessions (sync_mode)
          VALUES ($1)
        `, ['per_participant'])
      ).rejects.toThrow()
    })

    it('should enforce NOT NULL on sync_mode', async () => {
      const sessionId = `test-session-${Date.now()}`

      await expect(
        pool.query(`
          INSERT INTO sync_sessions (session_id)
          VALUES ($1)
        `, [sessionId])
      ).rejects.toThrow()
    })

    it('should apply DEFAULT values for integers', async () => {
      const sessionId = `test-session-${Date.now()}`

      await pool.query(`
        INSERT INTO sync_sessions (session_id, sync_mode)
        VALUES ($1, $2)
      `, [sessionId, 'per_participant'])

      const result = await pool.query(`
        SELECT total_cycles, total_participants, increment_ms
        FROM sync_sessions WHERE session_id = $1
      `, [sessionId])

      expect(result.rows[0].total_cycles).toBe(0)
      expect(result.rows[0].total_participants).toBe(0)
      expect(result.rows[0].increment_ms).toBe(0)

      // Cleanup
      await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', [sessionId])
    })

    it('should apply DEFAULT for JSONB metadata', async () => {
      const sessionId = `test-session-${Date.now()}`

      await pool.query(`
        INSERT INTO sync_sessions (session_id, sync_mode)
        VALUES ($1, $2)
      `, [sessionId, 'per_participant'])

      const result = await pool.query(`
        SELECT metadata FROM sync_sessions WHERE session_id = $1
      `, [sessionId])

      expect(result.rows[0].metadata).toEqual({})

      // Cleanup
      await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', [sessionId])
    })

    it('should auto-generate UUID for sync_events.id', async () => {
      const sessionId = `test-session-${Date.now()}`

      // Create session first
      await pool.query(`
        INSERT INTO sync_sessions (session_id, sync_mode)
        VALUES ($1, $2)
      `, [sessionId, 'per_participant'])

      // Insert event without specifying id
      await pool.query(`
        INSERT INTO sync_events (session_id, event_type)
        VALUES ($1, $2)
      `, [sessionId, 'session_created'])

      const result = await pool.query(`
        SELECT id FROM sync_events WHERE session_id = $1
      `, [sessionId])

      expect(result.rows[0].id).toBeDefined()
      expect(typeof result.rows[0].id).toBe('string')
      expect(result.rows[0].id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      )

      // Cleanup
      await pool.query('DELETE FROM sync_events WHERE session_id = $1', [sessionId])
      await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', [sessionId])
    })

    it('should set timestamp defaults to NOW()', async () => {
      const sessionId = `test-session-${Date.now()}`
      const before = new Date()

      await pool.query(`
        INSERT INTO sync_sessions (session_id, sync_mode)
        VALUES ($1, $2)
      `, [sessionId, 'per_participant'])

      const after = new Date()

      const result = await pool.query(`
        SELECT created_at, last_updated_at FROM sync_sessions WHERE session_id = $1
      `, [sessionId])

      const createdAt = new Date(result.rows[0].created_at)
      const updatedAt = new Date(result.rows[0].last_updated_at)

      expect(createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(createdAt.getTime()).toBeLessThanOrEqual(after.getTime())
      expect(updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(updatedAt.getTime()).toBeLessThanOrEqual(after.getTime())

      // Cleanup
      await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', [sessionId])
    })
  })

  describe('Edge Cases and Boundaries', () => {
    it('should handle maximum VARCHAR(50) length for event_type', async () => {
      const sessionId = `test-session-${Date.now()}`
      const maxLengthEventType = 'a'.repeat(50)

      // Create session
      await pool.query(`
        INSERT INTO sync_sessions (session_id, sync_mode)
        VALUES ($1, $2)
      `, [sessionId, 'per_participant'])

      // Should accept 50 characters
      await pool.query(`
        INSERT INTO sync_events (session_id, event_type)
        VALUES ($1, $2)
      `, [sessionId, maxLengthEventType])

      // Should reject 51 characters
      await expect(
        pool.query(`
          INSERT INTO sync_events (session_id, event_type)
          VALUES ($1, $2)
        `, [sessionId, 'a'.repeat(51)])
      ).rejects.toThrow()

      // Cleanup
      await pool.query('DELETE FROM sync_events WHERE session_id = $1', [sessionId])
      await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', [sessionId])
    })

    it('should handle large JSONB state_snapshot', async () => {
      const sessionId = `test-session-${Date.now()}`

      // Create session
      await pool.query(`
        INSERT INTO sync_sessions (session_id, sync_mode)
        VALUES ($1, $2)
      `, [sessionId, 'per_participant'])

      // Create large state snapshot with 100 participants
      const largeSnapshot = {
        session_id: sessionId,
        sync_mode: 'per_participant',
        participants: Array.from({ length: 100 }, (_, i) => ({
          participant_id: `participant-${i}`,
          total_time_ms: 60000,
          time_remaining_ms: 30000,
        })),
      }

      await pool.query(`
        INSERT INTO sync_events (session_id, event_type, state_snapshot)
        VALUES ($1, $2, $3)
      `, [sessionId, 'session_created', JSON.stringify(largeSnapshot)])

      const result = await pool.query(`
        SELECT state_snapshot FROM sync_events WHERE session_id = $1
      `, [sessionId])

      expect(result.rows[0].state_snapshot).toEqual(largeSnapshot)
      expect(result.rows[0].state_snapshot.participants).toHaveLength(100)

      // Cleanup
      await pool.query('DELETE FROM sync_events WHERE session_id = $1', [sessionId])
      await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', [sessionId])
    })

    it('should handle negative integer values', async () => {
      const sessionId = `test-session-${Date.now()}`

      await pool.query(`
        INSERT INTO sync_sessions (session_id, sync_mode, time_per_cycle_ms)
        VALUES ($1, $2, $3)
      `, [sessionId, 'per_participant', -1000])

      const result = await pool.query(`
        SELECT time_per_cycle_ms FROM sync_sessions WHERE session_id = $1
      `, [sessionId])

      expect(result.rows[0].time_per_cycle_ms).toBe(-1000)

      // Cleanup
      await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', [sessionId])
    })

    it('should handle very large integer values', async () => {
      const sessionId = `test-session-${Date.now()}`
      const largeValue = 2147483647 // Max 32-bit integer

      await pool.query(`
        INSERT INTO sync_sessions (session_id, sync_mode, max_time_ms)
        VALUES ($1, $2, $3)
      `, [sessionId, 'per_participant', largeValue])

      const result = await pool.query(`
        SELECT max_time_ms FROM sync_sessions WHERE session_id = $1
      `, [sessionId])

      expect(result.rows[0].max_time_ms).toBe(largeValue)

      // Cleanup
      await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', [sessionId])
    })

    it('should handle NULL values for optional fields', async () => {
      const sessionId = `test-session-${Date.now()}`

      await pool.query(`
        INSERT INTO sync_sessions (
          session_id,
          sync_mode,
          time_per_cycle_ms,
          started_at,
          final_status
        )
        VALUES ($1, $2, $3, $4, $5)
      `, [sessionId, 'per_participant', null, null, null])

      const result = await pool.query(`
        SELECT time_per_cycle_ms, started_at, final_status
        FROM sync_sessions WHERE session_id = $1
      `, [sessionId])

      expect(result.rows[0].time_per_cycle_ms).toBeNull()
      expect(result.rows[0].started_at).toBeNull()
      expect(result.rows[0].final_status).toBeNull()

      // Cleanup
      await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', [sessionId])
    })

    it('should handle far future timestamps', async () => {
      const sessionId = `test-session-${Date.now()}`
      const farFuture = new Date('2099-12-31T23:59:59Z')

      await pool.query(`
        INSERT INTO sync_sessions (session_id, sync_mode, created_at)
        VALUES ($1, $2, $3)
      `, [sessionId, 'per_participant', farFuture])

      const result = await pool.query(`
        SELECT created_at FROM sync_sessions WHERE session_id = $1
      `, [sessionId])

      const retrievedDate = new Date(result.rows[0].created_at)
      expect(retrievedDate.getTime()).toBe(farFuture.getTime())

      // Cleanup
      await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', [sessionId])
    })

    it('should handle empty JSONB object', async () => {
      const sessionId = `test-session-${Date.now()}`

      await pool.query(`
        INSERT INTO sync_sessions (session_id, sync_mode, metadata)
        VALUES ($1, $2, $3)
      `, [sessionId, 'per_participant', JSON.stringify({})])

      const result = await pool.query(`
        SELECT metadata FROM sync_sessions WHERE session_id = $1
      `, [sessionId])

      expect(result.rows[0].metadata).toEqual({})

      // Cleanup
      await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', [sessionId])
    })
  })
})
