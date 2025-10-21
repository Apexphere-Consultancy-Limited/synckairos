# Phase 1 System Design

**Status:** 🟢 Complete

## Overview

Distributed-first state management with Redis as PRIMARY store, PostgreSQL as AUDIT trail.

**Design Goals**:
- Zero instance-local state (any instance serves any request)
- Sub-5ms operations (achieved 0.25-0.61ms)
- Horizontal scalability
- Async PostgreSQL audit via BullMQ

## Architecture

```
┌─────────────────────────────────────────────┐
│        Client Applications                   │
└────────────────┬────────────────────────────┘
                 │ HTTP/WebSocket
                 ▼
┌─────────────────────────────────────────────┐
│   Load Balancer (NO sticky sessions)        │
└─┬──────┬──────┬──────────────────────────┬──┘
  │      │      │                          │
  ▼      ▼      ▼                          ▼
┌────┐ ┌────┐ ┌────┐                    ┌────┐
│ I1 │ │ I2 │ │ I3 │       ...          │ IN │
└─┬──┘ └─┬──┘ └─┬──┘                    └─┬──┘
  │      │      │                          │
  └──────┼──────┼──────────────────────────┘
         │      │
    ┌────┴──┐   └─────────┐
    ▼       ▼             ▼
┌─────────────┐    ┌──────────────┐
│   Redis     │    │ PostgreSQL   │
│  PRIMARY    │───▶│   AUDIT      │
│  (<5ms)     │    │   (async)    │
└─────────────┘    └──────────────┘
```

**Instance Architecture**: STATELESS

```
┌──────────────────────────────────────┐
│        SyncKairos Instance            │
│                                      │
│  ┌────────────────────────────────┐ │
│  │  Express HTTP + WebSocket      │ │
│  └────────────┬───────────────────┘ │
│               ▼                      │
│  ┌────────────────────────────────┐ │
│  │  RedisStateManager             │ │
│  │  • getSession (0.25ms)         │ │
│  │  • updateSession (0.46ms)      │ │
│  │  • Pub/Sub (0.19ms)            │ │
│  └────────────┬───────────────────┘ │
│               ▼                      │
│  ┌────────────────────────────────┐ │
│  │  DBWriteQueue (BullMQ)         │ │
│  │  • Async PostgreSQL writes     │ │
│  │  • Retry: 5x, exponential      │ │
│  └────────────────────────────────┘ │
└──────────────────────────────────────┘
```

## Components

### RedisStateManager

Primary state store operations.

**Core Methods**:
```typescript
getSession(sessionId)          // 0.25ms avg
createSession(state)           // 0.22ms avg
updateSession(id, state, ver?) // 0.46ms avg
deleteSession(sessionId)       // 1-2ms
```

**Pub/Sub Methods**:
```typescript
subscribeToUpdates(callback)   // Listen to all updates
broadcastToSession(id, msg)    // Cross-instance messaging
```

**Storage**:
- Key: `session:{sessionId}`
- TTL: 3600s (1 hour)
- Optimistic locking: `version` field

### DBWriteQueue

Async PostgreSQL audit writes via BullMQ.

**Configuration**:
- Concurrency: 10 workers
- Retry: 5 attempts (2s, 4s, 8s, 16s, 32s)
- Cleanup: Keep last 100 jobs for 1 hour

**Job Data**:
```typescript
{
  sessionId: string
  state: SyncState       // Full snapshot
  eventType: string      // 'session_created', 'session_updated'
  timestamp: number
}
```

**Writes to**:
- `sync_sessions` (upsert)
- `sync_events` (insert with snapshot)

## Data Flows

### Create Session

```
Client → Instance → Redis SET + PUBLISH → BullMQ → PostgreSQL
                         ↓
                    Other instances receive Pub/Sub
```

### Update Session (Hot Path)

```
Client → Instance → GET → Validate → SET (version++) → PUBLISH
                                           ↓
                                      Response (3-5ms)

Async: BullMQ → PostgreSQL (non-blocking)
```

### Cross-Instance Communication

```
Instance 1: updateSession(id, state)
    ↓
Redis PUBLISH session-updates
    ↓
Instances 2-N: Pub/Sub callback triggered (<2ms)
```

## State Lifecycle

```
PENDING → startSession() → RUNNING
                             ↓
    ┌────────────────────────┼────────────────────┐
    ↓                        ↓                    ↓
 PAUSED ← resumeSession   COMPLETED          CANCELLED
    ↓
 RUNNING (resume)

EXPIRED ← TTL timeout (1 hour)
```

## TTL Management

- All sessions: 1-hour TTL
- Every update: Refreshes TTL
- Expired sessions: Auto-removed from Redis
- Recovery: Can restore from PostgreSQL (Phase 2)

## Performance

### Measured vs Targets

| Operation | Target | Achieved | vs Target |
|-----------|--------|----------|-----------|
| GET avg | <3ms | 0.25ms | 12x |
| GET p95 | <5ms | 0.33ms | 15x |
| UPDATE avg | <5ms | 0.46ms | 10x |
| UPDATE p95 | <10ms | 0.61ms | 16x |
| Pub/Sub | <2ms | 0.19ms | 10x |

### Scalability

- **Horizontal**: O(1) - add instances without code changes
- **Throughput**: ~10k ops/sec per instance
- **Memory**: ~50MB per instance (stateless)
- **Redis**: ~1-2KB per session

## Design Decisions

### Redis as PRIMARY

**Why**:
- Sub-5ms latency (vs 10-30ms PostgreSQL)
- Built-in Pub/Sub
- Automatic TTL cleanup
- Horizontal scaling

**Trade-off**: In-memory only (mitigated by PostgreSQL audit)

### Async PostgreSQL

**Why**:
- Never blocks hot path
- Handles PostgreSQL downtime
- Retry resilience

**Trade-off**: Eventual consistency (acceptable for audit trail)

### BullMQ

**Why**:
- Redis-backed (consistent architecture)
- Built-in retry/backoff
- Battle-tested

**Alternative considered**: Direct writes (would block hot path)

## Optimistic Locking

Concurrent modification detection via `version` field:

```typescript
// Update increments version
newState.version = currentState.version + 1

// Detect conflicts
if (currentState.version !== expectedVersion) {
  throw new ConcurrencyError(...)
}
```

**Use case**: Multiple instances updating same session simultaneously

## See Also

- [Data Flow Diagrams](DATA_FLOW.md)
- [Design Decisions](DESIGN_DECISIONS.md)
- [RedisStateManager API](../api/RedisStateManager.md)
- [DBWriteQueue API](../api/DBWriteQueue.md)
