import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DBWriteQueue } from '@/state/DBWriteQueue'
import { pool } from '@/config/database'
import { logger } from '@/utils/logger'
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

describe('DBWriteQueue - Failure Alerting', () => {
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

  it('should alert after 5 failed attempts', async () => {
    const alertSpy = vi.spyOn(queue as any, 'alertOnPersistentFailure')

    // Force all attempts to fail
    pool.connect = vi.fn(async () => {
      throw new Error('PERMANENT_FAILURE')
    }) as any

    const state = createTestState('test-alert-after-5')
    await queue.queueWrite('test-alert-after-5', state, 'session_created')

    // Wait for all retries to exhaust (~65 seconds)
    await new Promise(resolve => setTimeout(resolve, 70000))

    // Verify alert was called
    expect(alertSpy).toHaveBeenCalled()
    expect(alertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sessionId: 'test-alert-after-5',
          eventType: 'session_created',
        }),
      }),
      expect.any(Error)
    )
  }, 80000)

  it('should log correct failure details to logger', async () => {
    const loggerErrorSpy = vi.spyOn(logger, 'error')

    // Force all attempts to fail
    pool.connect = vi.fn(async () => {
      throw new Error('DATABASE_UNAVAILABLE')
    }) as any

    const state = createTestState('test-logger-details')
    await queue.queueWrite('test-logger-details', state, 'session_created')

    // Wait for all retries to exhaust
    await new Promise(resolve => setTimeout(resolve, 70000))

    // Verify logger.error called with PERSISTENT FAILURE message
    const persistentFailureCalls = loggerErrorSpy.mock.calls.filter(call =>
      typeof call[1] === 'string' && call[1].includes('PERSISTENT FAILURE')
    )

    expect(persistentFailureCalls.length).toBeGreaterThan(0)

    // Verify correct fields logged
    const failureCall = persistentFailureCalls[0]
    expect(failureCall[0]).toMatchObject({
      jobId: expect.any(String),
      sessionId: 'test-logger-details',
      eventType: 'session_created',
      err: expect.any(Error),
      jobData: expect.objectContaining({
        sessionId: 'test-logger-details',
        eventType: 'session_created',
      }),
    })
  }, 80000)

  it('should NOT alert on successful retry', async () => {
    const alertSpy = vi.spyOn(queue as any, 'alertOnPersistentFailure')
    let attemptCount = 0

    // Fail first 2 times, succeed on 3rd
    pool.connect = vi.fn(async () => {
      attemptCount++
      if (attemptCount < 3) {
        throw new Error('TEMPORARY_FAILURE')
      }
      return originalConnect.call(pool)
    }) as any

    const state = createTestState('test-no-alert-on-success')
    await queue.queueWrite('test-no-alert-on-success', state, 'session_created')

    // Wait for retries and success
    await new Promise(resolve => setTimeout(resolve, 15000))

    // Verify alert was NOT called
    expect(alertSpy).not.toHaveBeenCalled()

    // Cleanup
    await pool.query('DELETE FROM sync_events WHERE session_id = $1', ['test-no-alert-on-success'])
    await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', ['test-no-alert-on-success'])
  }, 25000)

  it('should include error message in alert', async () => {
    const alertSpy = vi.spyOn(queue as any, 'alertOnPersistentFailure')
    const specificError = new Error('SPECIFIC_DATABASE_ERROR: Connection pool exhausted')

    pool.connect = vi.fn(async () => {
      throw specificError
    }) as any

    const state = createTestState('test-error-message')
    await queue.queueWrite('test-error-message', state, 'session_created')

    // Wait for all retries
    await new Promise(resolve => setTimeout(resolve, 70000))

    // Verify alert called with specific error
    expect(alertSpy).toHaveBeenCalledWith(expect.any(Object), specificError)
  }, 80000)

  it('should log worker failed events', async () => {
    const loggerErrorSpy = vi.spyOn(logger, 'error')

    pool.connect = vi.fn(async () => {
      throw new Error('WORKER_FAILURE')
    }) as any

    const state = createTestState('test-worker-failed-event')
    await queue.queueWrite('test-worker-failed-event', state, 'session_created')

    // Wait for first failure
    await new Promise(resolve => setTimeout(resolve, 3000))

    // Verify worker 'failed' event logged
    const failedEventCalls = loggerErrorSpy.mock.calls.filter(call =>
      typeof call[1] === 'string' && call[1].includes('[Worker] Job failed')
    )

    expect(failedEventCalls.length).toBeGreaterThan(0)
  }, 15000)
})
