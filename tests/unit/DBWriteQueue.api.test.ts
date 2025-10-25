import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { DBWriteQueue } from '@/state/DBWriteQueue'
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

describe('DBWriteQueue - API', () => {
  let queue: DBWriteQueue

  beforeEach(() => {
    queue = new DBWriteQueue(process.env.REDIS_URL!)
  })

  afterEach(async () => {
    if (queue) {
      // Wait briefly for any pending jobs
      await new Promise(resolve => setTimeout(resolve, 500))
      await queue.close(true) // Force close - don't wait for active jobs
    }
  })

  it('should initialize queue successfully', async () => {
    const metrics = await queue.getMetrics()
    expect(metrics).toBeDefined()
    expect(metrics.waiting).toBeGreaterThanOrEqual(0)
  })

  it('should queue a write job', async () => {
    const sessionId = uuidv4()
    const state = createTestState(sessionId)

    await queue.queueWrite(sessionId, state, 'session_created')

    const metrics = await queue.getMetrics()
    expect(metrics.waiting + metrics.active).toBeGreaterThan(0)
  })

  it('should return queue metrics', async () => {
    const metrics = await queue.getMetrics()

    expect(metrics).toEqual({
      waiting: expect.any(Number),
      active: expect.any(Number),
      completed: expect.any(Number),
      failed: expect.any(Number),
      delayed: expect.any(Number),
    })
  })

  it('should accept multiple job types', async () => {
    const sessionId = uuidv4()
    const state = createTestState(sessionId)

    await queue.queueWrite(sessionId, state, 'session_created')
    await queue.queueWrite(sessionId, state, 'session_started')
    await queue.queueWrite(sessionId, state, 'cycle_switched')

    const metrics = await queue.getMetrics()
    // Jobs may be processed quickly, so check total across all states
    expect(metrics.waiting + metrics.active + metrics.completed).toBeGreaterThanOrEqual(3)
  })

  it('should close queue and worker cleanly', async () => {
    await expect(queue.close(true)).resolves.not.toThrow()
    // Set queue to null so afterEach doesn't try to close again
    queue = null as any
  })

  it('should track waiting jobs', async () => {
    const sessionId = uuidv4()
    const state = createTestState(sessionId)

    await queue.queueWrite(sessionId, state, 'session_created')

    const metrics = await queue.getMetrics()
    expect(metrics.waiting + metrics.active).toBeGreaterThan(0)
  })
})
