import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { DBWriteQueue } from '@/state/DBWriteQueue'
import { pool } from '@/config/database'
import { SyncState } from '@/types/session'

// Helper to create test state with valid UUIDs
const createTestState = (sessionId: string): SyncState => ({
  session_id: sessionId,
  sync_mode: 'per_participant',
  status: 'pending',
  time_per_cycle_ms: 60000,
  increment_ms: 0,
  max_time_ms: null,
  participants: [
    {
      participant_id: uuidv4(),
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

describe('DBWriteQueue - Performance Benchmarks', () => {
  let queue: DBWriteQueue

  beforeEach(() => {
    // Use unique queue name for test isolation
    const queueName = `perf-queue-${Date.now()}-${Math.random()}`
    queue = new DBWriteQueue(process.env.REDIS_URL!, { queueName })
  })

  afterEach(async () => {
    await queue.close()
  })

  it('should queue 100 jobs within 1 second', async () => {
    const jobs = Array.from({ length: 100 }, () => {
      const sessionId = uuidv4()
      const state = createTestState(sessionId)
      return { sessionId, state }
    })

    const start = Date.now()

    // Queue all jobs
    await Promise.all(jobs.map(job => queue.queueWrite(job.sessionId, job.state, 'session_created')))

    const queueLatency = Date.now() - start

    // Queuing 100 jobs should be very fast (<1s)
    expect(queueLatency).toBeLessThan(1000)

    // Verify jobs were queued
    const metrics = await queue.getMetrics()
    expect(metrics.waiting + metrics.active + metrics.completed).toBeGreaterThanOrEqual(100)

    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 15000))

    // Verify all jobs completed
    const finalMetrics = await queue.getMetrics()
    expect(finalMetrics.completed).toBeGreaterThanOrEqual(100)

    // Cleanup
    await Promise.all(
      jobs.map(job =>
        Promise.all([
          pool.query('DELETE FROM sync_events WHERE session_id = $1', [job.sessionId]),
          pool.query('DELETE FROM sync_sessions WHERE session_id = $1', [job.sessionId]),
        ])
      )
    )
  }, 25000)

  it('should process jobs concurrently (10 workers)', async () => {
    // Queue 20 jobs
    const jobs = Array.from({ length: 20 }, () => {
      const sessionId = uuidv4()
      const state = createTestState(sessionId)
      return { sessionId, state }
    })

    await Promise.all(jobs.map(job => queue.queueWrite(job.sessionId, job.state, 'session_created')))

    // Start timing
    const start = Date.now()

    // Wait for all to complete
    let completed = 0
    while (completed < 20) {
      await new Promise(resolve => setTimeout(resolve, 500))
      const metrics = await queue.getMetrics()
      completed = metrics.completed

      // Prevent infinite loop
      if (Date.now() - start > 15000) break
    }

    const totalTime = Date.now() - start

    // With 10 concurrent workers, 20 jobs should complete in ~4-6 seconds
    // (not 20 * 2s = 40s sequential)
    // Each job takes ~2s, with 10 workers: 20/10 = 2 batches * 2s = ~4s
    expect(totalTime).toBeLessThan(10000) // Allow some buffer

    // Cleanup
    await Promise.all(
      jobs.map(job =>
        Promise.all([
          pool.query('DELETE FROM sync_events WHERE session_id = $1', [job.sessionId]),
          pool.query('DELETE FROM sync_sessions WHERE session_id = $1', [job.sessionId]),
        ])
      )
    )
  }, 20000)

  it('should handle rapid sequential queuing without blocking', async () => {
    const sessionCount = 50
    const jobs: Array<{ sessionId: string; state: SyncState }> = []
    const start = Date.now()

    // Queue jobs one after another (not parallel)
    for (let i = 0; i < sessionCount; i++) {
      const sessionId = uuidv4()
      const state = createTestState(sessionId)
      jobs.push({ sessionId, state })
      await queue.queueWrite(sessionId, state, 'session_created')
    }

    const queueLatency = Date.now() - start

    // Even sequential queuing should be fast (<2s for 50 jobs)
    expect(queueLatency).toBeLessThan(2000)

    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 12000))

    // Cleanup
    await Promise.all(
      jobs.map(job =>
        Promise.all([
          pool.query('DELETE FROM sync_events WHERE session_id = $1', [job.sessionId]),
          pool.query('DELETE FROM sync_sessions WHERE session_id = $1', [job.sessionId]),
        ])
      )
    )
  }, 20000)

  it('should maintain performance with large state objects', async () => {
    const jobs = Array.from({ length: 10 }, () => {
      const sessionId = uuidv4()
      const state = createTestState(sessionId)

      // Create large state with 100 participants
      state.participants = Array.from({ length: 100 }, (_, j) => ({
        participant_id: uuidv4(),
        total_time_ms: 60000,
        time_remaining_ms: 60000,
        group_id: `group-${j % 10}`,
      }))

      return { sessionId, state }
    })

    const start = Date.now()

    // Queue all large state jobs
    await Promise.all(jobs.map(job => queue.queueWrite(job.sessionId, job.state, 'session_created')))

    const queueLatency = Date.now() - start

    // Queuing should still be fast even with large states
    expect(queueLatency).toBeLessThan(1000)

    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 8000))

    // Verify all completed
    const metrics = await queue.getMetrics()
    expect(metrics.completed).toBeGreaterThanOrEqual(10)

    // Cleanup
    await Promise.all(
      jobs.map(job =>
        Promise.all([
          pool.query('DELETE FROM sync_events WHERE session_id = $1', [job.sessionId]),
          pool.query('DELETE FROM sync_sessions WHERE session_id = $1', [job.sessionId]),
        ])
      )
    )
  }, 15000)

  it('should track metrics efficiently without impacting performance', async () => {
    // Queue 50 jobs
    const jobs = Array.from({ length: 50 }, () => {
      const sessionId = uuidv4()
      const state = createTestState(sessionId)
      return { sessionId, state }
    })

    await Promise.all(jobs.map(job => queue.queueWrite(job.sessionId, job.state, 'session_created')))

    const start = Date.now()

    // Call getMetrics 100 times rapidly
    const metricsCalls = Array.from({ length: 100 }, () => queue.getMetrics())
    await Promise.all(metricsCalls)

    const metricsLatency = Date.now() - start

    // Getting metrics 100 times should be fast (<500ms)
    expect(metricsLatency).toBeLessThan(500)

    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 12000))

    // Cleanup
    await Promise.all(
      jobs.map(job =>
        Promise.all([
          pool.query('DELETE FROM sync_events WHERE session_id = $1', [job.sessionId]),
          pool.query('DELETE FROM sync_sessions WHERE session_id = $1', [job.sessionId]),
        ])
      )
    )
  }, 20000)

  it('should handle mixed event types efficiently', async () => {
    const eventTypes = [
      'session_created',
      'session_started',
      'cycle_switched',
      'session_updated',
      'session_completed',
    ]
    const jobs = Array.from({ length: 25 }, (_, i) => {
      const sessionId = uuidv4()
      const state = createTestState(sessionId)
      const eventType = eventTypes[i % eventTypes.length]
      return { sessionId, state, eventType }
    })

    const start = Date.now()

    await Promise.all(jobs.map(job => queue.queueWrite(job.sessionId, job.state, job.eventType)))

    const queueLatency = Date.now() - start

    // Should handle mixed events efficiently
    expect(queueLatency).toBeLessThan(500)

    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 8000))

    // Verify different event types were stored
    const sessionIds = jobs.map(j => j.sessionId)
    const placeholders = sessionIds.map((_, i) => `$${i + 1}`).join(', ')
    const eventTypesInDB = await pool.query(
      `SELECT DISTINCT event_type FROM sync_events WHERE session_id IN (${placeholders})`,
      sessionIds
    )

    expect(eventTypesInDB.rows.length).toBeGreaterThan(1)

    // Cleanup
    await Promise.all(
      jobs.map(job =>
        Promise.all([
          pool.query('DELETE FROM sync_events WHERE session_id = $1', [job.sessionId]),
          pool.query('DELETE FROM sync_sessions WHERE session_id = $1', [job.sessionId]),
        ])
      )
    )
  }, 15000)
})
