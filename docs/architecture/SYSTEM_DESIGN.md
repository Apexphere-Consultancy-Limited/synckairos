# Phase 1 Architecture - Core State Management

**Version:** 2.0
**Status:** 🟢 Complete
**Last Updated:** 2025-10-21

---

## Table of Contents

- [Overview](#overview)
- [System Architecture](#system-architecture)
- [Component Architecture](#component-architecture)
- [Data Flow](#data-flow)
- [State Lifecycle](#state-lifecycle)
- [Cross-Instance Communication](#cross-instance-communication)
- [Performance Characteristics](#performance-characteristics)

---

## Overview

Phase 1 implements the **core state management layer** of SyncKairos with a distributed-first architecture. The system is designed to operate across multiple instances with Redis as the primary state store and PostgreSQL for audit logging.

### Design Goals

1. **Zero Instance-Local State**: Any instance can serve any request
2. **Sub-5ms Operations**: Redis-only hot path for critical operations
3. **Horizontal Scalability**: Add instances without code changes
4. **Data Durability**: Async audit trail in PostgreSQL
5. **Multi-Instance Consistency**: Redis Pub/Sub for state synchronization

### Key Components

- **RedisStateManager**: Primary state operations (CRUD)
- **DBWriteQueue**: Async PostgreSQL writes via BullMQ
- **Redis**: Primary state store + Pub/Sub messaging
- **PostgreSQL**: Audit trail and historical data

---

## System Architecture

### High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                    Client Applications                            │
│   (Games, Live Events, Meetings, Exams, Collaborative Tools)    │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         │ HTTP REST + WebSocket
                         │
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│              Load Balancer (Round-Robin)                          │
│                  NO Sticky Sessions                               │
└────┬─────────────┬─────────────┬────────────────────────────┬────┘
     │             │             │                            │
     ▼             ▼             ▼                            ▼
┌─────────┐  ┌─────────┐  ┌─────────┐                 ┌─────────┐
│Instance │  │Instance │  │Instance │       ...       │Instance │
│    1    │  │    2    │  │    3    │                 │    N    │
│         │  │         │  │         │                 │         │
│STATELESS│  │STATELESS│  │STATELESS│                 │STATELESS│
└────┬────┘  └────┬────┘  └────┬────┘                 └────┬────┘
     │            │             │                           │
     └────────────┼─────────────┼───────────────────────────┘
                  │             │
     ┌────────────┘             └──────────────┐
     │                                         │
     ▼                                         ▼
┌──────────────────┐                   ┌──────────────────┐
│   Redis Cluster   │                   │   PostgreSQL    │
│                  │                   │   Database      │
│  PRIMARY STORE   │                   │  AUDIT TRAIL    │
│                  │                   │                 │
│  • Session State │────async write───▶│  • sync_sessions│
│  • Pub/Sub       │    (BullMQ)       │  • sync_events  │
│  • TTL 1hr       │                   │  • sync_parts   │
└──────────────────┘                   └──────────────────┘
  1-5ms latency                           Async (non-blocking)
```

### Instance Architecture

Each SyncKairos instance is **completely stateless**:

```
┌──────────────────────────────────────────────────────────┐
│                  SyncKairos Instance                      │
│                                                          │
│  ┌────────────────────────────────────────────────────┐ │
│  │          Express HTTP Server                        │ │
│  │  • REST API endpoints (Phase 4)                     │ │
│  │  • Health checks (/health, /ready)                  │ │
│  │  • Prometheus metrics (/metrics)                    │ │
│  └─────────────────┬──────────────────────────────────┘ │
│                    │                                     │
│  ┌────────────────┴──────────────────────────────────┐ │
│  │          WebSocket Server (Phase 3)                │ │
│  │  • Real-time state updates                         │ │
│  │  • Subscribe to Redis Pub/Sub                      │ │
│  │  • Broadcast to connected clients                  │ │
│  └─────────────────┬──────────────────────────────────┘ │
│                    │                                     │
│  ┌────────────────┴──────────────────────────────────┐ │
│  │          SyncEngine (Phase 2)                      │ │
│  │  • Business logic (switchCycle, etc.)              │ │
│  │  • Uses RedisStateManager                          │ │
│  └─────────────────┬──────────────────────────────────┘ │
│                    │                                     │
│  ┌────────────────┴──────────────────────────────────┐ │
│  │      RedisStateManager (Phase 1) ✅                │ │
│  │                                                    │ │
│  │  • getSession(id)         1-3ms                    │ │
│  │  • createSession(state)   2-5ms                    │ │
│  │  • updateSession(...)     3-5ms                    │ │
│  │  • deleteSession(id)      1-2ms                    │ │
│  │  • subscribeToUpdates()   Pub/Sub                  │ │
│  │  • broadcastToSession()   Pub/Sub                  │ │
│  └─────────────────┬──────────────────────────────────┘ │
│                    │                                     │
│  ┌────────────────┴──────────────────────────────────┐ │
│  │       DBWriteQueue (Phase 1) ✅                    │ │
│  │                                                    │ │
│  │  • queueWrite(session, event)                      │ │
│  │  • BullMQ worker (10 concurrent)                   │ │
│  │  • Retry logic (5 attempts)                        │ │
│  │  • Exponential backoff                             │ │
│  └────────────────────────────────────────────────────┘ │
│                                                          │
└──────────────────────────────────────────────────────────┘
         │                            │
         │                            │
         ▼                            ▼
   ┌──────────┐              ┌──────────────┐
   │  Redis   │              │  PostgreSQL  │
   │ Cluster  │              │   Database   │
   └──────────┘              └──────────────┘
```

---

## Component Architecture

### RedisStateManager

**Purpose**: Manage all session state operations using Redis as the single source of truth.

**Responsibilities**:
- CRUD operations on session state
- Optimistic locking (version field)
- TTL management (1 hour)
- Pub/Sub broadcasting for cross-instance updates
- State serialization/deserialization (Date handling)

**Key Methods**:

```typescript
class RedisStateManager {
  // Core CRUD
  async getSession(sessionId: string): Promise<SyncState | null>
  async createSession(state: SyncState): Promise<void>
  async updateSession(sessionId: string, state: SyncState, expectedVersion?: number): Promise<void>
  async deleteSession(sessionId: string): Promise<void>

  // Pub/Sub for cross-instance communication
  subscribeToUpdates(callback: (sessionId: string, state: SyncState | null) => void): void
  subscribeToWebSocket(callback: (sessionId: string, message: unknown) => void): void
  async broadcastToSession(sessionId: string, message: unknown): Promise<void>

  // Lifecycle
  async close(): Promise<void>
}
```

**State Storage**:
- **Key Pattern**: `session:{sessionId}`
- **Value**: JSON-serialized `SyncState`
- **TTL**: 3600 seconds (1 hour)
- **Channels**: `session-updates`, `ws:{sessionId}`

**Optimistic Locking**:
```typescript
// Every update increments version
const newState = {
  ...state,
  version: state.version + 1,
  updated_at: new Date()
}

// Detect concurrent modifications
if (currentState.version !== expectedVersion) {
  throw new ConcurrencyError(sessionId, expectedVersion, currentState.version)
}
```

---

### DBWriteQueue

**Purpose**: Async audit trail writes to PostgreSQL using BullMQ.

**Responsibilities**:
- Queue writes to PostgreSQL
- Process jobs in background (10 concurrent workers)
- Retry failed writes (5 attempts, exponential backoff)
- Transaction management (BEGIN/COMMIT/ROLLBACK)
- Error handling and alerting

**Architecture**:

```
┌──────────────────────────────────────────────────────────┐
│                  DBWriteQueue                             │
│                                                          │
│  ┌────────────────────────────────────────────────────┐ │
│  │          BullMQ Queue                               │ │
│  │  • Queue name: 'db-writes'                          │ │
│  │  • Storage: Redis                                   │ │
│  │  • Retry: 5 attempts                                │ │
│  │  • Backoff: Exponential (2s, 4s, 8s, 16s, 32s)     │ │
│  │  • Cleanup: Keep last 100 successful (1hr)          │ │
│  └─────────────────┬──────────────────────────────────┘ │
│                    │                                     │
│  ┌────────────────┴──────────────────────────────────┐ │
│  │          BullMQ Worker                             │ │
│  │  • Concurrency: 10                                  │ │
│  │  • Process: performDBWrite()                        │ │
│  │  • Events: completed, failed, active                │ │
│  └─────────────────┬──────────────────────────────────┘ │
│                    │                                     │
│  ┌────────────────┴──────────────────────────────────┐ │
│  │       PostgreSQL Transaction                       │ │
│  │                                                    │ │
│  │  BEGIN                                             │ │
│  │    1. Upsert sync_sessions                         │ │
│  │    2. Insert sync_events                           │ │
│  │  COMMIT                                            │ │
│  │                                                    │ │
│  │  (ROLLBACK on error)                               │ │
│  └────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

**Job Data**:
```typescript
interface DBWriteJobData {
  sessionId: string
  state: SyncState        // Full state snapshot
  eventType: string       // 'session_created', 'session_updated', etc.
  timestamp: number       // When the event occurred
}
```

**Error Handling**:
- **Connection errors** (ECONNREFUSED): Retry
- **Constraint violations**: Skip (don't retry)
- **Unknown errors**: Retry
- **Persistent failures** (5 attempts): Alert/log

---

## Data Flow

### Session Creation Flow

```
┌─────────┐
│ Client  │
└────┬────┘
     │ POST /sessions
     ▼
┌─────────────┐
│ Instance 1  │
│             │
│ 1. Validate │
│ 2. Create   │◀────────────────────────────────┐
└────┬────────┘                                 │
     │                                          │
     │ createSession(state)                     │
     ▼                                          │
┌──────────────────┐                            │
│  Redis           │                            │
│                  │                            │
│  SET session:123 │                            │
│  TTL 3600        │                            │
│                  │                            │
│  PUBLISH         │────────────────────────────┤
│  session-updates │                            │
└──────┬───────────┘                            │
       │                                        │
       │ async (fire-and-forget)                │
       ▼                                        │
┌──────────────────┐                            │
│  BullMQ Queue    │                            │
│                  │                            │
│  Add job:        │                            │
│  {sessionId,     │                            │
│   state,         │                            │
│   eventType}     │                            │
└──────┬───────────┘                            │
       │                                        │
       │ Worker picks up                        │
       ▼                                        │
┌──────────────────┐                            │
│  PostgreSQL      │                            │
│                  │                            │
│  BEGIN           │                            │
│  INSERT sessions │                            │
│  INSERT events   │                            │
│  COMMIT          │                            │
└──────────────────┘                            │
                                                │
┌─────────────┐                                 │
│ Instance 2  │◀────────────────────────────────┘
│             │
│ Receives    │
│ Pub/Sub     │
│ Update      │
└─────────────┘
```

### Session Update Flow (Hot Path)

```
┌─────────┐
│ Client  │
└────┬────┘
     │ PATCH /sessions/123
     ▼
┌─────────────┐
│ Instance 2  │
│             │
│ 1. Get      │────────▶ GET session:123
│ 2. Validate │◀────────
│ 3. Update   │────────▶ SET session:123 (version++)
└────┬────────┘         PUBLISH session-updates
     │
     │ Response (5ms total)
     ▼
┌─────────┐
│ Client  │
└─────────┘

Concurrently:
┌──────────────────┐
│  BullMQ Queue    │ ◀─── Async write
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│  PostgreSQL      │ ◀─── Non-blocking audit
└──────────────────┘
```

**Performance**:
- Client receives response in **3-5ms**
- PostgreSQL write happens **asynchronously** (doesn't block)
- All other instances receive Pub/Sub update in **<2ms**

---

## State Lifecycle

### State Transitions

```
┌─────────┐
│ PENDING │  Initial state when session created
└────┬────┘
     │ startSession()
     ▼
┌─────────┐
│ RUNNING │  Active session, cycles in progress
└────┬────┘
     │
     ├─────▶ pauseSession() ────▶ ┌────────┐
     │                             │ PAUSED │
     │                             └───┬────┘
     │                                 │ resumeSession()
     │◀────────────────────────────────┘
     │
     ├─────▶ timeout ───────────▶ ┌─────────┐
     │                             │ EXPIRED │
     │                             └─────────┘
     │
     ├─────▶ completeSession() ─▶ ┌───────────┐
     │                             │ COMPLETED │
     │                             └───────────┘
     │
     └─────▶ cancelSession() ───▶ ┌───────────┐
                                   │ CANCELLED │
                                   └───────────┘
```

### TTL Management

All sessions in Redis have a **1-hour TTL**:

```typescript
// Every write refreshes TTL
await redis.setex(`session:${sessionId}`, 3600, serialized)
```

**TTL Behavior**:
- Active sessions: TTL refreshed on every update
- Inactive sessions: Expire after 1 hour of no activity
- Expired sessions: Automatically removed from Redis
- Recovery: Can be restored from PostgreSQL if needed

**Recovery Flow** (Phase 2):
```typescript
async getSession(sessionId: string): Promise<SyncState | null> {
  // Try Redis first (hot path)
  const data = await redis.get(`session:${sessionId}`)

  if (data) {
    return JSON.parse(data)
  }

  // Fallback to PostgreSQL (cold path)
  const recovered = await recoverFromPostgreSQL(sessionId)

  if (recovered) {
    // Restore to Redis
    await redis.setex(`session:${sessionId}`, 3600, JSON.stringify(recovered))
  }

  return recovered
}
```

---

## Cross-Instance Communication

### Redis Pub/Sub Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ Instance 1  │     │ Instance 2  │     │ Instance 3  │
│             │     │             │     │             │
│ Subscribe   │     │ Subscribe   │     │ Subscribe   │
│ session-    │     │ session-    │     │ session-    │
│ updates     │     │ updates     │     │ updates     │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       └───────────────────┼───────────────────┘
                           │
                           │ SUBSCRIBE
                           ▼
                   ┌───────────────┐
                   │  Redis Pub/Sub │
                   │                │
                   │  Channel:      │
                   │  session-      │
                   │  updates       │
                   └───────┬────────┘
                           │
           ┌───────────────┼───────────────┐
           │ PUBLISH       │               │
           │ (from any     │               │
           │  instance)    │               │
           └───────────────┼───────────────┘
                           │
       ┌───────────────────┼───────────────┐
       │                   │               │
       ▼                   ▼               ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ Instance 1  │     │ Instance 2  │     │ Instance 3  │
│             │     │             │     │             │
│ Callback    │     │ Callback    │     │ Callback    │
│ executed    │     │ executed    │     │ executed    │
└─────────────┘     └─────────────┘     └─────────────┘
```

### Message Formats

**Session Update Message**:
```json
{
  "sessionId": "session-123",
  "state": "{...serialized SyncState...}",
  "timestamp": 1697872800000
}
```

**Session Deletion Message**:
```json
{
  "sessionId": "session-123",
  "deleted": true,
  "timestamp": 1697872800000
}
```

**WebSocket Broadcast Message**:
```json
{
  "sessionId": "session-123",
  "message": { /* custom payload */ },
  "timestamp": 1697872800000
}
```

### Pub/Sub Implementation

```typescript
// Instance subscribes to updates
stateManager.subscribeToUpdates((sessionId, state) => {
  if (state === null) {
    // Session was deleted
    console.log(`Session ${sessionId} deleted`)
  } else {
    // Session was updated
    console.log(`Session ${sessionId} updated to version ${state.version}`)
  }
})

// Instance publishes update (automatic in updateSession)
await stateManager.updateSession(sessionId, newState)
// → Internally publishes to 'session-updates' channel
// → All other instances receive the update
```

**Latency**: Pub/Sub messages delivered in **<2ms** (measured in tests)

---

## Performance Characteristics

### Measured Performance (Phase 1 Validation)

| Operation | Target | Achieved | Performance |
|-----------|--------|----------|-------------|
| `getSession()` avg | <3ms | 0.25ms | **12x better** |
| `getSession()` p95 | <5ms | 0.33ms | **15x better** |
| `updateSession()` avg | <5ms | 0.46ms | **10x better** |
| `updateSession()` p95 | <10ms | 0.61ms | **16x better** |
| Redis Pub/Sub | <2ms | 0.19ms | **10x better** |
| `createSession()` avg | <5ms | 0.22ms | **23x better** |
| `createSession()` p95 | <5ms | 0.33ms | **15x better** |

### Scalability Characteristics

**Horizontal Scaling**:
- Add instances: O(1) complexity
- No coordination required
- Load balancer distributes requests
- Redis handles all instances equally

**Connection Pooling**:
- Each instance: 1 Redis client + 1 Pub/Sub client
- PostgreSQL: Connection pool (min 2, max 20)
- BullMQ: Separate Redis connection per worker

**Throughput**:
- Single instance: ~10,000 ops/sec
- 10 instances: ~100,000 ops/sec
- Limited by Redis cluster capacity, not application

**Memory**:
- Instance footprint: ~50MB base + connections
- Redis: ~1-2KB per session
- No memory growth over time (stateless)

---

## Design Trade-offs

### Why Redis as PRIMARY?

**Advantages** ✅:
- Sub-5ms latency (vs 10-30ms PostgreSQL)
- Horizontal scaling built-in
- Pub/Sub for real-time updates
- TTL for automatic cleanup
- Simple data model

**Disadvantages** ⚠️:
- In-memory only (requires backup)
- Data loss on Redis failure (mitigated by PostgreSQL audit)
- Higher cost per GB than PostgreSQL

**Mitigation**: PostgreSQL audit trail allows recovery

### Why Async PostgreSQL Writes?

**Advantages** ✅:
- Never blocks hot path
- Can handle PostgreSQL downtime
- Retry logic for resilience
- Batching possible in future

**Disadvantages** ⚠️:
- Eventual consistency with audit trail
- Requires queue management
- Delayed analytics/reporting

**Mitigation**: Redis is source of truth; PostgreSQL is audit only

### Why BullMQ for Queuing?

**Advantages** ✅:
- Redis-backed (consistent with architecture)
- Built-in retry logic
- Job prioritization
- Progress tracking
- Battle-tested

**Disadvantages** ⚠️:
- Another dependency
- Learning curve

**Alternatives Considered**:
- Direct PostgreSQL writes: Blocks hot path
- In-memory queue: Lost on restart
- RabbitMQ/SQS: Extra infrastructure

---

## References

- [Design Decisions](DESIGN_DECISIONS.md)
- [RedisStateManager API](API_RedisStateManager.md)
- [DBWriteQueue API](API_DBWriteQueue.md)
- [Original Architecture](../design/ARCHITECTURE.md)
- [Phase 1 Validation](../project-tracking/PHASE_1_VALIDATION.md)
