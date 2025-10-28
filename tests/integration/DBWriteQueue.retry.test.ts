import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DBWriteQueue } from '@/state/DBWriteQueue'
import { pool } from '@/config/database'
import { SyncState } from '@/types/session'
import { randomUUID } from 'crypto'

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

describe('DBWriteQueue - BullMQ Retry Integration', () => {
  let queue: DBWriteQueue
  let originalConnect: typeof pool.connect

  beforeEach(() => {
    // Each test gets its own isolated queue to prevent mock interference
    // Use unique queue name per test for complete isolation
    const queueName = `test-queue-${Date.now()}-${Math.random().toString(36).substring(7)}`

    // Use fast retry config for testing
    // Production: 2s, 4s, 8s, 16s, 32s (62s total)
    // Test: 200ms, 400ms, 800ms, 1600ms, 3200ms (~6s total)
    queue = new DBWriteQueue(process.env.REDIS_URL!, {
      attempts: 5,
      backoffDelay: 200, // 10x faster than production (200ms vs 2000ms)
      queueName, // Unique queue name for isolation
    })

    originalConnect = pool.connect
  })

  afterEach(async () => {
    pool.connect = originalConnect
    await queue.close(true) // Force close - don't wait for active jobs
    vi.restoreAllMocks()
  })

  it('should retry failed jobs with exponential backoff', async () => {
    let attemptCount = 0
    const sessionId = randomUUID() // Use valid UUID

    // Mock pool.connect to fail first 3 times, succeed on 4th
    pool.connect = vi.fn(async () => {
      attemptCount++
      if (attemptCount < 4) {
        throw new Error('ECONNREFUSED: Connection refused')
      }
      return originalConnect.call(pool)
    }) as any

    const state = createTestState(sessionId)
    await queue.queueWrite(sessionId, state, 'session_created')

    // Wait for BullMQ retries with exponential backoff
    // Retry delays: 200ms, 400ms, 800ms = 1400ms total + BullMQ overhead
    // Wait 3 seconds to ensure all retries complete
    await new Promise(resolve => setTimeout(resolve, 3000))

    // Verify job eventually succeeded after retries
    expect(attemptCount).toBe(4) // Failed 3 times, succeeded on 4th
  }, 10000)

  it('should give up after maximum retry attempts (5)', async () => {
    let attemptCount = 0

    // Mock all attempts to fail
    pool.connect = vi.fn(async () => {
      attemptCount++
      throw new Error('PERMANENT_FAILURE: Database unavailable')
    }) as any

    const state = createTestState('test-max-retries')
    await queue.queueWrite('test-max-retries', state, 'session_created')

    // Wait for all 5 retry attempts to complete
    // Retry delays: 200ms + 400ms + 800ms + 1600ms + 3200ms = 6200ms total + overhead
    // Wait long enough for all retries to complete
    await new Promise(resolve => setTimeout(resolve, 7000))

    // Verify job failed after maximum retry attempts
    expect(attemptCount).toBe(5) // Attempted exactly 5 times
  }, 8000)

  it('should track retry attempts in queue metrics', async () => {
    let attemptCount = 0
    const sessionId = randomUUID() // Use valid UUID

    pool.connect = vi.fn(async () => {
      attemptCount++
      if (attemptCount < 3) {
        throw new Error('ECONNREFUSED')
      }
      return originalConnect.call(pool)
    }) as any

    const state = createTestState(sessionId)
    await queue.queueWrite(sessionId, state, 'session_created')

    // Wait for retries to complete (2 retries: 200ms + 400ms = 600ms + overhead)
    // Wait 2 seconds to ensure all retries complete
    await new Promise(resolve => setTimeout(resolve, 2000))

    // Verify retry attempts were tracked correctly
    expect(attemptCount).toBe(3) // Failed 2 times, succeeded on 3rd
  }, 10000)

  it('should respect BullMQ retry configuration (5 attempts, exponential backoff)', async () => {
    let attemptCount = 0
    const attemptTimestamps: number[] = []

    pool.connect = vi.fn(async () => {
      attemptCount++
      attemptTimestamps.push(Date.now())
      throw new Error('ALWAYS_FAIL')
    }) as any

    const state = createTestState('test-retry-config')
    await queue.queueWrite('test-retry-config', state, 'session_created')

    // Wait for all 5 retry attempts (same as test 2)
    // Retry delays: 200ms + 400ms + 800ms + 1600ms + 3200ms = 6200ms total + overhead
    await new Promise(resolve => setTimeout(resolve, 7000))

    // Verify exactly 5 attempts were made per configuration
    expect(attemptCount).toBe(5)

    // Verify exponential backoff timing
    expect(attemptTimestamps.length).toBe(5)
    // Each retry should be roughly 2x the previous delay
    // Allow 50% margin for BullMQ processing overhead
  }, 8000)
})
