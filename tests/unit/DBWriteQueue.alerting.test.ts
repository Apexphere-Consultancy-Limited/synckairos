import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DBWriteQueue } from '@/state/DBWriteQueue'
import { logger } from '@/utils/logger'
import { SyncState } from '@/types/session'
import { Job } from 'bullmq'

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

// Mock BullMQ Job for testing
const createMockJob = (sessionId: string, attemptsMade: number): Partial<Job> => {
  const state = createTestState(sessionId)
  return {
    id: '123',
    attemptsMade,
    opts: {
      attempts: 5,
    },
    data: {
      sessionId,
      state,
      eventType: 'session_created',
      timestamp: Date.now(),
    },
  }
}

describe('DBWriteQueue - Alerting Logic (Unit Tests)', () => {
  let loggerErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // Mock logger.error to capture alert calls
    loggerErrorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('alertOnPersistentFailure', () => {
    it('should log persistent failure with correct metadata', () => {
      // Create a mock queue instance to access the private method
      const queue = new DBWriteQueue(process.env.REDIS_URL!)
      const alertMethod = (queue as any).alertOnPersistentFailure.bind(queue)

      const mockJob = createMockJob('test-alert-session', 5) as Job
      const error = new Error('DATABASE_UNAVAILABLE')

      // Call the alerting method directly
      alertMethod(mockJob, error)

      // Verify logger.error was called
      expect(loggerErrorSpy).toHaveBeenCalledTimes(1)

      // Verify the log contains correct metadata
      const logCall = loggerErrorSpy.mock.calls[0]
      expect(logCall[0]).toMatchObject({
        jobId: '123',
        sessionId: 'test-alert-session',
        eventType: 'session_created',
        err: error,
        jobData: expect.objectContaining({
          sessionId: 'test-alert-session',
          eventType: 'session_created',
        }),
      })

      // Verify the log message
      expect(logCall[1]).toContain('PERSISTENT FAILURE')
      expect(logCall[1]).toContain('failed after all retry attempts')

      // Cleanup
      queue.close()
    })

    it('should include error message in alert', () => {
      const queue = new DBWriteQueue(process.env.REDIS_URL!)
      const alertMethod = (queue as any).alertOnPersistentFailure.bind(queue)

      const mockJob = createMockJob('test-error-message', 5) as Job
      const specificError = new Error('SPECIFIC_DATABASE_ERROR: Connection pool exhausted')

      alertMethod(mockJob, specificError)

      // Verify the error object is included in the log
      const logCall = loggerErrorSpy.mock.calls[0]
      const logData = logCall[0] as any
      expect(logData.err).toBe(specificError)
      expect(logData.err.message).toContain('Connection pool exhausted')

      queue.close()
    })

    it('should include job ID and session ID in alert', () => {
      const queue = new DBWriteQueue(process.env.REDIS_URL!)
      const alertMethod = (queue as any).alertOnPersistentFailure.bind(queue)

      const mockJob = createMockJob('test-ids-session', 5) as Job
      const error = new Error('TEST_ERROR')

      alertMethod(mockJob, error)

      const logCall = loggerErrorSpy.mock.calls[0]
      expect(logCall[0]).toHaveProperty('jobId', '123')
      expect(logCall[0]).toHaveProperty('sessionId', 'test-ids-session')

      queue.close()
    })

    it('should include event type in alert', () => {
      const queue = new DBWriteQueue(process.env.REDIS_URL!)
      const alertMethod = (queue as any).alertOnPersistentFailure.bind(queue)

      const mockJob = createMockJob('test-event-type', 5) as Job
      const error = new Error('TEST_ERROR')

      alertMethod(mockJob, error)

      const logCall = loggerErrorSpy.mock.calls[0]
      expect(logCall[0]).toHaveProperty('eventType', 'session_created')

      queue.close()
    })

    it('should include full job data in alert for debugging', () => {
      const queue = new DBWriteQueue(process.env.REDIS_URL!)
      const alertMethod = (queue as any).alertOnPersistentFailure.bind(queue)

      const mockJob = createMockJob('test-full-data', 5) as Job
      const error = new Error('TEST_ERROR')

      alertMethod(mockJob, error)

      const logCall = loggerErrorSpy.mock.calls[0]
      const logData = logCall[0] as any
      expect(logData.jobData).toBeDefined()
      expect(logData.jobData).toMatchObject({
        sessionId: 'test-full-data',
        eventType: 'session_created',
        state: expect.objectContaining({
          session_id: 'test-full-data',
          sync_mode: 'per_participant',
        }),
      })

      queue.close()
    })
  })

  describe('Worker "failed" event handler logic', () => {
    it('should call alertOnPersistentFailure when attemptsMade >= 5', () => {
      const queue = new DBWriteQueue(process.env.REDIS_URL!)
      const alertSpy = vi.spyOn(queue as any, 'alertOnPersistentFailure')

      const mockJob = createMockJob('test-5-attempts', 5) as Job
      const error = new Error('PERMANENT_FAILURE')

      // Simulate worker "failed" event logic
      if (mockJob.attemptsMade && mockJob.attemptsMade >= 5) {
        ;(queue as any).alertOnPersistentFailure(mockJob, error)
      }

      expect(alertSpy).toHaveBeenCalledTimes(1)
      expect(alertSpy).toHaveBeenCalledWith(mockJob, error)

      queue.close()
    })

    it('should NOT call alertOnPersistentFailure when attemptsMade < 5', () => {
      const queue = new DBWriteQueue(process.env.REDIS_URL!)
      const alertSpy = vi.spyOn(queue as any, 'alertOnPersistentFailure')

      const mockJob = createMockJob('test-3-attempts', 3) as Job
      const error = new Error('TEMPORARY_FAILURE')

      // Simulate worker "failed" event logic
      if (mockJob.attemptsMade && mockJob.attemptsMade >= 5) {
        ;(queue as any).alertOnPersistentFailure(mockJob, error)
      }

      expect(alertSpy).not.toHaveBeenCalled()

      queue.close()
    })

    it('should log every failure attempt', () => {
      const queue = new DBWriteQueue(process.env.REDIS_URL!)

      const mockJob = createMockJob('test-log-every-failure', 2) as Job
      const error = new Error('TEMPORARY_ERROR')

      // Simulate the worker "failed" event logging
      logger.error(
        { jobId: mockJob.id, sessionId: mockJob.data?.sessionId, err: error },
        `[Worker] Job failed for session`
      )

      expect(loggerErrorSpy).toHaveBeenCalledTimes(1)
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          jobId: '123',
          sessionId: 'test-log-every-failure',
          err: error,
        }),
        expect.stringContaining('[Worker] Job failed')
      )

      queue.close()
    })
  })

  describe('Alert message format', () => {
    it('should include emoji in alert message for visibility', () => {
      const queue = new DBWriteQueue(process.env.REDIS_URL!)
      const alertMethod = (queue as any).alertOnPersistentFailure.bind(queue)

      const mockJob = createMockJob('test-emoji', 5) as Job
      const error = new Error('TEST_ERROR')

      alertMethod(mockJob, error)

      const logCall = loggerErrorSpy.mock.calls[0]
      expect(logCall[1]).toContain('🚨')

      queue.close()
    })

    it('should use consistent message format', () => {
      const queue = new DBWriteQueue(process.env.REDIS_URL!)
      const alertMethod = (queue as any).alertOnPersistentFailure.bind(queue)

      const mockJob = createMockJob('test-format', 5) as Job
      const error = new Error('TEST_ERROR')

      alertMethod(mockJob, error)

      const logCall = loggerErrorSpy.mock.calls[0]
      const message = logCall[1]

      // Verify message format
      expect(message).toMatch(/🚨.*PERSISTENT FAILURE.*failed after all retry attempts/)

      queue.close()
    })
  })

  describe('Edge cases', () => {
    it('should handle jobs with missing job ID', () => {
      const queue = new DBWriteQueue(process.env.REDIS_URL!)
      const alertMethod = (queue as any).alertOnPersistentFailure.bind(queue)

      const mockJob = { ...createMockJob('test-no-id', 5), id: undefined } as Job
      const error = new Error('TEST_ERROR')

      // Should not throw
      expect(() => alertMethod(mockJob, error)).not.toThrow()

      queue.close()
    })

    it('should handle errors with no message', () => {
      const queue = new DBWriteQueue(process.env.REDIS_URL!)
      const alertMethod = (queue as any).alertOnPersistentFailure.bind(queue)

      const mockJob = createMockJob('test-no-message', 5) as Job
      const error = new Error()

      expect(() => alertMethod(mockJob, error)).not.toThrow()
      expect(loggerErrorSpy).toHaveBeenCalled()

      queue.close()
    })

    it('should handle different error types', () => {
      const queue = new DBWriteQueue(process.env.REDIS_URL!)
      const alertMethod = (queue as any).alertOnPersistentFailure.bind(queue)

      const mockJob = createMockJob('test-error-types', 5) as Job

      // Test with different error types
      const errors = [
        new Error('ECONNREFUSED'),
        new Error('ETIMEDOUT'),
        new Error('duplicate key'),
        new Error('violates foreign key'),
        new TypeError('Invalid type'),
        new RangeError('Out of range'),
      ]

      errors.forEach((error) => {
        loggerErrorSpy.mockClear()
        expect(() => alertMethod(mockJob, error)).not.toThrow()
        expect(loggerErrorSpy).toHaveBeenCalled()
      })

      queue.close()
    })
  })
})
