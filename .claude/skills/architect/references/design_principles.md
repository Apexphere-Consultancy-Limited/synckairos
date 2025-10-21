# SyncKairos Design Principles & Architecture Rules

**Purpose:** Reference for code reviews and architectural decisions
**Version:** v2.0
**Last Updated:** 2025-10-21

---

## Core Design Principles

### 1. Calculate, Don't Count

**Principle:** Use authoritative server timestamps for calculations, never local countdown timers.

**Why:** Local timers drift; server calculations don't.

**Code Pattern:**
```typescript
// ✅ CORRECT: Calculate from server time
const timeRemaining = totalTime - (serverNow - cycleStartedAt)

// ❌ WRONG: Count down locally
setInterval(() => timeRemaining--, 1000)
```

**Review Checklist:**
- [ ] All time calculations use server timestamps
- [ ] No setInterval/setTimeout for countdown logic
- [ ] Client calculates remaining time from server state
- [ ] Server provides authoritative cycle_started_at timestamp

---

### 2. Distributed-First Design

**Principle:** Design for multiple instances from day one.

**Why:** Single-server assumptions break horizontal scaling.

**Architecture Requirements:**
- No server-local state (no in-memory caches per instance)
- Shared state store (Redis) as primary source of truth
- Cross-instance communication (Redis Pub/Sub)
- Any instance can handle any request
- No sticky sessions required

**Code Patterns:**

```typescript
// ✅ CORRECT: Use Redis for state
class RedisStateManager {
  async getSession(sessionId: string): Promise<SyncState | null> {
    const data = await this.redis.get(`session:${sessionId}`)
    return data ? JSON.parse(data) : null
  }
}

// ❌ WRONG: Instance-local cache
class SessionManager {
  private cache = new Map<string, SyncState>() // ❌ Breaks multi-instance

  getSession(sessionId: string): SyncState {
    return this.cache.get(sessionId) // ❌ Only on this instance
  }
}
```

**Review Checklist:**
- [ ] No class-level state variables (except constants)
- [ ] No Map/Set for storing session data
- [ ] All state reads/writes go through RedisStateManager
- [ ] No assumptions about "current instance" having data
- [ ] Pub/Sub used for cross-instance notifications

---

### 3. Hot Path Optimization

**Principle:** Critical operations (<50ms target) must not touch slow data stores.

**Why:** PostgreSQL queries (10-30ms) break <50ms latency targets.

**Hot Path vs Cold Path:**

**Hot Path (Real-time - <50ms target):**
- `switchCycle()` - Redis only (target: 3-5ms)
- `getCurrentState()` - Redis only (target: 1-3ms)
- WebSocket broadcasts - Pub/Sub (target: 1-2ms)

**Cold Path (Non-critical):**
- Audit logging - PostgreSQL async (doesn't block)
- Analytics - PostgreSQL async
- Historical data - PostgreSQL

**Code Pattern:**
```typescript
// ✅ CORRECT: Hot path uses Redis only
async switchCycle(sessionId: string): Promise<SwitchCycleResult> {
  // 1. Read from Redis (1-3ms)
  const state = await this.redisStateManager.getSession(sessionId)

  // 2. Business logic (<1ms)
  const newState = this.calculateNewState(state)

  // 3. Write to Redis (2-3ms)
  await this.redisStateManager.updateSession(sessionId, newState)

  // 4. Async audit (non-blocking)
  this.auditQueue.add({ sessionId, state: newState }) // Fire and forget

  return result // Total: 3-5ms ✅
}

// ❌ WRONG: Hot path queries PostgreSQL
async switchCycle(sessionId: string): Promise<SwitchCycleResult> {
  const state = await this.redisStateManager.getSession(sessionId)
  const newState = this.calculateNewState(state)

  await this.redisStateManager.updateSession(sessionId, newState)
  await this.db.query('INSERT INTO sync_events...') // ❌ Blocks for 10-30ms

  return result // Total: 15-35ms ❌ (missed target)
}
```

**Review Checklist:**
- [ ] `switchCycle()` never awaits PostgreSQL queries
- [ ] All database writes are async (BullMQ queue)
- [ ] Hot path only uses Redis operations
- [ ] Latency budgets respected (<50ms total)

---

### 4. State Ownership Clarity

**Principle:** Every piece of data has ONE clear owner and purpose.

**Data Ownership:**
- **Redis** = PRIMARY for all active session state (TTL 1 hour)
- **PostgreSQL** = AUDIT TRAIL only (async writes)
- **Application Memory** = NOTHING (truly stateless)

**Code Pattern:**
```typescript
// ✅ CORRECT: Clear ownership
class SyncEngine {
  constructor(private stateManager: RedisStateManager) {}

  async getSession(sessionId: string): Promise<SyncState> {
    // Redis is the source of truth
    return await this.stateManager.getSession(sessionId)
  }
}

// ❌ WRONG: Ambiguous ownership
class SyncEngine {
  private sessionCache = new Map<string, SyncState>() // ❌

  async getSession(sessionId: string): Promise<SyncState> {
    // Which is the source of truth? Cache or Redis?
    if (this.sessionCache.has(sessionId)) {
      return this.sessionCache.get(sessionId) // ❌ Stale data
    }
    const state = await this.stateManager.getSession(sessionId)
    this.sessionCache.set(sessionId, state) // ❌ Now out of sync
    return state
  }
}
```

**Review Checklist:**
- [ ] Redis is queried for every state read (no caching)
- [ ] PostgreSQL only written to async (audit trail)
- [ ] No duplicate state storage
- [ ] Clear data flow: Redis → Business Logic → Redis

---

### 5. Optimistic Locking for Concurrent Updates

**Principle:** Use version field to prevent race conditions in distributed systems.

**Why:** Multiple instances can update the same session concurrently.

**Code Pattern:**
```typescript
// ✅ CORRECT: Optimistic locking with version field
async switchCycle(sessionId: string): Promise<SwitchCycleResult> {
  const state = await this.stateManager.getSession(sessionId)
  const expectedVersion = state.version // Capture current version

  // Calculate new state
  const newState = { ...state, version: expectedVersion + 1 }

  // Update with version check
  await this.stateManager.updateSession(sessionId, newState, expectedVersion)
  // ↑ Throws if version doesn't match (another instance updated)
}

// RedisStateManager implementation
async updateSession(sessionId: string, state: SyncState, expectedVersion?: number) {
  if (expectedVersion !== undefined) {
    const current = await this.getSession(sessionId)
    if (current.version !== expectedVersion) {
      throw new Error('Concurrent modification detected')
    }
  }

  await this.redis.setex(`session:${sessionId}`, 3600, JSON.stringify(state))
}

// ❌ WRONG: No concurrency protection
async switchCycle(sessionId: string): Promise<SwitchCycleResult> {
  const state = await this.stateManager.getSession(sessionId)
  const newState = { ...state } // ❌ No version check
  await this.stateManager.updateSession(sessionId, newState)
  // ↑ Lost update if another instance modified concurrently
}
```

**Review Checklist:**
- [ ] All state objects have a `version` field
- [ ] Version incremented on every update
- [ ] `updateSession()` accepts `expectedVersion` parameter
- [ ] Version mismatch throws error
- [ ] Critical operations (switchCycle) use optimistic locking

---

### 6. Fail-Fast and Observable

**Principle:** Errors should be loud, monitoring should be built-in.

**Code Pattern:**
```typescript
// ✅ CORRECT: Fail-fast with structured errors
async switchCycle(sessionId: string): Promise<SwitchCycleResult> {
  const state = await this.stateManager.getSession(sessionId)

  if (!state) {
    throw new NotFoundError(`Session ${sessionId} not found`)
  }

  if (state.status !== 'running') {
    throw new InvalidStateError(
      `Cannot switch cycle: session status is ${state.status}, expected 'running'`
    )
  }

  // Log important operations
  logger.info({ sessionId, from: state.active_participant_id }, 'Switching cycle')

  // Metrics
  cycleSwitchCounter.inc()
  const timer = cycleSwitchLatency.startTimer()

  try {
    const result = await this.performSwitch(sessionId, state)
    timer() // Record latency
    return result
  } catch (error) {
    logger.error({ error, sessionId }, 'Cycle switch failed')
    cycleSwitchErrors.inc()
    throw error
  }
}

// ❌ WRONG: Silent failures
async switchCycle(sessionId: string): Promise<SwitchCycleResult | null> {
  const state = await this.stateManager.getSession(sessionId)
  if (!state) return null // ❌ Silent failure
  if (state.status !== 'running') return null // ❌ No error info

  try {
    return await this.performSwitch(sessionId, state)
  } catch (error) {
    console.log('Error:', error) // ❌ Not structured, no metrics
    return null // ❌ Swallows error
  }
}
```

**Review Checklist:**
- [ ] Errors are thrown (not returned as null)
- [ ] Custom error types for different failures
- [ ] Structured logging with context (Pino)
- [ ] Prometheus metrics for critical operations
- [ ] Error messages include actionable information

---

### 7. Simple Over Clever

**Principle:** Easy deployment and operation beats technical sophistication.

**Code Pattern:**
```typescript
// ✅ CORRECT: Simple, direct approach
async logAuditEvent(sessionId: string, state: SyncState): Promise<void> {
  // Use job queue for reliability
  await this.auditQueue.add({
    sessionId,
    state,
    timestamp: new Date()
  })
}

// ❌ WRONG: Over-engineered
class AuditEventProcessor {
  private batchBuffer: AuditEvent[] = []
  private batchTimer: NodeJS.Timeout
  private compressionEnabled = true
  private dedupCache = new LRUCache(1000)

  async logAuditEvent(sessionId: string, state: SyncState): Promise<void> {
    // Complex batching, compression, deduplication logic...
    // ❌ Adds complexity for minimal gain
  }
}
```

**Review Checklist:**
- [ ] Code is easy to understand and maintain
- [ ] No premature optimization
- [ ] Simple patterns over clever abstractions
- [ ] Clear > Clever

---

## Architecture Violations to Watch For

### Critical Violations (Block PR)

1. **Instance-local state storage**
   - `private cache = new Map()`
   - `class-level state variables`
   - Storing session data in memory

2. **Hot path database queries**
   - `await db.query()` in switchCycle()
   - Synchronous PostgreSQL writes
   - Blocking on slow operations

3. **Missing optimistic locking**
   - No version field
   - No version checks on critical updates
   - Race condition vulnerabilities

4. **Local countdown timers**
   - `setInterval(() => time--, 1000)`
   - Client-side time tracking without server sync

### Major Violations (Request changes)

1. **Poor error handling**
   - Silent failures (returning null)
   - No structured logging
   - Missing metrics

2. **Unclear data ownership**
   - Multiple sources of truth
   - Duplicate state storage

3. **Missing tests for critical paths**
   - No unit tests for switchCycle()
   - No concurrency tests

### Minor Violations (Suggest improvements)

1. **Inconsistent logging**
   - Using console.log instead of Pino
   - Missing context in logs

2. **Hard-coded values**
   - Magic numbers
   - No configuration

3. **Missing TypeScript types**
   - Using `any`
   - Loose type definitions

---

## Code Review Checklist

### General

- [ ] Follows TypeScript strict mode
- [ ] All functions have clear return types
- [ ] No `any` types (use `unknown` if needed)
- [ ] Consistent error handling

### Architecture

- [ ] Respects Redis as PRIMARY state store
- [ ] No instance-local state
- [ ] Hot path operations use Redis only
- [ ] PostgreSQL writes are async only

### Performance

- [ ] Critical operations target <50ms
- [ ] No N+1 queries
- [ ] Proper use of Redis pipelining if needed
- [ ] No blocking operations on hot path

### Concurrency

- [ ] Version field used for critical updates
- [ ] Optimistic locking implemented
- [ ] No race conditions

### Observability

- [ ] Structured logging with Pino
- [ ] Prometheus metrics for key operations
- [ ] Errors include actionable context

### Testing

- [ ] Unit tests for business logic
- [ ] Integration tests for API endpoints
- [ ] Edge cases covered
- [ ] Concurrency scenarios tested

---

## Common Mistakes to Catch

### Mistake 1: Caching Session State

```typescript
// ❌ WRONG
class SessionService {
  private cache = new Map<string, SyncState>()

  async getSession(id: string): Promise<SyncState> {
    if (this.cache.has(id)) return this.cache.get(id)
    const state = await redis.get(id)
    this.cache.set(id, state)
    return state
  }
}

// ✅ CORRECT
class SessionService {
  async getSession(id: string): Promise<SyncState> {
    return await this.redisStateManager.getSession(id)
  }
}
```

### Mistake 2: Synchronous Database Writes

```typescript
// ❌ WRONG
async switchCycle(sessionId: string) {
  // ... business logic ...
  await this.redis.set(key, state)
  await this.db.query('INSERT INTO sync_events...') // ❌ Blocks
}

// ✅ CORRECT
async switchCycle(sessionId: string) {
  // ... business logic ...
  await this.redis.set(key, state)
  this.auditQueue.add({ sessionId, state }) // Non-blocking
}
```

### Mistake 3: No Version Check

```typescript
// ❌ WRONG
async switchCycle(sessionId: string) {
  const state = await this.getSession(sessionId)
  state.active_participant_id = nextId
  await this.updateSession(sessionId, state) // ❌ Race condition
}

// ✅ CORRECT
async switchCycle(sessionId: string) {
  const state = await this.getSession(sessionId)
  const expectedVersion = state.version
  state.active_participant_id = nextId
  state.version++
  await this.updateSession(sessionId, state, expectedVersion)
}
```

---

## Performance Budgets

| Operation | Budget | Typical | Max Acceptable |
|-----------|--------|---------|----------------|
| Redis GET | 2ms | 1-2ms | 5ms |
| Redis SET | 3ms | 2-3ms | 5ms |
| Redis Pub/Sub | 2ms | 1-2ms | 5ms |
| switchCycle() total | 50ms | 3-5ms | 50ms |
| WebSocket delivery | 100ms | 50-80ms | 100ms |

**Review Rule:** If a PR adds latency to hot path, it must justify the cost.

---

## References

- [Architecture Document](../../../docs/design/ARCHITECTURE.md)
- [Implementation Guide](../../../docs/design/IMPLEMENTATION.md)
- [Tech Stack](../../../docs/design/TECH_STACK.md)
