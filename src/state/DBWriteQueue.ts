import { Queue, Worker, Job } from 'bullmq'
import { SyncState } from '@/types/session'
import { pool } from '@/config/database'
import Redis from 'ioredis'
import { logger } from '@/utils/logger'
import { dbWriteQueueSize } from '@/api/middlewares/metrics'

export interface DBWriteJobData {
  sessionId: string
  state: SyncState
  eventType: string
  timestamp: number
}

export interface QueueMetrics {
  waiting: number
  active: number
  completed: number
  failed: number
  delayed: number
}

export class DBWriteQueue {
  private queue: Queue<DBWriteJobData>
  private worker: Worker<DBWriteJobData>
  private redisConnection: Redis

  constructor(redisUrl: string) {
    this.redisConnection = new Redis(redisUrl, {
      maxRetriesPerRequest: null, // Required for BullMQ
      enableReadyCheck: false,
    })

    // Create Queue instance
    this.queue = new Queue<DBWriteJobData>('db-writes', {
      connection: this.redisConnection,
      defaultJobOptions: {
        attempts: 5, // Retry up to 5 times
        backoff: {
          type: 'exponential',
          delay: 2000, // 2s, 4s, 8s, 16s, 32s
        },
        removeOnComplete: {
          count: 100, // Keep last 100 successful jobs
          age: 3600, // Remove after 1 hour
        },
        removeOnFail: false, // Keep failed jobs for debugging
      },
    })

    // Create Worker instance
    this.worker = new Worker<DBWriteJobData>(
      'db-writes',
      async (job: Job<DBWriteJobData>) => {
        await this.performDBWrite(job.data)
      },
      {
        connection: this.redisConnection.duplicate(), // Worker needs separate connection
        concurrency: 10, // Process 10 jobs concurrently
      }
    )

    // Setup event listeners
    this.setupEventListeners()
  }

  private setupEventListeners(): void {
    // Queue events
    this.queue.on('error', err => {
      logger.error({ err }, '[Queue] Error')
    })

    this.queue.on('waiting', jobId => {
      logger.debug(`[Queue] Job ${jobId.toString()} waiting`)
    })

    // Worker events
    this.worker.on('completed', async job => {
      logger.debug(
        { jobId: job.id, sessionId: job.data.sessionId },
        `[Worker] Job completed for session`
      )

      // Update metrics: decrement queue size
      const [waiting, active] = await Promise.all([
        this.queue.getWaitingCount(),
        this.queue.getActiveCount(),
      ])
      dbWriteQueueSize.set(waiting + active)
    })

    this.worker.on('failed', (job, err) => {
      if (job) {
        logger.error(
          { jobId: job.id, sessionId: job.data.sessionId, err },
          `[Worker] Job failed for session`
        )

        // Alert on persistent failures (all 5 attempts exhausted)
        if (job.attemptsMade >= 5) {
          this.alertOnPersistentFailure(job, err)
        }
      }
    })

    this.worker.on('active', job => {
      logger.debug(
        { jobId: job.id, attempt: job.attemptsMade + 1, maxAttempts: job.opts.attempts },
        `[Worker] Job active`
      )
    })

    this.worker.on('progress', (job, progress) => {
      logger.debug({ jobId: job.id, progress }, `[Worker] Job progress`)
    })

    this.worker.on('error', err => {
      logger.error({ err }, '[Worker] Error')
    })
  }

  private alertOnPersistentFailure(job: Job<DBWriteJobData>, error: Error): void {
    logger.error(
      {
        jobId: job.id,
        sessionId: job.data.sessionId,
        eventType: job.data.eventType,
        err: error,
        jobData: job.data,
      },
      '🚨 PERSISTENT FAILURE: Job failed after all retry attempts'
    )

    // TODO Phase 3: Send to Sentry/PagerDuty
    // sentry.captureException(error, {
    //   tags: { job_id: job.id, session_id: job.data.sessionId },
    // })
  }

  async queueWrite(sessionId: string, state: SyncState, eventType: string): Promise<void> {
    await this.queue.add('db-write', {
      sessionId,
      state,
      eventType,
      timestamp: Date.now(),
    })

    // Update metrics: set queue size to waiting + active
    const [waiting, active] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
    ])
    dbWriteQueueSize.set(waiting + active)
  }

  private async performDBWrite(data: DBWriteJobData): Promise<void> {
    const { sessionId, state, eventType, timestamp } = data
    const client = await pool.connect()

    try {
      await client.query('BEGIN')

      // 1. Upsert into sync_sessions
      await client.query(
        `
        INSERT INTO sync_sessions (
          session_id,
          sync_mode,
          time_per_cycle_ms,
          increment_ms,
          max_time_ms,
          created_at,
          started_at,
          completed_at,
          final_status,
          total_cycles,
          total_participants,
          last_updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
        ON CONFLICT (session_id)
        DO UPDATE SET
          time_per_cycle_ms = EXCLUDED.time_per_cycle_ms,
          started_at = COALESCE(EXCLUDED.started_at, sync_sessions.started_at),
          completed_at = EXCLUDED.completed_at,
          final_status = EXCLUDED.final_status,
          total_cycles = EXCLUDED.total_cycles,
          last_updated_at = NOW()
        `,
        [
          sessionId,
          state.sync_mode,
          state.time_per_cycle_ms,
          state.increment_ms || 0,
          state.max_time_ms,
          state.created_at,
          state.session_started_at,
          state.session_completed_at,
          state.status,
          0, // TODO: Calculate from state
          state.participants.length,
        ]
      )

      // 2. Insert into sync_events
      await client.query(
        `
        INSERT INTO sync_events (
          session_id,
          event_type,
          participant_id,
          time_remaining_ms,
          timestamp,
          state_snapshot,
          metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          sessionId,
          eventType,
          state.active_participant_id,
          state.participants.find(p => p.participant_id === state.active_participant_id)
            ?.time_remaining_ms || null,
          new Date(timestamp),
          JSON.stringify(state), // Full state snapshot for recovery
          {}, // Additional metadata
        ]
      )

      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')

      if (err instanceof Error) {
        // Check for connection errors (retry)
        if (err.message.includes('ECONNREFUSED') || err.message.includes('ETIMEDOUT')) {
          logger.error({ err }, 'PostgreSQL connection error, will retry')
          throw err // BullMQ will retry
        }

        // Check for constraint violations (don't retry)
        if (err.message.includes('duplicate key') || err.message.includes('violates')) {
          logger.error({ err }, 'PostgreSQL constraint violation, skipping')
          return // Don't retry, job is marked as complete
        }

        // Unknown error, throw to trigger retry
        throw err
      }
      throw err
    } finally {
      client.release()
    }
  }

  async getMetrics(): Promise<QueueMetrics> {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
      this.queue.getCompletedCount(),
      this.queue.getFailedCount(),
      this.queue.getDelayedCount(),
    ])

    return { waiting, active, completed, failed, delayed }
  }

  async close(): Promise<void> {
    await this.worker.close()
    await this.queue.close()
    await this.redisConnection.quit()
  }
}
