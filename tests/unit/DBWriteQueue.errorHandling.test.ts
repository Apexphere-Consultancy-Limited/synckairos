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
  created_at: new Date('2025-01-01T00:00:00Z'),
  updated_at: new Date('2025-01-01T00:00:00Z'),
  session_started_at: null,
  session_completed_at: null,
  version: 1,
})

describe('DBWriteQueue - Error Handling Logic (Unit Tests)', () => {
  let queue: DBWriteQueue
  let originalConnect: typeof pool.connect

  beforeEach(() => {
    queue = new DBWriteQueue(process.env.REDIS_URL!)
    originalConnect = pool.connect
  })

  afterEach(async () => {
    pool.connect = originalConnect
    await queue.close()
    vi.restoreAllMocks()
  })

  describe('Connection Errors (Should Retry)', () => {
    it('should throw error for ECONNREFUSED (triggers BullMQ retry)', async () => {
      const performDBWrite = (queue as any).performDBWrite.bind(queue)
      const state = createTestState('test-error-handling')
      const jobData = {
        sessionId: 'test-error-handling',
        state,
        eventType: 'session_created',
        timestamp: Date.now(),
      }

      // Mock pool.connect to throw ECONNREFUSED error
      const connectionError = new Error('ECONNREFUSED: Connection refused')
      pool.connect = vi.fn().mockRejectedValue(connectionError)

      // Should throw error (which BullMQ will catch and retry)
      await expect(performDBWrite(jobData)).rejects.toThrow('ECONNREFUSED')

      // Verify pool.connect was called
      expect(pool.connect).toHaveBeenCalledTimes(1)
    })

    it('should throw error for ETIMEDOUT (triggers BullMQ retry)', async () => {
      const performDBWrite = (queue as any).performDBWrite.bind(queue)
      const state = createTestState('test-error-handling')
      const jobData = {
        sessionId: 'test-error-handling',
        state,
        eventType: 'session_created',
        timestamp: Date.now(),
      }

      // Mock pool.connect to throw ETIMEDOUT error
      const timeoutError = new Error('ETIMEDOUT: Connection timeout')
      pool.connect = vi.fn().mockRejectedValue(timeoutError)

      // Should throw error (which BullMQ will catch and retry)
      await expect(performDBWrite(jobData)).rejects.toThrow('ETIMEDOUT')

      // Verify pool.connect was called
      expect(pool.connect).toHaveBeenCalledTimes(1)
    })

    it('should throw error for unknown errors (triggers BullMQ retry)', async () => {
      const performDBWrite = (queue as any).performDBWrite.bind(queue)
      const state = createTestState('test-error-handling')
      const jobData = {
        sessionId: 'test-error-handling',
        state,
        eventType: 'session_created',
        timestamp: Date.now(),
      }

      // Mock pool.connect to throw unknown error
      const unknownError = new Error('UNKNOWN_ERROR: Something went wrong')
      pool.connect = vi.fn().mockRejectedValue(unknownError)

      // Should throw error (which BullMQ will catch and retry)
      await expect(performDBWrite(jobData)).rejects.toThrow('UNKNOWN_ERROR')

      // Verify pool.connect was called
      expect(pool.connect).toHaveBeenCalledTimes(1)
    })
  })

  describe('Constraint Violations (Should NOT Retry)', () => {
    it('should NOT throw for duplicate key errors (no retry)', async () => {
      const performDBWrite = (queue as any).performDBWrite.bind(queue)
      const state = createTestState('test-duplicate-key')
      const jobData = {
        sessionId: 'test-duplicate-key',
        state,
        eventType: 'session_created',
        timestamp: Date.now(),
      }

      // Mock client that throws duplicate key error
      const mockClient = {
        query: vi.fn(async (sql: string) => {
          if (sql.includes('BEGIN')) {
            return { rows: [], rowCount: 0 }
          }
          if (sql.includes('INSERT INTO sync_sessions')) {
            throw new Error('duplicate key value violates unique constraint "sync_sessions_pkey"')
          }
          return { rows: [], rowCount: 0 }
        }),
        release: vi.fn(),
      }

      pool.connect = vi.fn().mockResolvedValue(mockClient)

      // Should NOT throw (job completes, no retry)
      await expect(performDBWrite(jobData)).resolves.toBeUndefined()

      // Verify client.release was called
      expect(mockClient.release).toHaveBeenCalledTimes(1)
    })

    it('should NOT throw for foreign key constraint violations (no retry)', async () => {
      const performDBWrite = (queue as any).performDBWrite.bind(queue)
      const state = createTestState('test-foreign-key')
      const jobData = {
        sessionId: 'test-foreign-key',
        state,
        eventType: 'session_created',
        timestamp: Date.now(),
      }

      // Mock client that throws foreign key constraint error
      const mockClient = {
        query: vi.fn(async (sql: string) => {
          if (sql.includes('BEGIN')) {
            return { rows: [], rowCount: 0 }
          }
          if (sql.includes('INSERT INTO sync_sessions')) {
            throw new Error('violates foreign key constraint "fk_session_id"')
          }
          return { rows: [], rowCount: 0 }
        }),
        release: vi.fn(),
      }

      pool.connect = vi.fn().mockResolvedValue(mockClient)

      // Should NOT throw (job completes, no retry)
      await expect(performDBWrite(jobData)).resolves.toBeUndefined()

      // Verify client.release was called
      expect(mockClient.release).toHaveBeenCalledTimes(1)
    })

    it('should NOT throw for check constraint violations (no retry)', async () => {
      const performDBWrite = (queue as any).performDBWrite.bind(queue)
      const state = createTestState('test-check-constraint')
      const jobData = {
        sessionId: 'test-check-constraint',
        state,
        eventType: 'session_created',
        timestamp: Date.now(),
      }

      // Mock client that throws check constraint error
      const mockClient = {
        query: vi.fn(async (sql: string) => {
          if (sql.includes('BEGIN')) {
            return { rows: [], rowCount: 0 }
          }
          if (sql.includes('INSERT INTO sync_sessions')) {
            throw new Error('violates check constraint "positive_time"')
          }
          return { rows: [], rowCount: 0 }
        }),
        release: vi.fn(),
      }

      pool.connect = vi.fn().mockResolvedValue(mockClient)

      // Should NOT throw (job completes, no retry)
      await expect(performDBWrite(jobData)).resolves.toBeUndefined()

      // Verify client.release was called
      expect(mockClient.release).toHaveBeenCalledTimes(1)
    })
  })

  describe('Transaction Rollback', () => {
    it('should call ROLLBACK on error', async () => {
      const performDBWrite = (queue as any).performDBWrite.bind(queue)
      const state = createTestState('test-rollback')
      const jobData = {
        sessionId: 'test-rollback',
        state,
        eventType: 'session_created',
        timestamp: Date.now(),
      }

      // Mock client that throws error after BEGIN
      const mockClient = {
        query: vi.fn(async (sql: string) => {
          if (sql.includes('BEGIN')) {
            return { rows: [], rowCount: 0 }
          }
          if (sql.includes('ROLLBACK')) {
            return { rows: [], rowCount: 0 }
          }
          if (sql.includes('INSERT INTO sync_sessions')) {
            throw new Error('ECONNREFUSED: Connection refused')
          }
          return { rows: [], rowCount: 0 }
        }),
        release: vi.fn(),
      }

      pool.connect = vi.fn().mockResolvedValue(mockClient)

      // Should throw error
      await expect(performDBWrite(jobData)).rejects.toThrow('ECONNREFUSED')

      // Verify ROLLBACK was called
      const rollbackCalls = mockClient.query.mock.calls.filter(
        (call) => typeof call[0] === 'string' && call[0].includes('ROLLBACK')
      )
      expect(rollbackCalls.length).toBe(1)

      // Verify client.release was called even after error
      expect(mockClient.release).toHaveBeenCalledTimes(1)
    })

    it('should release client even if ROLLBACK fails', async () => {
      const performDBWrite = (queue as any).performDBWrite.bind(queue)
      const state = createTestState('test-rollback-failure')
      const jobData = {
        sessionId: 'test-rollback-failure',
        state,
        eventType: 'session_created',
        timestamp: Date.now(),
      }

      // Mock client where ROLLBACK also fails
      const mockClient = {
        query: vi.fn(async (sql: string) => {
          if (sql.includes('BEGIN')) {
            return { rows: [], rowCount: 0 }
          }
          if (sql.includes('ROLLBACK')) {
            throw new Error('ROLLBACK failed')
          }
          if (sql.includes('INSERT INTO sync_sessions')) {
            throw new Error('INSERT failed')
          }
          return { rows: [], rowCount: 0 }
        }),
        release: vi.fn(),
      }

      pool.connect = vi.fn().mockResolvedValue(mockClient)

      // Should throw the ROLLBACK error
      await expect(performDBWrite(jobData)).rejects.toThrow('ROLLBACK failed')

      // Verify client.release was called even after ROLLBACK failure
      expect(mockClient.release).toHaveBeenCalledTimes(1)
    })
  })

  describe('Error Message Detection', () => {
    it('should detect ECONNREFUSED in error message', async () => {
      const performDBWrite = (queue as any).performDBWrite.bind(queue)
      const state = createTestState('test-message-detection')
      const jobData = {
        sessionId: 'test-message-detection',
        state,
        eventType: 'session_created',
        timestamp: Date.now(),
      }

      // Test various ECONNREFUSED message formats
      const errorMessages = [
        'ECONNREFUSED: Connection refused',
        'Error: ECONNREFUSED',
        'connect ECONNREFUSED 127.0.0.1:5432',
      ]

      for (const message of errorMessages) {
        pool.connect = vi.fn().mockRejectedValue(new Error(message))
        await expect(performDBWrite(jobData)).rejects.toThrow()
      }
    })

    it('should detect ETIMEDOUT in error message', async () => {
      const performDBWrite = (queue as any).performDBWrite.bind(queue)
      const state = createTestState('test-message-detection')
      const jobData = {
        sessionId: 'test-message-detection',
        state,
        eventType: 'session_created',
        timestamp: Date.now(),
      }

      // Test various ETIMEDOUT message formats
      const errorMessages = [
        'ETIMEDOUT: Connection timeout',
        'Error: ETIMEDOUT',
        'connect ETIMEDOUT',
      ]

      for (const message of errorMessages) {
        pool.connect = vi.fn().mockRejectedValue(new Error(message))
        await expect(performDBWrite(jobData)).rejects.toThrow()
      }
    })

    it('should detect duplicate key in error message', async () => {
      const performDBWrite = (queue as any).performDBWrite.bind(queue)
      const state = createTestState('test-duplicate-detection')
      const jobData = {
        sessionId: 'test-duplicate-detection',
        state,
        eventType: 'session_created',
        timestamp: Date.now(),
      }

      // Test various duplicate key message formats
      const errorMessages = [
        'duplicate key value violates unique constraint',
        'ERROR: duplicate key value',
        'duplicate key',
      ]

      for (const message of errorMessages) {
        const mockClient = {
          query: vi.fn(async (sql: string) => {
            if (sql.includes('BEGIN')) return { rows: [], rowCount: 0 }
            if (sql.includes('INSERT')) throw new Error(message)
            return { rows: [], rowCount: 0 }
          }),
          release: vi.fn(),
        }
        pool.connect = vi.fn().mockResolvedValue(mockClient)

        // Should NOT throw (no retry)
        await expect(performDBWrite(jobData)).resolves.toBeUndefined()
      }
    })

    it('should detect violates in error message', async () => {
      const performDBWrite = (queue as any).performDBWrite.bind(queue)
      const state = createTestState('test-violates-detection')
      const jobData = {
        sessionId: 'test-violates-detection',
        state,
        eventType: 'session_created',
        timestamp: Date.now(),
      }

      // Test various constraint violation message formats
      const errorMessages = [
        'violates foreign key constraint',
        'violates check constraint',
        'violates not-null constraint',
      ]

      for (const message of errorMessages) {
        const mockClient = {
          query: vi.fn(async (sql: string) => {
            if (sql.includes('BEGIN')) return { rows: [], rowCount: 0 }
            if (sql.includes('INSERT')) throw new Error(message)
            return { rows: [], rowCount: 0 }
          }),
          release: vi.fn(),
        }
        pool.connect = vi.fn().mockResolvedValue(mockClient)

        // Should NOT throw (no retry)
        await expect(performDBWrite(jobData)).resolves.toBeUndefined()
      }
    })
  })
})
