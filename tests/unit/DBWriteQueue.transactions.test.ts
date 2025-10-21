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

describe('DBWriteQueue - Transaction Handling', () => {
  let queue: DBWriteQueue
  let originalConnect: typeof pool.connect

  beforeEach(() => {
    queue = new DBWriteQueue(process.env.REDIS_URL!)
    originalConnect = pool.connect
  })

  afterEach(async () => {
    pool.connect = originalConnect
    vi.restoreAllMocks()
    await queue.close()
  })

  it('should rollback on sync_sessions insert failure', async () => {
    const rollbackSpy = vi.fn()
    const releaseSpy = vi.fn()

    const mockClient = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('BEGIN')) {
          return { rows: [], rowCount: 0 }
        }
        if (sql.includes('INSERT INTO sync_sessions')) {
          throw new Error('sync_sessions insert failed')
        }
        if (sql.includes('ROLLBACK')) {
          rollbackSpy()
          return { rows: [], rowCount: 0 }
        }
        return { rows: [], rowCount: 0 }
      }),
      release: releaseSpy,
    }

    pool.connect = vi.fn(async () => mockClient) as any

    const state = createTestState('test-rollback-sessions')
    await queue.queueWrite('test-rollback-sessions', state, 'session_created')

    // Wait for job to process
    await new Promise(resolve => setTimeout(resolve, 3000))

    // Verify ROLLBACK was called
    expect(rollbackSpy).toHaveBeenCalled()

    // Verify client was released
    expect(releaseSpy).toHaveBeenCalled()

    // Verify NO data written to database (rollback successful)
    const sessionsResult = await pool.query(
      'SELECT * FROM sync_sessions WHERE session_id = $1',
      ['test-rollback-sessions']
    )
    expect(sessionsResult.rows.length).toBe(0)

    const eventsResult = await pool.query('SELECT * FROM sync_events WHERE session_id = $1', [
      'test-rollback-sessions',
    ])
    expect(eventsResult.rows.length).toBe(0)
  }, 15000)

  it('should rollback on sync_events insert failure', async () => {
    const rollbackSpy = vi.fn()
    const releaseSpy = vi.fn()

    const mockClient = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('BEGIN')) {
          return { rows: [], rowCount: 0 }
        }
        if (sql.includes('INSERT INTO sync_sessions')) {
          // First insert succeeds
          return { rows: [], rowCount: 1 }
        }
        if (sql.includes('INSERT INTO sync_events')) {
          // Second insert fails
          throw new Error('sync_events insert failed')
        }
        if (sql.includes('ROLLBACK')) {
          rollbackSpy()
          return { rows: [], rowCount: 0 }
        }
        return { rows: [], rowCount: 0 }
      }),
      release: releaseSpy,
    }

    pool.connect = vi.fn(async () => mockClient) as any

    const state = createTestState('test-rollback-events')
    await queue.queueWrite('test-rollback-events', state, 'session_created')

    // Wait for job to process
    await new Promise(resolve => setTimeout(resolve, 3000))

    // Verify ROLLBACK was called
    expect(rollbackSpy).toHaveBeenCalled()

    // Verify client was released
    expect(releaseSpy).toHaveBeenCalled()

    // Verify NO data in sync_sessions (rolled back)
    const sessionsResult = await pool.query(
      'SELECT * FROM sync_sessions WHERE session_id = $1',
      ['test-rollback-events']
    )
    expect(sessionsResult.rows.length).toBe(0)

    // Verify NO data in sync_events
    const eventsResult = await pool.query('SELECT * FROM sync_events WHERE session_id = $1', [
      'test-rollback-events',
    ])
    expect(eventsResult.rows.length).toBe(0)
  }, 15000)

  it('should commit both writes on success', async () => {
    const commitSpy = vi.fn()
    const releaseSpy = vi.fn()

    const mockClient = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('BEGIN')) {
          return { rows: [], rowCount: 0 }
        }
        if (sql.includes('COMMIT')) {
          commitSpy()
          // Actually commit to real database
          return originalConnect.call(pool).then(client => {
            return client.query(sql).finally(() => client.release())
          })
        }
        // For INSERT statements, use real connection
        return originalConnect.call(pool).then(client => {
          return client.query(sql).finally(() => client.release())
        })
      }),
      release: releaseSpy,
    }

    pool.connect = vi.fn(async () => mockClient) as any

    const state = createTestState('test-commit-success')
    await queue.queueWrite('test-commit-success', state, 'session_created')

    // Wait for job to process
    await new Promise(resolve => setTimeout(resolve, 3000))

    // Verify COMMIT was called
    expect(commitSpy).toHaveBeenCalled()

    // Verify client was released
    expect(releaseSpy).toHaveBeenCalled()

    // Verify data exists in both tables
    const sessionsResult = await pool.query(
      'SELECT * FROM sync_sessions WHERE session_id = $1',
      ['test-commit-success']
    )
    expect(sessionsResult.rows.length).toBe(1)

    const eventsResult = await pool.query('SELECT * FROM sync_events WHERE session_id = $1', [
      'test-commit-success',
    ])
    expect(eventsResult.rows.length).toBeGreaterThan(0)

    // Cleanup
    await pool.query('DELETE FROM sync_events WHERE session_id = $1', ['test-commit-success'])
    await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', ['test-commit-success'])
  }, 15000)

  it('should release client connection even on failure', async () => {
    const releaseSpy = vi.fn()

    const mockClient = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('INSERT INTO sync_sessions')) {
          throw new Error('Simulated database error')
        }
        return { rows: [], rowCount: 0 }
      }),
      release: releaseSpy,
    }

    pool.connect = vi.fn(async () => mockClient) as any

    const state = createTestState('test-release-on-error')
    await queue.queueWrite('test-release-on-error', state, 'session_created')

    // Wait for job to process and fail
    await new Promise(resolve => setTimeout(resolve, 3000))

    // Verify client.release() was called despite error
    expect(releaseSpy).toHaveBeenCalled()
  }, 15000)

  it('should release client connection even on ROLLBACK failure', async () => {
    const releaseSpy = vi.fn()
    let rollbackAttempted = false

    const mockClient = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('INSERT INTO sync_sessions')) {
          throw new Error('Insert failed')
        }
        if (sql.includes('ROLLBACK')) {
          rollbackAttempted = true
          throw new Error('ROLLBACK failed')
        }
        return { rows: [], rowCount: 0 }
      }),
      release: releaseSpy,
    }

    pool.connect = vi.fn(async () => mockClient) as any

    const state = createTestState('test-release-on-rollback-error')
    await queue.queueWrite('test-release-on-rollback-error', state, 'session_created')

    // Wait for job to process and fail
    await new Promise(resolve => setTimeout(resolve, 3000))

    // Verify ROLLBACK was attempted
    expect(rollbackAttempted).toBe(true)

    // Verify client.release() was still called
    expect(releaseSpy).toHaveBeenCalled()
  }, 15000)

  it('should handle transaction deadlock correctly', async () => {
    let attemptCount = 0
    const releaseSpy = vi.fn()

    const mockClient = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('INSERT INTO sync_sessions')) {
          attemptCount++
          if (attemptCount < 3) {
            // Simulate deadlock on first 2 attempts
            throw new Error('deadlock detected')
          }
          // Succeed on 3rd attempt
          return { rows: [], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      }),
      release: releaseSpy,
    }

    pool.connect = vi.fn(async () => mockClient) as any

    const state = createTestState('test-deadlock-retry')
    await queue.queueWrite('test-deadlock-retry', state, 'session_created')

    // Wait for retries and eventual success
    await new Promise(resolve => setTimeout(resolve, 15000))

    // Verify job eventually succeeded after retries
    expect(attemptCount).toBeGreaterThanOrEqual(3)

    // Verify connection was released each time
    expect(releaseSpy.mock.calls.length).toBeGreaterThanOrEqual(3)
  }, 25000)
})
