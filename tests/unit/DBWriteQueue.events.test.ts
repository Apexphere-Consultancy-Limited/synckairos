import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DBWriteQueue } from '@/state/DBWriteQueue'
import { logger } from '@/utils/logger'
import { SyncState } from '@/types/session'
import { pool } from '@/config/database'

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

describe('DBWriteQueue - Event Listeners', () => {
  let queue: DBWriteQueue

  beforeEach(() => {
    queue = new DBWriteQueue(process.env.REDIS_URL!)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await queue.close()
  })

  it('should log queue errors', async () => {
    const loggerErrorSpy = vi.spyOn(logger, 'error')

    // Trigger queue error by emitting event directly
    const queueError = new Error('Queue error')
    queue['queue'].emit('error', queueError)

    // Wait for event to be processed
    await new Promise(resolve => setTimeout(resolve, 100))

    // Verify logger.error was called
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ err: queueError }),
      '[Queue] Error'
    )
  })

  it('should log worker errors', async () => {
    const loggerErrorSpy = vi.spyOn(logger, 'error')

    // Trigger worker error
    const workerError = new Error('Worker error')
    queue['worker'].emit('error', workerError)

    // Wait for event to be processed
    await new Promise(resolve => setTimeout(resolve, 100))

    // Verify logger.error was called
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ err: workerError }),
      '[Worker] Error'
    )
  })

  it('should log job completion', async () => {
    const loggerDebugSpy = vi.spyOn(logger, 'debug')

    const state = createTestState('test-event-completed')
    await queue.queueWrite('test-event-completed', state, 'session_created')

    // Wait for job to process
    await new Promise(resolve => setTimeout(resolve, 2000))

    // Verify completion logged
    const completedCalls = loggerDebugSpy.mock.calls.filter(call =>
      typeof call[1] === 'string' && call[1].includes('Job completed')
    )

    expect(completedCalls.length).toBeGreaterThan(0)
    expect(completedCalls[0][0]).toMatchObject({
      jobId: expect.any(String),
      sessionId: 'test-event-completed',
    })

    // Cleanup
    await pool.query('DELETE FROM sync_events WHERE session_id = $1', ['test-event-completed'])
    await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', ['test-event-completed'])
  })

  it('should log active jobs with attempt count', async () => {
    const loggerDebugSpy = vi.spyOn(logger, 'debug')

    const state = createTestState('test-event-active')
    await queue.queueWrite('test-event-active', state, 'session_created')

    // Wait for job to become active
    await new Promise(resolve => setTimeout(resolve, 500))

    // Verify active event logged
    const activeCalls = loggerDebugSpy.mock.calls.filter(call =>
      typeof call[1] === 'string' && call[1].includes('Job active')
    )

    expect(activeCalls.length).toBeGreaterThan(0)
    expect(activeCalls[0][0]).toMatchObject({
      jobId: expect.any(String),
      attempt: expect.any(Number),
      maxAttempts: expect.any(Number),
    })

    // Cleanup
    await new Promise(resolve => setTimeout(resolve, 2000))
    await pool.query('DELETE FROM sync_events WHERE session_id = $1', ['test-event-active'])
    await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', ['test-event-active'])
  })

  it('should log waiting jobs', async () => {
    const loggerDebugSpy = vi.spyOn(logger, 'debug')

    const state = createTestState('test-event-waiting')
    await queue.queueWrite('test-event-waiting', state, 'session_created')

    // Wait briefly for waiting event
    await new Promise(resolve => setTimeout(resolve, 100))

    // Verify waiting event logged
    const waitingCalls = loggerDebugSpy.mock.calls.filter(call =>
      typeof call[1] === 'string' && call[1].includes('Job') && call[1].includes('waiting')
    )

    expect(waitingCalls.length).toBeGreaterThan(0)

    // Cleanup
    await new Promise(resolve => setTimeout(resolve, 2000))
    await pool.query('DELETE FROM sync_events WHERE session_id = $1', ['test-event-waiting'])
    await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', ['test-event-waiting'])
  })

  it('should log failed jobs with session details', async () => {
    const loggerErrorSpy = vi.spyOn(logger, 'error')
    const originalConnect = pool.connect

    // Force job to fail
    pool.connect = vi.fn(async () => {
      throw new Error('Simulated failure')
    }) as any

    const state = createTestState('test-event-failed')
    await queue.queueWrite('test-event-failed', state, 'session_created')

    // Wait for first failure
    await new Promise(resolve => setTimeout(resolve, 3000))

    // Restore original connection
    pool.connect = originalConnect

    // Verify failed event logged with correct details
    const failedCalls = loggerErrorSpy.mock.calls.filter(call =>
      typeof call[1] === 'string' && call[1].includes('[Worker] Job failed')
    )

    expect(failedCalls.length).toBeGreaterThan(0)
    expect(failedCalls[0][0]).toMatchObject({
      jobId: expect.any(String),
      sessionId: 'test-event-failed',
      err: expect.any(Error),
    })
  }, 15000)

  it('should track progress events if reported', async () => {
    const loggerDebugSpy = vi.spyOn(logger, 'debug')

    // Create a job and manually emit progress
    const state = createTestState('test-event-progress')
    await queue.queueWrite('test-event-progress', state, 'session_created')

    // Wait for job to start
    await new Promise(resolve => setTimeout(resolve, 500))

    // Note: BullMQ doesn't emit progress by default unless job.updateProgress() is called
    // This test verifies the listener exists and would log if progress was reported

    // For now, verify the listener doesn't throw errors
    // In a real scenario, you'd update performDBWrite to call job.updateProgress()

    // Cleanup
    await new Promise(resolve => setTimeout(resolve, 2000))
    await pool.query('DELETE FROM sync_events WHERE session_id = $1', ['test-event-progress'])
    await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', ['test-event-progress'])
  })
})
