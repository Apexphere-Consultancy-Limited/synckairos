# Phase 1: Core Architecture (Week 1)

**Goal:** Build the Redis-first distributed foundation
**Duration:** 5-7 days
**Status:** 🟡 In Progress
**Progress:** 10%
**Started:** 2025-10-21
**Target Completion:** End of Week 1

---

## Overview

Phase 1 establishes the foundational architecture for SyncKairos. The **RedisStateManager** is the most critical component - everything else depends on it. This phase also sets up PostgreSQL for audit logging and implements reliable async writes via BullMQ.

**Key Principle:** Redis is PRIMARY, PostgreSQL is AUDIT only.

---

## Component 1.1: Project Setup

**Estimated Time:** 0.5 days (4 hours)
**Status:** 🟢 Complete
**Priority:** High
**Dependencies:** None
**Completed:** 2025-10-21

### Tasks

- [ ] Initialize Node.js 20 LTS project with pnpm
  - [ ] `pnpm init`
  - [ ] Add `"type": "module"` to package.json
  - [ ] Set `"engines": { "node": ">=20.0.0" }`

- [ ] Configure TypeScript 5.x
  - [ ] Install: `pnpm add -D typescript @types/node`
  - [ ] Create `tsconfig.json` with strict mode
  - [ ] Set `target: "ES2022"`, `module: "ESNext"`
  - [ ] Enable: `strict`, `noUnusedLocals`, `noUnusedParameters`

- [ ] Setup ESLint + Prettier
  - [ ] Install: `pnpm add -D eslint prettier @typescript-eslint/parser @typescript-eslint/eslint-plugin`
  - [ ] Create `.eslintrc.json`
  - [ ] Create `.prettierrc`
  - [ ] Add scripts: `lint`, `format`

- [ ] Create project structure
  ```
  src/
  ├── api/
  │   ├── routes/
  │   ├── middlewares/
  │   └── controllers/
  ├── engine/
  ├── state/
  ├── websocket/
  ├── services/
  ├── monitoring/
  ├── types/
  ├── config/
  └── index.ts
  tests/
  ├── unit/
  ├── integration/
  └── load/
  ```

- [ ] Setup development environment
  - [ ] Create `.env.example` with all required variables
  - [ ] Install `dotenv`: `pnpm add dotenv`
  - [ ] Create `.gitignore`

- [ ] Install core dependencies
  ```bash
  pnpm add express ws ioredis pg bullmq zod jsonwebtoken pino pino-http prom-client express-rate-limit rate-limit-redis cors
  ```

- [ ] Install dev dependencies
  ```bash
  pnpm add -D vitest supertest tsx tsup @types/express @types/ws @types/pg @types/jsonwebtoken @types/cors pino-pretty
  ```

### Acceptance Criteria
- [ ] `pnpm install` runs successfully
- [ ] `pnpm run lint` passes
- [ ] `pnpm run format` works
- [ ] TypeScript compiles without errors
- [ ] Project structure created
- [ ] `.env.example` contains all config variables

### Files Created
- `package.json`
- `tsconfig.json`
- `.eslintrc.json`
- `.prettierrc`
- `.env.example`
- `.gitignore`
- Project directory structure

---

## Component 1.2: RedisStateManager Implementation

**Estimated Time:** 2-3 days
**Status:** 🔴 Not Started
**Priority:** ⭐ **CRITICAL PATH** - All other components depend on this
**Dependencies:** Project Setup (1.1)

### Tasks

#### Core Redis Operations (Day 1)

- [ ] Create `src/state/RedisStateManager.ts`

- [ ] Setup Redis connection (ioredis)
  - [ ] Create Redis client with connection URL from env
  - [ ] Create separate Pub/Sub client (requires dedicated connection)
  - [ ] Add connection error handling
  - [ ] Add reconnection logic

- [ ] Define TypeScript interfaces
  - [ ] `SyncState` interface (complete session state)
  - [ ] `SyncParticipant` interface
  - [ ] `SyncMode` enum
  - [ ] `SyncStatus` enum

- [ ] Implement `getSession(sessionId: string): Promise<SyncState | null>`
  - [ ] Redis GET operation: `session:{sessionId}`
  - [ ] JSON parse with error handling
  - [ ] Convert ISO strings to Date objects
  - [ ] Return null if not found
  - [ ] **Target latency:** 1-3ms

- [ ] Implement `createSession(state: SyncState): Promise<void>`
  - [ ] Validate state object
  - [ ] Call updateSession() internally

- [ ] Implement `updateSession(sessionId, state, expectedVersion?): Promise<void>`
  - [ ] Redis SETEX operation with 1 hour TTL
  - [ ] JSON stringify state
  - [ ] **Target latency:** 2-5ms

- [ ] Implement `deleteSession(sessionId: string): Promise<void>`
  - [ ] Redis DEL operation
  - [ ] Broadcast deletion event

#### Optimistic Locking (Day 1-2)

- [ ] Add version field to SyncState interface
  - [ ] Initialize version = 1 on creation
  - [ ] Increment version on every update

- [ ] Implement version checking in updateSession()
  - [ ] Accept optional `expectedVersion` parameter
  - [ ] If provided, fetch current state and compare versions
  - [ ] Throw error if version mismatch: `ConcurrentModificationError`
  - [ ] Include helpful error message with version numbers

- [ ] Add retry logic wrapper (optional utility)
  - [ ] Retry on version mismatch (max 3 attempts)
  - [ ] Exponential backoff: 10ms, 20ms, 40ms

#### Redis Pub/Sub (Day 2)

- [ ] Implement `subscribeToUpdates(callback): void`
  - [ ] Subscribe to `session-updates` channel
  - [ ] Parse JSON messages
  - [ ] Call callback with sessionId and state
  - [ ] Handle deleted sessions

- [ ] Implement `broadcastToSession(sessionId, message): Promise<void>`
  - [ ] Publish to `ws:{sessionId}` channel
  - [ ] JSON stringify message
  - [ ] **Target latency:** 1-2ms

- [ ] Implement `subscribeToWebSocket(callback): void`
  - [ ] PSUBSCRIBE to `ws:*` pattern
  - [ ] Extract sessionId from channel name
  - [ ] Parse JSON and call callback

- [ ] Update `updateSession()` to broadcast
  - [ ] After Redis write succeeds
  - [ ] Publish to `session-updates` channel
  - [ ] Include sessionId and full state

#### Async PostgreSQL Writes (Day 2-3)

- [ ] Add placeholder for `asyncDBWrite()`
  - [ ] Method signature defined
  - [ ] TODO comment for BullMQ integration (1.4)
  - [ ] Fire-and-forget call from updateSession()
  - [ ] Error handling (log but don't throw)

- [ ] Implement `recoverSession(sessionId): Promise<SyncState | null>`
  - [ ] Placeholder for PostgreSQL recovery
  - [ ] Return null for now (will implement with DBWriteQueue)
  - [ ] Add TODO comment

- [ ] Implement `close(): Promise<void>`
  - [ ] Gracefully quit Redis client
  - [ ] Gracefully quit Pub/Sub client
  - [ ] Unsubscribe from all channels

#### Unit Tests (Day 3)

- [ ] Create `tests/unit/RedisStateManager.test.ts`

- [ ] Test Redis CRUD operations
  - [ ] createSession() creates session in Redis
  - [ ] getSession() retrieves session
  - [ ] updateSession() modifies session
  - [ ] deleteSession() removes session
  - [ ] Session auto-expires after 1 hour (mock TTL)

- [ ] Test optimistic locking
  - [ ] Version increments on each update
  - [ ] ConcurrentModificationError thrown on version mismatch
  - [ ] Successful update when version matches

- [ ] Test Pub/Sub broadcasting
  - [ ] updateSession() publishes to session-updates
  - [ ] subscribeToUpdates() receives messages
  - [ ] broadcastToSession() publishes to ws:* channels
  - [ ] subscribeToWebSocket() receives messages

- [ ] Test error handling
  - [ ] Redis connection errors
  - [ ] Invalid JSON in Redis
  - [ ] Pub/Sub errors

- [ ] Test connection management
  - [ ] close() terminates connections gracefully

### Acceptance Criteria
- [ ] All CRUD operations work
- [ ] Latency: getSession() <3ms, updateSession() <5ms
- [ ] Optimistic locking prevents concurrent modifications
- [ ] Redis Pub/Sub cross-instance communication works
- [ ] Unit tests achieve >90% coverage
- [ ] No instance-local state (everything in Redis)

### Files Created
- `src/state/RedisStateManager.ts`
- `src/types/session.ts` (interfaces)
- `tests/unit/RedisStateManager.test.ts`

### Performance Targets
- `getSession()`: 1-3ms ✅
- `updateSession()`: 2-5ms ✅
- `Redis Pub/Sub`: 1-2ms ✅

---

## Component 1.3: PostgreSQL Schema Setup

**Estimated Time:** 1 day
**Status:** 🔴 Not Started
**Priority:** Medium (can run in parallel)
**Dependencies:** None

### Tasks

#### Database Schema Design (Morning)

- [ ] Create `migrations/001_initial_schema.sql`

- [ ] Define enums
  ```sql
  CREATE TYPE sync_mode AS ENUM (
    'per_participant',
    'per_cycle',
    'per_group',
    'global',
    'count_up'
  );

  CREATE TYPE sync_status AS ENUM (
    'pending',
    'running',
    'paused',
    'expired',
    'completed',
    'cancelled'
  );
  ```

- [ ] Create `sync_sessions` table (audit trail)
  ```sql
  CREATE TABLE sync_sessions (
    session_id UUID PRIMARY KEY,
    sync_mode sync_mode NOT NULL,
    time_per_cycle_ms INTEGER,
    increment_ms INTEGER DEFAULT 0,
    max_time_ms INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    final_status sync_status,
    metadata JSONB
  );
  ```

- [ ] Create `sync_events` table (event log)
  ```sql
  CREATE TABLE sync_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    participant_id UUID,
    group_id UUID,
    time_remaining_ms INTEGER,
    time_elapsed_ms INTEGER,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    state_snapshot JSONB,
    metadata JSONB
  );
  ```

#### Indexes (Afternoon)

- [ ] Create `migrations/002_add_indexes.sql`

- [ ] Add indexes for performance
  ```sql
  CREATE INDEX idx_sync_sessions_created ON sync_sessions(created_at DESC);
  CREATE INDEX idx_sync_events_session ON sync_events(session_id, timestamp DESC);
  CREATE INDEX idx_sync_events_type ON sync_events(event_type);
  CREATE INDEX idx_sync_events_timestamp ON sync_events(timestamp DESC);
  ```

#### Connection Setup

- [ ] Create `src/config/database.ts`
  - [ ] Import `pg` library
  - [ ] Create connection pool
  - [ ] Export pool instance
  - [ ] Add health check function

- [ ] Add database config to `.env.example`
  ```
  DATABASE_URL=postgresql://user:pass@localhost:5432/synckairos
  DATABASE_POOL_MIN=2
  DATABASE_POOL_MAX=20
  ```

#### Testing

- [ ] Create `tests/integration/database.test.ts`
  - [ ] Test database connection
  - [ ] Test migrations run successfully
  - [ ] Test basic INSERT into sync_sessions
  - [ ] Test basic INSERT into sync_events
  - [ ] Verify indexes exist

### Acceptance Criteria
- [ ] Migrations run successfully
- [ ] All tables and indexes created
- [ ] Connection pool connects successfully
- [ ] Health check query works (SELECT 1)
- [ ] Can insert test data

### Files Created
- `migrations/001_initial_schema.sql`
- `migrations/002_add_indexes.sql`
- `src/config/database.ts`

---

## Component 1.4: DBWriteQueue Implementation

**Estimated Time:** 1-2 days
**Status:** 🔴 Not Started
**Priority:** Medium (can start after RedisStateManager structure exists)
**Dependencies:** RedisStateManager structure, PostgreSQL schema

### Tasks

#### BullMQ Queue Setup (Day 1)

- [ ] Create `src/state/DBWriteQueue.ts`

- [ ] Setup BullMQ queue
  - [ ] Create Queue instance: `new Queue('db-writes', redisUrl)`
  - [ ] Configure default job options:
    - `attempts: 5`
    - `backoff: { type: 'exponential', delay: 2000 }`
    - `removeOnComplete: 100`
    - `removeOnFail: false`

- [ ] Create Worker instance
  - [ ] Process jobs: `new Worker('db-writes', processor)`
  - [ ] Call `performDBWrite()` for each job

- [ ] Implement `queueWrite(sessionId, state, eventType): Promise<void>`
  - [ ] Add job to queue with session data
  - [ ] Include timestamp
  - [ ] Fire-and-forget (don't await)

#### Database Write Logic (Day 1-2)

- [ ] Implement `performDBWrite(sessionId, state, eventType): Promise<void>`
  - [ ] Get pg pool from database config
  - [ ] INSERT into `sync_events` table
  - [ ] UPSERT into `sync_sessions` table
  - [ ] Use parameterized queries (prevent SQL injection)
  - [ ] Proper error handling

- [ ] Add event monitoring
  - [ ] Listen to `queue.on('completed', ...)`
  - [ ] Listen to `queue.on('failed', ...)`
  - [ ] Log successful writes (debug level)
  - [ ] Log failed writes (error level)

- [ ] Implement `alertOnPersistentFailure(job, error): Promise<void>`
  - [ ] Check if all 5 attempts exhausted
  - [ ] Log critical error
  - [ ] TODO: Send to Sentry/PagerDuty (Phase 3)

#### Monitoring & Metrics (Day 2)

- [ ] Implement `getMetrics(): Promise<QueueMetrics>`
  - [ ] Get waiting count
  - [ ] Get active count
  - [ ] Get completed count
  - [ ] Get failed count
  - [ ] Get delayed count
  - [ ] Return as object

- [ ] Implement `close(): Promise<void>`
  - [ ] Close queue gracefully
  - [ ] Wait for active jobs to complete

#### Integration with RedisStateManager

- [ ] Update `RedisStateManager.asyncDBWrite()`
  - [ ] Replace placeholder with `dbQueue.queueWrite()`
  - [ ] Pass sessionId, state, eventType
  - [ ] Non-blocking call

- [ ] Update `RedisStateManager` constructor
  - [ ] Accept DBWriteQueue instance
  - [ ] Store as private property

#### Unit Tests

- [ ] Create `tests/unit/DBWriteQueue.test.ts`

- [ ] Test successful writes
  - [ ] Job queued successfully
  - [ ] Job processed and written to DB
  - [ ] Metrics updated

- [ ] Test retry logic
  - [ ] Failed job retries up to 5 times
  - [ ] Exponential backoff delays
  - [ ] Job marked as failed after 5 attempts

- [ ] Test failure alerting
  - [ ] Alert triggered after 5 failures
  - [ ] Error details included

- [ ] Test metrics
  - [ ] Queue depth tracked
  - [ ] Completed/failed counts accurate

### Acceptance Criteria
- [ ] BullMQ queue processes jobs reliably
- [ ] Writes to PostgreSQL succeed
- [ ] Retry logic works (5 attempts with exponential backoff)
- [ ] Failed jobs are logged and alerted
- [ ] Metrics available for monitoring
- [ ] Non-blocking async writes from RedisStateManager
- [ ] Unit tests achieve >85% coverage

### Files Created
- `src/state/DBWriteQueue.ts`
- `tests/unit/DBWriteQueue.test.ts`

---

## Component 1.5: Validation

**Estimated Time:** 0.5 days (4 hours)
**Status:** 🔴 Not Started
**Priority:** High
**Dependencies:** RedisStateManager, DBWriteQueue

### Tasks

#### Code Review

- [ ] Review RedisStateManager
  - [ ] Verify NO instance-local caching
  - [ ] Verify NO in-memory state storage
  - [ ] Confirm all state goes through Redis
  - [ ] Check TTL is set on all writes (1 hour)

- [ ] Review project structure
  - [ ] No global state variables
  - [ ] No singleton patterns storing state
  - [ ] All components are stateless

#### Stateless Verification

- [ ] Manual test: Multi-instance simulation
  - [ ] Start two instances locally (different ports)
  - [ ] Create session on instance 1
  - [ ] Read session from instance 2 (should work)
  - [ ] Update session from instance 2
  - [ ] Verify instance 1 receives Pub/Sub update

- [ ] Document findings
  - [ ] Create `docs/project-tracking/PHASE_1_VALIDATION.md`
  - [ ] List verification steps
  - [ ] Confirm stateless design
  - [ ] Note any issues found

### Acceptance Criteria
- [ ] No instance-local state found
- [ ] Multi-instance test passes
- [ ] Pub/Sub cross-instance communication confirmed
- [ ] Documentation complete

### Files Created
- `docs/project-tracking/PHASE_1_VALIDATION.md`

---

## Phase 1 Success Criteria

### Must Complete Before Phase 2

- [ ] ✅ RedisStateManager fully tested
  - [ ] <5ms operations validated
  - [ ] Unit tests >90% coverage
  - [ ] Pub/Sub working

- [ ] ✅ PostgreSQL schema deployed
  - [ ] Migrations run successfully
  - [ ] Can connect and query

- [ ] ✅ Async audit writes working
  - [ ] BullMQ queue processing jobs
  - [ ] Writes to PostgreSQL succeed
  - [ ] Retry logic tested

- [ ] ✅ Zero instance-local state
  - [ ] Code review passed
  - [ ] Multi-instance test passed

- [ ] ✅ Redis Pub/Sub cross-instance communication
  - [ ] Tested with 2+ instances
  - [ ] Messages received reliably

### Performance Validation

| Operation | Target | Achieved | Status |
|-----------|--------|----------|--------|
| getSession() | <5ms | ___ ms | ⚪ |
| updateSession() | <5ms | ___ ms | ⚪ |
| Redis Pub/Sub | <5ms | ___ ms | ⚪ |

---

## Blockers & Risks

### Current Blockers
- None (Phase 1 not started)

### Potential Risks
- **Redis connection issues:** Mitigate with retry logic and health checks
- **Optimistic locking complexity:** Start simple, add retries only if needed
- **Pub/Sub message loss:** Redis Pub/Sub is fire-and-forget; document limitation
- **PostgreSQL async write delays:** Acceptable for audit trail; monitor queue depth

---

## Notes & Decisions

### Technical Decisions
- Using ioredis for Redis client (better TypeScript support than node-redis)
- Separate Redis connection for Pub/Sub (required by Redis)
- BullMQ for job queue (reliable, Redis-backed)
- Raw SQL with pg library (simpler than ORM for audit writes)

### Deferred to Later Phases
- Authentication/authorization (Phase 2)
- Rate limiting (Phase 2)
- Prometheus metrics for queue (Phase 3)
- Sentry/PagerDuty alerts (Phase 3)

---

## Progress Tracking

**Last Updated:** 2025-10-21

| Component | Status | Progress |
|-----------|--------|----------|
| 1.1 Project Setup | 🟢 | 100% |
| 1.2 RedisStateManager | 🔴 | 0% |
| 1.3 PostgreSQL Schema | 🔴 | 0% |
| 1.4 DBWriteQueue | 🔴 | 0% |
| 1.5 Validation | 🔴 | 0% |

**Overall Phase 1 Progress:** 10%
