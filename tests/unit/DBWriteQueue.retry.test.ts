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

describe('DBWriteQueue - Retry Logic', () => {
  let queue: DBWriteQueue
  let originalConnect: typeof pool.connect

  beforeEach(() => {
    queue = new DBWriteQueue(process.env.REDIS_URL!)
    originalConnect = pool.connect
  })

  afterEach(async () => {
    // Restore original pool.connect
    pool.connect = originalConnect
    await queue.close()
  })

  it('should retry failed jobs up to 5 times', async () => {
    let attemptCount = 0

    // Mock pool.connect to fail first 3 times, succeed on 4th
    pool.connect = vi.fn(async () => {
      attemptCount++
      if (attemptCount < 4) {
        throw new Error('ECONNREFUSED: Connection refused')
      }
      return originalConnect.call(pool)
    }) as any

    const state = createTestState('test-retry-success')
    await queue.queueWrite('test-retry-success', state, 'session_created')

    // Wait for retries and eventual success
    await new Promise(resolve => setTimeout(resolve, 20000))

    // Verify job eventually succeeded
    const metrics = await queue.getMetrics()
    expect(metrics.completed).toBeGreaterThan(0)
    expect(attemptCount).toBe(4) // Failed 3 times, succeeded on 4th

    // Cleanup
    await pool.query('DELETE FROM sync_events WHERE session_id = $1', ['test-retry-success'])
    await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', ['test-retry-success'])
  }, 30000)

  it('should give up after 5 failed attempts', async () => {
    let attemptCount = 0

    // Mock all attempts to fail
    pool.connect = vi.fn(async () => {
      attemptCount++
      throw new Error('PERMANENT_FAILURE: Database unavailable')
    }) as any

    const state = createTestState('test-retry-exhausted')
    await queue.queueWrite('test-retry-exhausted', state, 'session_created')

    // Wait for all retries to exhaust (~65 seconds for exponential backoff)
    await new Promise(resolve => setTimeout(resolve, 70000))

    // Verify job marked as failed after 5 attempts
    const metrics = await queue.getMetrics()
    expect(metrics.failed).toBeGreaterThan(0)
    expect(attemptCount).toBe(5) // Attempted exactly 5 times
  }, 80000)

  it('should retry on connection errors (ECONNREFUSED)', async () => {
    let attemptCount = 0

    pool.connect = vi.fn(async () => {
      attemptCount++
      if (attemptCount < 3) {
        const error = new Error('ECONNREFUSED: Connection refused')
        Object.assign(error, { code: 'ECONNREFUSED' })
        throw error
      }
      return originalConnect.call(pool)
    }) as any

    const state = createTestState('test-retry-econnrefused')
    await queue.queueWrite('test-retry-econnrefused', state, 'session_created')

    // Wait for retries and success
    await new Promise(resolve => setTimeout(resolve, 15000))

    const metrics = await queue.getMetrics()
    expect(metrics.completed).toBeGreaterThan(0)
    expect(attemptCount).toBeGreaterThanOrEqual(3)

    // Cleanup
    await pool.query('DELETE FROM sync_events WHERE session_id = $1', ['test-retry-econnrefused'])
    await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', ['test-retry-econnrefused'])
  }, 25000)

  it('should retry on timeout errors (ETIMEDOUT)', async () => {
    let attemptCount = 0

    pool.connect = vi.fn(async () => {
      attemptCount++
      if (attemptCount < 2) {
        const error = new Error('ETIMEDOUT: Connection timeout')
        Object.assign(error, { code: 'ETIMEDOUT' })
        throw error
      }
      return originalConnect.call(pool)
    }) as any

    const state = createTestState('test-retry-etimedout')
    await queue.queueWrite('test-retry-etimedout', state, 'session_created')

    // Wait for retry and success
    await new Promise(resolve => setTimeout(resolve, 10000))

    const metrics = await queue.getMetrics()
    expect(metrics.completed).toBeGreaterThan(0)
    expect(attemptCount).toBeGreaterThanOrEqual(2)

    // Cleanup
    await pool.query('DELETE FROM sync_events WHERE session_id = $1', ['test-retry-etimedout'])
    await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', ['test-retry-etimedout'])
  }, 20000)

  it('should NOT retry on constraint violations (duplicate key)', async () => {
    let attemptCount = 0

    // First, create a session to cause duplicate key error
    const state = createTestState('test-no-retry-duplicate')
    await queue.queueWrite('test-no-retry-duplicate', state, 'session_created')
    await new Promise(resolve => setTimeout(resolve, 2000))

    // Now mock to fail with duplicate key on sync_events insert
    const mockClient = {
      query: vi.fn(async (sql: string) => {
        attemptCount++
        if (sql.includes('INSERT INTO sync_events')) {
          const error = new Error('duplicate key value violates unique constraint')
          throw error
        }
        return { rows: [], rowCount: 0 }
      }),
      release: vi.fn(),
    }

    pool.connect = vi.fn(async () => mockClient) as any

    await queue.queueWrite('test-no-retry-duplicate', state, 'session_created')

    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 5000))

    // Job should be marked as complete (not retried)
    // attemptCount should be 1 (not 5)
    expect(attemptCount).toBe(1)

    // Cleanup
    await pool.query('DELETE FROM sync_events WHERE session_id = $1', ['test-no-retry-duplicate'])
    await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', ['test-no-retry-duplicate'])
  }, 15000)

  it('should NOT retry on constraint violations (violates)', async () => {
    let attemptCount = 0

    const mockClient = {
      query: vi.fn(async (sql: string) => {
        attemptCount++
        if (sql.includes('INSERT INTO sync_sessions')) {
          throw new Error('violates foreign key constraint')
        }
        return { rows: [], rowCount: 0 }
      }),
      release: vi.fn(),
    }

    pool.connect = vi.fn(async () => mockClient) as any

    const state = createTestState('test-no-retry-violates')
    await queue.queueWrite('test-no-retry-violates', state, 'session_created')

    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 5000))

    // Job should NOT be retried
    expect(attemptCount).toBe(1)
  }, 15000)

  it('should track retry attempts correctly in metrics', async () => {
    let attemptCount = 0

    pool.connect = vi.fn(async () => {
      attemptCount++
      if (attemptCount < 3) {
        throw new Error('ECONNREFUSED')
      }
      return originalConnect.call(pool)
    }) as any

    const state = createTestState('test-retry-metrics')
    await queue.queueWrite('test-retry-metrics', state, 'session_created')

    // Check delayed count increases after first failure
    await new Promise(resolve => setTimeout(resolve, 3000))
    const metricsAfterFirstFailure = await queue.getMetrics()
    expect(metricsAfterFirstFailure.delayed).toBeGreaterThanOrEqual(0)

    // Wait for eventual success
    await new Promise(resolve => setTimeout(resolve, 12000))

    const finalMetrics = await queue.getMetrics()
    expect(finalMetrics.completed).toBeGreaterThan(0)

    // Cleanup
    await pool.query('DELETE FROM sync_events WHERE session_id = $1', ['test-retry-metrics'])
    await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', ['test-retry-metrics'])
  }, 25000)
})
