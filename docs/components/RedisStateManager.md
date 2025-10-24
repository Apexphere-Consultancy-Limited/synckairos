# RedisStateManager API Reference

## Overview

Primary state store for SyncKairos sessions. Redis-backed with sub-5ms operations.

**Key Features**:
- CRUD operations with optimistic locking
- TTL management (1-hour expiration)
- Pub/Sub for cross-instance sync
- Automatic PostgreSQL audit via DBWriteQueue

**Performance**: 0.25ms GET, 0.46ms UPDATE, 0.19ms Pub/Sub

## Usage

```typescript
import { RedisStateManager } from '@/state/RedisStateManager'
import { createRedisClient, createRedisPubSubClient } from '@/config/redis'
import { DBWriteQueue } from '@/state/DBWriteQueue'

const redis = createRedisClient()
const pubSub = createRedisPubSubClient()
const queue = new DBWriteQueue(process.env.REDIS_URL!)

const manager = new RedisStateManager(redis, pubSub, queue)
```

## Core Methods

### getSession(sessionId: string): Promise<SyncState | null>

Retrieve session from Redis. Returns `null` if not found or TTL expired.

```typescript
const state = await manager.getSession('session-123')
if (!state) {
  // Session expired or doesn't exist
}
```

### createSession(state: SyncState): Promise<void>

Create new session with 1-hour TTL.

```typescript
await manager.createSession({
  session_id: 'session-123',
  sync_mode: SyncMode.PER_PARTICIPANT,
  status: SyncStatus.PENDING,
  version: 1,
  participants: [...],
  // ... other fields
})
```

**Side effects**:
- Sets version=1, created_at, updated_at
- Sets TTL to 3600s
- Queues PostgreSQL audit write

### updateSession(sessionId: string, state: SyncState, expectedVersion?: number): Promise<void>

Update session with optimistic locking.

```typescript
const current = await manager.getSession(sessionId)
await manager.updateSession(
  sessionId,
  { ...current!, status: SyncStatus.RUNNING },
  current!.version  // Optional: optimistic lock
)
```

**Side effects**:
- Increments version
- Sets updated_at
- Refreshes TTL
- Publishes to `session-updates` channel
- Queues PostgreSQL audit write

**Throws**: `ConcurrencyError` if version mismatch

### deleteSession(sessionId: string): Promise<void>

Delete session and notify all instances.

```typescript
await manager.deleteSession('session-123')
// All instances receive callback with null state
```

## Pub/Sub Methods

### subscribeToUpdates(callback: (sessionId, state) => void): void

Subscribe to session updates from all instances.

```typescript
manager.subscribeToUpdates((sessionId, state) => {
  if (state === null) {
    console.log(`Session ${sessionId} deleted`)
  } else {
    console.log(`Session ${sessionId} updated to v${state.version}`)
  }
})
```

**Channel**: `session-updates`

**Important**: Subscribe once at startup, not per request.

### subscribeToWebSocket(callback: (sessionId, message) => void): void

Subscribe to WebSocket broadcast messages.

```typescript
manager.subscribeToWebSocket((sessionId, message) => {
  webSocketServer.sendToSession(sessionId, message)
})
```

**Channel Pattern**: `ws:*`

### broadcastToSession(sessionId: string, message: unknown): Promise<void>

Broadcast message to all instances for a session.

```typescript
await manager.broadcastToSession('session-123', {
  type: 'TIMER_TICK',
  timeRemaining: 295000
})
```

**Channel**: `ws:{sessionId}`

### close(): Promise<void>

Gracefully close Redis connections.

```typescript
await manager.close()
```

## Types

### SyncState

```typescript
interface SyncState {
  session_id: string
  version: number
  sync_mode: SyncMode
  status: SyncStatus
  participants: SyncParticipant[]
  active_participant_id: string | null
  total_time_ms: number
  time_per_cycle_ms: number | null
  increment_ms: number | null
  max_time_ms: number | null
  cycle_started_at: Date | null
  session_started_at: Date | null
  session_completed_at: Date | null
  created_at: Date
  updated_at: Date
}
```

### SyncMode

```typescript
enum SyncMode {
  PER_PARTICIPANT = 'per_participant',
  PER_CYCLE = 'per_cycle',
  PER_GROUP = 'per_group',
  GLOBAL = 'global',
  COUNT_UP = 'count_up'
}
```

### SyncStatus

```typescript
enum SyncStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  PAUSED = 'paused',
  EXPIRED = 'expired',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled'
}
```

### SyncParticipant

```typescript
interface SyncParticipant {
  participant_id: string
  total_time_ms: number
  time_remaining_ms: number
  has_gone: boolean
  is_active: boolean
}
```

## Error Handling

```typescript
import {
  SessionNotFoundError,
  ConcurrencyError,
  StateDeserializationError
} from '@/errors/StateErrors'

try {
  await manager.updateSession(id, state, expectedVersion)
} catch (error) {
  if (error instanceof SessionNotFoundError) {
    // Session doesn't exist
  } else if (error instanceof ConcurrencyError) {
    // Concurrent modification detected
    console.log(`Expected v${error.expectedVersion}, got v${error.actualVersion}`)
  } else if (error instanceof StateDeserializationError) {
    // Corrupt data in Redis
  }
}
```

## Best Practices

### 1. Use Optimistic Locking for Critical Updates

```typescript
// Get current state
const state = await manager.getSession(id)

// Update with version check
await manager.updateSession(id, newState, state.version)
```

### 2. Handle Concurrent Modifications with Retry

```typescript
for (let i = 0; i < 3; i++) {
  try {
    const state = await manager.getSession(id)
    await manager.updateSession(id, newState, state.version)
    break
  } catch (error) {
    if (error instanceof ConcurrencyError && i < 2) continue
    throw error
  }
}
```

### 3. Handle TTL Expiration

```typescript
const state = await manager.getSession(id)
if (!state) {
  // Expired or never existed
  return res.status(404).json({ error: 'Session not found' })
}
```

### 4. Subscribe Once at Startup

```typescript
// ❌ Don't subscribe per request
app.get('/session/:id', () => {
  manager.subscribeToUpdates(() => {}) // Memory leak!
})

// ✅ Subscribe once at app startup
manager.subscribeToUpdates((sessionId, state) => {
  // Handle all session updates
})
```

## Configuration

See [CONFIGURATION.md](CONFIGURATION.md) for environment variables and constants.
