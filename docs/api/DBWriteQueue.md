# DBWriteQueue API Reference

## Overview
Async PostgreSQL audit writes via BullMQ. Redis-backed queue with retry logic.

## Usage

```typescript
import { DBWriteQueue } from '@/state/DBWriteQueue'

const queue = new DBWriteQueue(process.env.REDIS_URL!)

// Queue a write (called internally by RedisStateManager)
await queue.queueWrite(sessionId, state, 'session_updated')

// Get metrics
const metrics = await queue.getMetrics()
// { waiting: 5, active: 2, completed: 1000, failed: 3, delayed: 0 }

// Cleanup
await queue.close()
```

## Configuration

- **Queue Name**: `db-writes`
- **Retry**: 5 attempts, exponential backoff (2s, 4s, 8s, 16s, 32s)
- **Concurrency**: 10 workers
- **Cleanup**: Keep last 100 successful jobs for 1 hour

## Job Data

```typescript
interface DBWriteJobData {
  sessionId: string
  state: SyncState          // Full snapshot
  eventType: string         // 'session_created', 'session_updated'
  timestamp: number
}
```

## Error Handling

- **Connection errors** → Retry
- **Constraint violations** → Skip (don't retry)
- **5 failures** → Log alert (TODO: Sentry/PagerDuty)

## PostgreSQL Schema

Writes to:
- `sync_sessions` (upsert)
- `sync_events` (insert with full state snapshot)

## Events

```typescript
queue.on('completed', (job) => {})  // Job succeeded
queue.on('failed', (job, err) => {}) // Job failed
queue.on('active', (job) => {})      // Job started
```
