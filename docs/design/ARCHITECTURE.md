# SyncKairos - Architecture

**Version:** 2.0
**Last Updated:** 2025-10-20

---

## Overview

SyncKairos is a standalone, high-performance real-time synchronization service built on a **distributed-first architecture** with Redis as the primary state store and PostgreSQL for audit logging.

### Core Principles

#### 1. "Calculate, Don't Count"

Instead of counting down locally, calculate time from authoritative timestamps:

```
time_remaining = base_time - (current_server_time - turn_start_time)
```

This ensures all clients always calculate the same value from the same source of truth.

#### 2. "Distributed-First Design"

Designed for multiple instances from day one:
- **Redis as PRIMARY** - All active session state
- **PostgreSQL as AUDIT** - Async writes only
- **Redis Pub/Sub** - Cross-instance communication
- **Truly stateless** - Any instance can serve any request

#### 3. "Hot Path Optimization"

Critical operations (<50ms) must never touch PostgreSQL:
- `switchCycle()` - Redis only (3-5ms)
- `getCurrentState()` - Redis only (1-3ms)
- WebSocket broadcasts - Pub/Sub (1-2ms)

---

## Architecture Diagram

### Corrected Distributed-First Design

```
┌─────────────────────────────────────────────────────────────┐
│              Client Applications                            │
│  (Games / Live Events / Meetings / Exams / etc.)           │
│  useSyncKairos hook (SDK client)                           │
└────────────────┬────────────────────────────────────────────┘
                 │ REST + WebSocket
                 ▼
┌─────────────────────────────────────────────────────────────┐
│         Load Balancer (NO Sticky Sessions)                  │
└────┬────────────┬───────────────────────────────────────────┘
     │            │
     ▼            ▼
┌─────────┐  ┌─────────┐  ┌─────────┐
│SyncKairos│  │SyncKairos│  │SyncKairos│
│Instance 1│  │Instance 2│  │Instance N│
│          │  │          │  │          │
│STATELESS │  │STATELESS │  │STATELESS │ (Auto-scale)
└────┬─────┘  └────┬─────┘  └────┬─────┘
     │             │              │
     └─────────────┼──────────────┘
                   │
          ┌────────┴────────┐
          │                 │
          ▼                 ▼
   ┌──────────┐      ┌──────────┐
   │  Redis   │      │PostgreSQL│
   │ Cluster  │─────▶│ Database │
   │(PRIMARY) │async │ (AUDIT)  │
   │  State   │write │  Trail   │
   │          │      │          │
   │ Pub/Sub  │      │          │
   └──────────┘      └──────────┘
   1-5ms latency     Async only
```

### Data Flow

1. **Client** sends request (REST) or maintains connection (WebSocket)
2. **Load Balancer** routes to ANY available instance (round-robin)
3. **Instance** reads/writes to **Redis** (3-5ms hot path)
4. **Redis Pub/Sub** broadcasts updates to all instances
5. **All Instances** push updates to their connected WebSocket clients
6. **PostgreSQL** receives async writes for audit trail (non-blocking)

**Key Principle:** Redis is the single source of truth. PostgreSQL is backup/audit only.

---

## Service Boundaries

**Name:** `synckairos`
**Deployment:** Truly stateless, horizontally scalable service
**Communication:** REST API + WebSocket for real-time updates
**Language:** Node.js/TypeScript
**Primary Store:** Redis (in-memory, <5ms operations)
**Audit Store:** PostgreSQL (async writes only)
**Protocol:** JSON over HTTP/HTTPS and WebSocket
**Scaling:** PaaS auto-scaling (Fly.io, Railway) or Kubernetes HPA

---

## Redis Data Structure (PRIMARY State Store)

### Session State in Redis

```typescript
// Key: session:{session_id}
// TTL: 1 hour (auto-expire inactive sessions)
// Value: JSON serialized session state

{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "sync_mode": "per_participant",
  "time_per_cycle_ms": null,
  "increment_ms": 0,
  "max_time_ms": null,
  "active_participant_id": "player1",
  "active_group_id": null,
  "cycle_started_at": "2025-10-20T14:30:00.000Z",
  "status": "running",
  "action_on_timeout": { "type": "auto_action", "action": "default" },
  "auto_advance": false,
  "participants": [
    {
      "participant_id": "player1",
      "group_id": null,
      "participant_index": 0,
      "total_time_ms": 600000,
      "time_used_ms": 15000,
      "cycle_count": 5,
      "is_active": true,
      "has_expired": false
    },
    {
      "participant_id": "player2",
      "participant_index": 1,
      "total_time_ms": 580000,
      "time_used_ms": 20000,
      "cycle_count": 4,
      "is_active": false,
      "has_expired": false
    }
  ],
  "version": 12,
  "metadata": {}
}
```

### Redis Pub/Sub Channels

```typescript
// Channel: session-updates
// Purpose: Broadcast state changes to all instances
// Message format:
{
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "state": { /* full session state */ }
}

// Channel: ws:{session_id}
// Purpose: WebSocket message broadcasting
// Message format:
{
  "type": "STATE_UPDATE",
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": 1729432200000,
  "state": { /* session state */ }
}
```

### Redis Operations (Hot Path)

| Operation | Command | Latency | Used By |
|-----------|---------|---------|---------|
| Get session | `GET session:{id}` | 1-2ms | getCurrentState() |
| Save session | `SETEX session:{id} 3600 {json}` | 2-3ms | switchCycle() |
| Broadcast update | `PUBLISH session-updates {msg}` | 1-2ms | All state changes |
| Subscribe updates | `SUBSCRIBE session-updates` | - | Instance startup |

**Total hot path latency:** 3-5ms (Redis only)

---

## PostgreSQL Schema (AUDIT Trail Only)

**IMPORTANT:** PostgreSQL is NOT queried during hot path operations. It receives async writes only for:
- Audit logging
- Compliance requirements
- Analytics and reporting
- Historical data recovery

### Table: sync_sessions

Audit trail of session configurations (written once on creation, updated async).

```sql
CREATE TABLE sync_sessions (
  session_id UUID PRIMARY KEY,
  sync_mode sync_mode NOT NULL,
  time_per_cycle_ms INTEGER,
  increment_ms INTEGER DEFAULT 0,
  max_time_ms INTEGER,

  -- Audit timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Final state (updated on completion)
  final_status sync_status,

  -- Metadata
  metadata JSONB
);

CREATE INDEX idx_sync_sessions_created ON sync_sessions(created_at DESC);
```

### Table: sync_events

Complete audit log of all state changes.

```sql
CREATE TABLE sync_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL,

  -- Event details
  event_type VARCHAR(50) NOT NULL,
  participant_id UUID,
  group_id UUID,

  -- Time snapshot
  time_remaining_ms INTEGER,
  time_elapsed_ms INTEGER,
  timestamp TIMESTAMPTZ DEFAULT NOW(),

  -- Full state snapshot
  state_snapshot JSONB,

  -- Additional data
  metadata JSONB
);

CREATE INDEX idx_sync_events_session ON sync_events(session_id, timestamp DESC);
CREATE INDEX idx_sync_events_type ON sync_events(event_type);
```

**Event Types:**
- `session_created` - Session created
- `session_started` - Session started
- `cycle_switched` - Cycle/participant switched (hot path)
- `session_paused` - Session paused
- `session_resumed` - Session resumed
- `participant_expired` - Participant time expired
- `session_completed` - Session completed
- `session_cancelled` - Session cancelled

---

## Supporting Data Types

```sql
CREATE TYPE sync_mode AS ENUM (
  'per_participant',  -- Each participant has own timer (chess players, exam students)
  'per_cycle',        -- Fixed time per cycle/turn (auction bids, meeting agenda items)
  'per_group',        -- Group-based timers (team competitions, breakout rooms)
  'global',           -- Single timer for entire session (countdown, meditation)
  'count_up'          -- Stopwatch mode (speedruns, elapsed time tracking)
);

CREATE TYPE sync_status AS ENUM (
  'pending',       -- Session created but not started
  'running',       -- Session is active
  'paused',        -- Session is paused
  'expired',       -- Time ran out
  'completed',     -- Session completed normally
  'cancelled'      -- Session cancelled/abandoned
);
```

### Example Action Configuration

```json
{
  "action_on_timeout": {
    "type": "auto_action",
    "action": "default",           // Trigger default action (poker fold, quiz skip, etc)
    "notify_participants": true
  }
}

{
  "action_on_timeout": {
    "type": "skip_cycle",
    "penalty": {
      "points": -10                // Deduct points for timeout
    }
  }
}

{
  "action_on_timeout": {
    "type": "end_session",
    "outcome": "timeout",
    "winner_by": "time"            // For competitive sessions
  }
}
```

---

## Performance Requirements

### End-to-End Performance (Redis-First Architecture)

| Metric | Target | Expected (Redis) | Old (PostgreSQL) |
|--------|--------|------------------|------------------|
| Cycle switch latency | < 50ms | **3-5ms** ✅ | 20-30ms |
| WebSocket update delivery | < 100ms | **50-80ms** ✅ | 50-80ms |
| Server time sync accuracy | < 50ms | **10-30ms** ✅ | 10-30ms |
| Time calculation accuracy | ±10ms | **±5ms** ✅ | ±5ms |
| Concurrent sessions | 10,000+ | **50,000+** ✅ | 10,000+ |

### Component-Level Performance

| Operation | Target | Actual | Notes |
|-----------|--------|--------|-------|
| Redis GET | < 5ms | **1-2ms** | Session state retrieval |
| Redis SETEX | < 5ms | **2-3ms** | Session state update |
| Redis Pub/Sub | < 5ms | **1-2ms** | Cross-instance broadcast |
| PostgreSQL async write | N/A | 10-30ms | Non-blocking, audit only |
| WebSocket message send | < 10ms | **5-10ms** | Per client |

**Note:** Redis-first architecture achieves 6-10x performance improvement on hot path compared to PostgreSQL-based design.

---

## Key Architectural Decisions

### 1. Redis as PRIMARY State Store (Not Cache)
**Decision:** Use Redis as the authoritative source of truth for all active session state.

**Why:**
- Sub-5ms operations meet <50ms performance target
- Built-in TTL (1 hour) auto-expires inactive sessions
- Atomic operations prevent race conditions
- Built-in Pub/Sub for cross-instance communication

**Impact:** Hot path operations never touch PostgreSQL.

---

### 2. PostgreSQL as AUDIT Trail Only
**Decision:** PostgreSQL receives async writes only. Never queried on hot path.

**Why:**
- PostgreSQL latency (10-30ms) breaks <50ms target
- Audit logging doesn't need real-time performance
- Analytics queries don't impact production traffic

**Impact:** True separation of hot path (Redis) and cold path (PostgreSQL).

---

### 3. Redis Pub/Sub for Cross-Instance Broadcasting
**Decision:** All state changes broadcast via Redis Pub/Sub to all instances.

**Why:**
- WebSocket clients connected to different instances need updates
- No sticky sessions required (true stateless)
- Sub-millisecond message delivery
- Built into Redis (no additional infrastructure)

**Impact:** Any instance can serve any request. True horizontal scaling.

---

### 4. Calculation-Based Time Tracking
**Decision:** Calculate time from authoritative timestamps, never count down locally.

**Formula:**
```
time_remaining = total_time - (server_now - cycle_started_at)
```

**Why:**
- Local timers drift
- Calculations from server time are always accurate
- Perfect synchronization across all clients

**Impact:** Zero visible time corrections.

---

### 5. Truly Stateless Instances
**Decision:** Zero application-level state stored in instance memory.

**Why:**
- Enables graceful shutdowns
- No data loss on instance crashes
- Simple auto-scaling (no session draining)
- No sticky sessions required

**Impact:** Easy deployment, horizontal scaling, and multi-region.

---

### 6. Optimistic Locking with Version Field
**Decision:** Version field in Redis state prevents race conditions.

**Why:**
- Multiple instances updating same session concurrently
- Prevents lost updates
- Simple conflict detection

**Implementation:**
```typescript
// Before write, check version matches
if (currentState.version !== expectedVersion) {
  throw new Error('Concurrent modification detected')
}
// Increment version on write
newState.version = currentState.version + 1
```

---

### 7. WebSocket for Real-Time Updates
**Decision:** WebSocket for sub-100ms update delivery to all clients.

**Why:**
- Persistent connection avoids polling overhead
- Sub-100ms message delivery
- Heartbeat mechanism for connection health
- Automatic reconnection support

**Impact:** Real-time synchronization across all clients.

---

### 8. PaaS-First Deployment Strategy
**Decision:** Recommend PaaS (Fly.io, Railway) over Kubernetes for deployment.

**Why:**
- One-command deployment (`fly deploy`)
- Built-in auto-scaling
- Lower operational complexity
- Multi-region by default
- Lower cost ($20-40/mo vs $180/mo)

**Impact:** "Effortless" deployment as promised.
