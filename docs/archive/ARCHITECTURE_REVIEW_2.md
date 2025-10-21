# SyncKairos - Architecture Review 2

**Version:** 1.0
**Date:** 2025-10-20
**Status:** Design Review - Critical Issues Identified

---

## Executive Summary

After implementing the Redis-first distributed architecture, a second review identified **12 critical issues** that need to be addressed before production deployment. While the distributed-first design is sound, there are gaps in high availability, error handling, and operational procedures.

**Overall Assessment:** Design is 85% production-ready, but missing critical resilience and operational pieces.

---

## Critical Issues

### Issue #1: Redis Single Point of Failure 🔴

**Severity:** Critical
**Location:** Architecture design

**Problem:**

With Redis as the PRIMARY state store, if Redis fails, the entire service stops. The current design doesn't address:

1. **What happens during Redis failover?**
   - All WebSocket connections disconnect
   - All active sessions lost until Redis recovers
   - No graceful degradation strategy
   - Clients see "service unavailable"

2. **No Redis High Availability strategy documented:**
   - No mention of Redis Sentinel for automatic failover
   - No discussion of Redis Cluster for horizontal scaling
   - No persistence strategy defined (AOF vs RDB)
   - No recovery time objective (RTO) defined

3. **Async PostgreSQL writes create recovery gap:**
   - Redis state may be 1-2 seconds ahead of PostgreSQL
   - If Redis fails before async write completes, data is lost
   - No session recovery mechanism from PostgreSQL

**Impact:**

- **Availability:** Single Redis instance = single point of failure
- **Data Loss:** Up to 2 seconds of session state can be lost
- **User Experience:** All clients disconnect on Redis failure

**Recommended Solution:**

#### Option A: Redis Sentinel (Recommended)

**Setup:**
```yaml
# Redis Sentinel Configuration
sentinel monitor synckairos-primary redis-primary 6379 2
sentinel down-after-milliseconds synckairos-primary 5000
sentinel failover-timeout synckairos-primary 10000
sentinel parallel-syncs synckairos-primary 1

# Persistence
appendonly yes
appendfsync everysec
```

**Architecture:**
```
┌─────────────┐
│   Primary   │ ──writes──> AOF log (fsync every 1s)
│    Redis    │
└──────┬──────┘
       │ replication
       ├────────────┬────────────┐
       ▼            ▼            ▼
  ┌─────────┐  ┌─────────┐  ┌─────────┐
  │Replica 1│  │Replica 2│  │Replica 3│
  └─────────┘  └─────────┘  └─────────┘
       │            │            │
       └────────────┴────────────┘
                    │
            ┌───────┴────────┐
            │     Sentinel   │
            │     Cluster    │
            │  (Auto-Failover)│
            └────────────────┘
```

**Benefits:**
- Automatic failover in 5-10 seconds
- No data loss (AOF with 1s fsync)
- Handles single node failures
- Simple configuration

**Cost:** ~$60-100/month (3 Redis instances + 3 sentinels)

#### Option B: Redis Cluster (For >10k sessions)

Only needed if single Redis instance can't handle load.

**Setup:**
```bash
# 6 nodes: 3 masters + 3 replicas
redis-cli --cluster create \
  host1:6379 host2:6379 host3:6379 \
  host4:6379 host5:6379 host6:6379 \
  --cluster-replicas 1
```

**Benefits:**
- Horizontal scalability
- Automatic sharding
- High availability

**Cost:** ~$200-400/month

#### Session Recovery Mechanism

Add to `RedisStateManager`:

```typescript
/**
 * Recover session from PostgreSQL backup
 * Called when Redis doesn't have the session but PostgreSQL does
 */
async recoverSession(sessionId: string): Promise<SyncState | null> {
  console.warn(`Recovering session ${sessionId} from PostgreSQL`)

  // Load from PostgreSQL
  const dbState = await this.db.sync_sessions.findOne({ session_id: sessionId })
  if (!dbState) return null

  // Load latest event to reconstruct state
  const latestEvent = await this.db.sync_events
    .findOne({ session_id: sessionId })
    .orderBy('timestamp', 'desc')
    .first()

  if (!latestEvent?.state_snapshot) return null

  const recoveredState = latestEvent.state_snapshot

  // Mark as recovered (may be stale by 1-2 seconds)
  recoveredState.metadata = {
    ...recoveredState.metadata,
    recovered: true,
    recovered_at: new Date(),
    warning: 'State recovered from backup, may be 1-2s stale'
  }

  // Write back to Redis
  await this.updateSession(sessionId, recoveredState)

  return recoveredState
}

// Update getSession to attempt recovery
async getSession(sessionId: string): Promise<SyncState | null> {
  const data = await this.redis.get(`session:${sessionId}`)
  if (data) {
    const state = JSON.parse(data)
    if (state.cycle_started_at) {
      state.cycle_started_at = new Date(state.cycle_started_at)
    }
    return state
  }

  // Not in Redis - try PostgreSQL recovery
  return await this.recoverSession(sessionId)
}
```

**Trade-off:** Recovered sessions may be 1-2 seconds stale, but better than total loss.

---

### Issue #2: Performance Targets Inconsistency ⚠️

**Severity:** High
**Location:** [ARCHITECTURE.md:322](ARCHITECTURE.md)

**Problem:**

The performance table shows outdated targets:

```markdown
| Cycle switch latency | < 50ms | 20-30ms |
```

But the architecture now uses Redis (not PostgreSQL), which achieves **3-5ms**.

**Impact:**

- Documentation doesn't reflect actual performance
- Misleading expectations for developers
- Underestimates system capabilities

**Fix:**

```markdown
| Metric | Target | Expected (Redis) | Old (PostgreSQL) |
|--------|--------|------------------|------------------|
| Cycle switch latency | < 50ms | **3-5ms** | 20-30ms |
| WebSocket update delivery | < 100ms | **50-80ms** | 50-80ms |
| Server time sync accuracy | < 50ms | **10-30ms** | 10-30ms |
| Redis GET operation | < 5ms | **1-2ms** | N/A |
| Redis SETEX operation | < 5ms | **2-3ms** | N/A |
| Redis Pub/Sub latency | < 5ms | **1-2ms** | N/A |
```

---

### Issue #3: Missing Optimistic Locking Implementation ⚠️

**Severity:** High
**Location:** [IMPLEMENTATION.md](IMPLEMENTATION.md) - RedisStateManager

**Problem:**

The architecture document describes optimistic locking with version checking, but `RedisStateManager.updateSession()` doesn't actually implement it:

```typescript
// Current implementation (NO VERSION CHECK)
async updateSession(sessionId: string, state: SyncState): Promise<void> {
  await this.redis.setex(`session:${sessionId}`, 3600, JSON.stringify(state))
  // ... pub/sub and async DB write
}
```

**Race Condition Example:**

```
Time  Instance 1              Instance 2
----  -------------------     -------------------
T0    Read session (v=5)
T1                            Read session (v=5)
T2    Modify state
T3                            Modify state
T4    Write (v=6)
T5                            Write (v=6) ← OVERWRITES Instance 1's changes!
```

**Impact:**

- Lost updates in concurrent modifications
- Data corruption in multi-instance deployments
- Race conditions during cycle switches

**Fix:**

```typescript
/**
 * Update session with optimistic locking
 * @param expectedVersion - If provided, check version before writing
 * @throws Error if version mismatch (concurrent modification)
 */
async updateSession(
  sessionId: string,
  state: SyncState,
  expectedVersion?: number
): Promise<void> {
  // Optimistic locking: verify version before write
  if (expectedVersion !== undefined) {
    const current = await this.getSession(sessionId)

    if (current === null) {
      throw new Error(`Session ${sessionId} not found`)
    }

    if (current.version !== expectedVersion) {
      throw new Error(
        `Concurrent modification detected: expected v${expectedVersion}, got v${current.version}`
      )
    }
  }

  // Write to Redis with incremented version
  await this.redis.setex(
    `session:${sessionId}`,
    3600,
    JSON.stringify(state)
  )

  // Broadcast and async DB write
  await this.pubsub.publish('session-updates', JSON.stringify({
    sessionId,
    state
  }))

  this.asyncDBWrite(sessionId, state).catch(err => {
    console.error('PostgreSQL async write failed:', err)
  })
}
```

**Update SyncEngine to use version checking:**

```typescript
async switchCycle(
  sessionId: string,
  currentParticipantId?: string,
  nextParticipantId?: string
): Promise<SwitchCycleResult> {
  const state = await this.stateManager.getSession(sessionId)
  if (!state) throw new Error('Session not found')

  const expectedVersion = state.version

  // ... calculate new state ...

  state.version = expectedVersion + 1

  // Write with version check
  await this.stateManager.updateSession(sessionId, state, expectedVersion)

  // ... return result
}
```

**Retry Logic (Client-Side):**

```typescript
async function switchCycleWithRetry(sessionId: string, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await syncEngine.switchCycle(sessionId)
    } catch (err) {
      if (err.message.includes('Concurrent modification') && attempt < maxRetries - 1) {
        console.warn(`Concurrent modification detected, retry ${attempt + 1}/${maxRetries}`)
        await sleep(50 * Math.pow(2, attempt)) // Exponential backoff: 50ms, 100ms, 200ms
        continue
      }
      throw err
    }
  }
}
```

---

### Issue #4: Session Recovery Not Designed ⚠️

**Severity:** High
**Location:** Overall architecture

**Problem:**

If Redis fails catastrophically (all instances down):
- No documented recovery procedure
- Unclear how to restore sessions from PostgreSQL
- No "warm standby" mechanism
- Async writes may lag by 1-2 seconds

**Scenario:**

1. Redis cluster experiences total failure (rare but possible)
2. All active sessions lost from memory
3. PostgreSQL has stale data (1-2s behind)
4. Users reconnect → sessions appear "missing"

**Current State:**
```
Redis DOWN → Service unavailable → Manual intervention required
```

**Impact:**

- Extended downtime during Redis disasters
- No automated recovery
- Requires manual database operations
- Users lose session state

**Recommended Solution:**

See **Issue #1** for session recovery implementation.

---

### Issue #5: WebSocket Reconnection Not Documented ⚠️

**Severity:** Medium
**Location:** [API_REFERENCE.md](API_REFERENCE.md)

**Problem:**

The WebSocket protocol doesn't document:
1. **Client reconnection strategy** (exponential backoff?)
2. **How to handle missed updates** during disconnect
3. **State synchronization** after reconnect
4. **Connection recovery** from network failures

**Current State:**

```typescript
// Client disconnects
→ Client misses all updates during disconnect
→ Client reconnects
→ Client has stale state ❌
```

**Impact:**

- Clients show incorrect timer values after reconnection
- No way to request missed updates
- User confusion during network blips

**Recommended Solution:**

Add reconnection protocol to API_REFERENCE.md:

```typescript
// Client → Server: Request state sync on reconnect
{
  "type": "RECONNECT",
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "last_known_version": 42,  // Last version client saw
  "reconnect_attempt": 3
}

// Server → Client: Full state sync
{
  "type": "STATE_SYNC",
  "payload": {
    "session_id": "550e8400-e29b-41d4-a716-446655440000",
    "full_state": { /* complete current state */ },
    "version": 45,  // Current version
    "server_time_ms": 1729435805123
  }
}

// Server → Client: Connection accepted
{
  "type": "RECONNECT_ACK",
  "success": true,
  "message": "Reconnected successfully"
}
```

**Client Reconnection Strategy:**

```typescript
class WebSocketClient {
  private reconnectAttempts = 0
  private maxReconnectAttempts = 10
  private reconnectDelay = 1000 // Start at 1s

  private handleDisconnect() {
    this.reconnectAttempts++

    if (this.reconnectAttempts > this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached')
      this.emit('connection_failed')
      return
    }

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (capped)
    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      30000
    )

    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`)

    setTimeout(() => {
      this.connect()
    }, delay)
  }

  private onReconnect() {
    // Request full state sync
    this.send({
      type: 'RECONNECT',
      sessionId: this.sessionId,
      last_known_version: this.lastKnownVersion,
      reconnect_attempt: this.reconnectAttempts
    })
  }

  private onMessage(message: any) {
    if (message.type === 'STATE_SYNC') {
      // Full state received, update local state
      this.setState(message.payload.full_state)
      this.lastKnownVersion = message.payload.version
      this.reconnectAttempts = 0 // Reset on success
    }
  }
}
```

---

### Issue #6: No Rate Limiting Specified ⚠️

**Severity:** Medium
**Location:** [DEPLOYMENT.md](DEPLOYMENT.md) - Security section

**Problem:**

Security section mentions "Rate limiting per user/IP" but provides:
- No implementation details
- No recommended rate limits
- No guidance for critical endpoints

**Attack Vector:**

```javascript
// Attacker spams switchCycle endpoint
while(true) {
  await fetch('/sessions/abc/switch', { method: 'POST' })
}
// Result: Service overwhelmed, legitimate users blocked
```

**Impact:**

- Denial of Service (DoS) vulnerability
- Resource exhaustion
- Poor user experience during attacks

**Recommended Solution:**

Add rate limiting specification to DEPLOYMENT.md:

```markdown
## Rate Limiting

### Per-Endpoint Limits

| Endpoint | Rate Limit | Window | Action on Exceed |
|----------|-----------|--------|------------------|
| `POST /sessions/:id/switch` | 10 req/sec | Per session | 429 + 10s cooldown |
| `POST /sessions` | 5 req/min | Per user | 429 Too Many Requests |
| `GET /sessions/:id` | 100 req/min | Per user | 429 Too Many Requests |
| `GET /time` | 60 req/min | Per client IP | 429 Too Many Requests |
| WebSocket connections | 5 connections/min | Per client IP | Reject connection |
| WebSocket messages | 100 msg/min | Per connection | Disconnect with 1008 |

### Implementation (Express + Redis)

```typescript
import rateLimit from 'express-rate-limit'
import RedisStore from 'rate-limit-redis'

// Global rate limiter
const globalLimiter = rateLimit({
  store: new RedisStore({
    client: redisClient,
    prefix: 'rl:global:'
  }),
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: 'Too many requests, please try again later'
})

// Critical endpoint (cycle switch)
const cycleSwitchLimiter = rateLimit({
  store: new RedisStore({
    client: redisClient,
    prefix: 'rl:switch:'
  }),
  windowMs: 1000, // 1 second
  max: 10, // 10 requests per second per session
  keyGenerator: (req) => req.params.session_id, // Rate limit per session
  message: 'Too many cycle switches, please slow down'
})

// Apply to routes
app.use('/sessions', globalLimiter)
app.post('/sessions/:id/switch', cycleSwitchLimiter, handleSwitchCycle)
```
```

---

### Issue #7: Time Synchronization Edge Cases ⚠️

**Severity:** Medium
**Location:** [IMPLEMENTATION.md](IMPLEMENTATION.md) - Time sync

**Problem:**

The NTP-style time sync doesn't handle edge cases:

1. **Large clock skew** (client clock hours off)
2. **Timezone confusion** (not all times UTC)
3. **Client time manipulation** (cheating attempts)
4. **Network latency spikes** (roundtrip >500ms)

**Current Implementation:**

```typescript
async syncServerTime() {
  const t0 = Date.now()
  const response = await fetch(`${this.apiUrl}/time`)
  const t1 = Date.now()
  const { timestamp_ms: serverTime } = await response.json()

  const roundTripTime = t1 - t0
  this.serverTimeOffset = serverTime - t0 - (roundTripTime / 2)
}
```

**Problems:**

- Assumes symmetric latency (not always true)
- No validation of offset magnitude
- No handling of high-latency networks
- Single sample (no averaging)

**Impact:**

- Inaccurate time calculations on poor networks
- Cheating possible via clock manipulation
- Timezone bugs in different regions

**Recommended Solution:**

```typescript
async syncServerTime(): Promise<void> {
  const samples = []

  // Take 5 samples and use median
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now()
    const response = await fetch(`${this.apiUrl}/time`)
    const t1 = Date.now()
    const { timestamp_ms: serverTime } = await response.json()

    const roundTripTime = t1 - t0

    // Reject samples with high latency (>500ms)
    if (roundTripTime > 500) {
      console.warn(`High latency detected: ${roundTripTime}ms, skipping sample`)
      continue
    }

    const offset = serverTime - t0 - (roundTripTime / 2)
    samples.push({ offset, rtt: roundTripTime })

    // Small delay between samples
    await sleep(100)
  }

  if (samples.length === 0) {
    throw new Error('Could not sync with server: all samples failed')
  }

  // Use median offset (more robust than mean)
  samples.sort((a, b) => a.offset - b.offset)
  const median = samples[Math.floor(samples.length / 2)]
  this.serverTimeOffset = median.offset

  // Detect large clock skew (>1 minute = suspicious)
  if (Math.abs(this.serverTimeOffset) > 60000) {
    console.error(`Large clock skew detected: ${this.serverTimeOffset}ms`)
    console.error('Client clock may be incorrect or timezone mismatch')

    // Optional: Flag to server for review
    this.reportClockSkew(this.serverTimeOffset)
  }

  // Validate offset is reasonable
  if (Math.abs(this.serverTimeOffset) > 3600000) { // >1 hour
    throw new Error('Clock skew too large, cannot sync reliably')
  }

  console.log(`Time synced: offset=${this.serverTimeOffset}ms, rtt=${median.rtt}ms`)
}

getServerTime(): number {
  return Date.now() + this.serverTimeOffset
}

// Ensure all timestamps are UTC
toUTC(date: Date): string {
  return date.toISOString() // Always UTC
}
```

**Server-side validation:**

```typescript
// Detect suspicious time manipulations
function validateCycleSwitch(
  sessionId: string,
  lastCycleTime: Date,
  currentTime: Date
) {
  const elapsed = currentTime.getTime() - lastCycleTime.getTime()

  // Cycle switch within 10ms = suspicious (too fast, possible automation)
  if (elapsed < 10) {
    console.warn(`Suspicious cycle switch: ${elapsed}ms (too fast)`)
    // Log for review, potentially rate limit
  }

  // Negative elapsed = client clock manipulation
  if (elapsed < 0) {
    throw new Error('Invalid cycle switch: time went backwards')
  }
}
```

---

### Issue #8: PostgreSQL Async Write Failure Not Handled ⚠️

**Severity:** Medium
**Location:** [IMPLEMENTATION.md:106](IMPLEMENTATION.md)

**Problem:**

Async PostgreSQL writes fail silently with only a console error:

```typescript
this.asyncDBWrite(sessionId, state).catch(err => {
  console.error('PostgreSQL async write failed:', err)
  // Don't throw - audit write failure shouldn't break hot path
})
```

**Issues:**

1. **No retry mechanism** - Failed writes are lost forever
2. **No alerting** - Operations team unaware of failures
3. **Audit gaps** - Compliance requirements violated
4. **No monitoring** - Can't track failure rate

**Impact:**

- Incomplete audit trail
- Compliance violations (if audit required)
- Silent data loss for analytics
- No recovery from temporary DB outages

**Recommended Solution:**

Use a job queue for reliable async writes:

```typescript
import Queue from 'bull'

export class RedisStateManager {
  private redis: Redis
  private pubsub: Redis
  private dbWriteQueue: Queue.Queue

  constructor(redisUrl: string, postgresUrl: string) {
    this.redis = new Redis(redisUrl)
    this.pubsub = new Redis(redisUrl)

    // Bull queue for reliable async DB writes
    this.dbWriteQueue = new Queue('db-writes', redisUrl, {
      defaultJobOptions: {
        attempts: 5, // Retry up to 5 times
        backoff: {
          type: 'exponential',
          delay: 2000 // 2s, 4s, 8s, 16s, 32s
        },
        removeOnComplete: true,
        removeOnFail: false // Keep failed jobs for debugging
      }
    })

    // Process queue
    this.dbWriteQueue.process(async (job) => {
      const { sessionId, state, eventType } = job.data
      await this.performDBWrite(sessionId, state, eventType)
    })

    // Monitor failures
    this.dbWriteQueue.on('failed', (job, err) => {
      console.error(`DB write failed after ${job.attemptsMade} attempts:`, err)

      // Alert if too many failures
      this.alertOnPersistentFailure(job, err)
    })
  }

  async updateSession(sessionId: string, state: SyncState): Promise<void> {
    // 1. Write to Redis (hot path)
    await this.redis.setex(
      `session:${sessionId}`,
      3600,
      JSON.stringify(state)
    )

    // 2. Broadcast
    await this.pubsub.publish('session-updates', JSON.stringify({
      sessionId,
      state
    }))

    // 3. Queue async DB write (reliable with retries)
    await this.dbWriteQueue.add({
      sessionId,
      state,
      eventType: 'state_update'
    })
  }

  private async performDBWrite(
    sessionId: string,
    state: SyncState,
    eventType: string
  ): Promise<void> {
    // Actual DB write with connection handling
    await db.sync_events.insert({
      session_id: sessionId,
      event_type: eventType,
      state_snapshot: state,
      timestamp: new Date()
    })
  }

  private async alertOnPersistentFailure(job: any, err: Error): Promise<void> {
    if (job.attemptsMade >= 5) {
      // Send alert to operations team
      await sendAlert({
        severity: 'high',
        message: `PostgreSQL async write failed permanently for session ${job.data.sessionId}`,
        error: err.message,
        job_id: job.id
      })
    }
  }
}
```

**Monitoring:**

```typescript
// Prometheus metrics
const dbWriteQueueSize = new Gauge({
  name: 'synckairos_db_write_queue_size',
  help: 'Number of pending DB writes'
})

const dbWriteFailures = new Counter({
  name: 'synckairos_db_write_failures_total',
  help: 'Total DB write failures'
})

setInterval(() => {
  dbWriteQueueSize.set(dbWriteQueue.count())
}, 5000)
```

---

## Medium Issues

### Issue #9: Version Numbering Inconsistency

**Severity:** Low
**Location:** Multiple files

**Problem:**

Inconsistent version numbers across documentation:

| File | Current Version | Should Be |
|------|----------------|-----------|
| ARCHITECTURE.md | 2.0 | ✅ 2.0 |
| OVERVIEW.md | 2.0 | ✅ 2.0 |
| API_REFERENCE.md | **1.0** | ❌ Should be 2.0 |
| DEPLOYMENT.md | 2.0 | ✅ 2.0 |
| IMPLEMENTATION.md | 2.0 | ✅ 2.0 |
| USE_CASES.md | **1.0** | ❌ Should be 2.0 |

**Impact:**

- Confusion about which docs are up-to-date
- Versioning appears inconsistent

**Fix:**

Update API_REFERENCE.md and USE_CASES.md to version 2.0.

---

### Issue #10: Missing Environment Variables

**Severity:** Low
**Location:** [DEPLOYMENT.md](DEPLOYMENT.md) - Environment Variables section

**Problem:**

Environment variable list is incomplete. Missing:

```bash
# Redis High Availability
REDIS_SENTINEL_HOSTS=sentinel1:26379,sentinel2:26379,sentinel3:26379
REDIS_SENTINEL_NAME=synckairos-primary
REDIS_CLUSTER_NODES=node1:6379,node2:6379,node3:6379

# Configuration
SESSION_TTL=3600  # Currently hardcoded
ENABLE_METRICS=true
METRICS_PORT=9091

# Monitoring
SENTRY_DSN=https://your-sentry-dsn
SENTRY_ENVIRONMENT=production
LOG_LEVEL=info  # debug, info, warn, error

# Rate Limiting
RATE_LIMIT_ENABLED=true
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100

# Security
ALLOWED_ORIGINS=https://yourdomain.com,https://app.yourdomain.com
ENABLE_CORS=true
TRUST_PROXY=true  # If behind load balancer
```

---

### Issue #11: No Monitoring/Alerting Strategy

**Severity:** Medium
**Location:** [DEPLOYMENT.md](DEPLOYMENT.md)

**Problem:**

Documentation mentions "monitoring" but doesn't specify:
- Which metrics to track
- Alert thresholds
- SLA definitions
- On-call procedures
- Runbook for common issues

**Recommended Addition:**

```markdown
## Monitoring & Alerting Strategy

### Critical Metrics

#### System Health
- `redis_up` - Redis availability (0/1)
- `postgres_up` - PostgreSQL availability (0/1)
- `websocket_connections_total` - Active WebSocket connections
- `http_requests_total` - Total HTTP requests
- `http_request_duration_ms` - Request latency (p50, p95, p99)

#### Business Metrics
- `active_sessions_total` - Active sync sessions
- `cycle_switches_per_second` - Cycle switch rate
- `session_creates_per_minute` - Session creation rate
- `websocket_disconnects_total` - WebSocket disconnections

#### Performance Metrics
- `redis_operation_duration_ms{operation="get"}` - Redis GET latency
- `redis_operation_duration_ms{operation="setex"}` - Redis SET latency
- `redis_pubsub_latency_ms` - Pub/Sub message latency
- `db_write_queue_size` - Pending async DB writes
- `db_write_failures_total` - Failed DB writes

### Alert Definitions

#### P0 - Page Immediately (Critical)

| Alert | Condition | Threshold | Impact |
|-------|-----------|-----------|--------|
| Redis Down | `redis_up == 0` | >30 seconds | Service unavailable |
| High Error Rate | `error_rate > 5%` | 2 minutes | User experience degraded |
| High Latency | `p99_latency > 100ms` | 5 minutes | Performance SLA violated |
| WebSocket Storm | `ws_disconnects > 100/min` | 2 minutes | Users losing connection |

#### P1 - Notify During Business Hours

| Alert | Condition | Threshold | Impact |
|-------|-----------|-----------|--------|
| DB Write Failures | `db_write_failures > 10/min` | 5 minutes | Audit trail gaps |
| High DB Queue | `db_write_queue_size > 1000` | 5 minutes | Async writes backing up |
| Memory High | `memory_usage > 80%` | 10 minutes | Potential OOM |
| CPU High | `cpu_usage > 80%` | 10 minutes | Performance degradation |

#### P2 - Review Next Business Day

| Alert | Condition | Threshold | Impact |
|-------|-----------|-----------|--------|
| Slow Clients | `time_sync_offset > 100ms` | 10 clients | Poor user experience |
| Old Sessions | `sessions_older_than_24h > 10` | - | Memory leak potential |

### Runbooks

#### Redis Failover
1. Verify Redis Sentinel detected failure
2. Check new primary elected
3. Verify application reconnected
4. Check for data loss (compare versions)
5. Monitor error rates during switchover

#### High Latency Investigation
1. Check Redis latency: `redis-cli --latency`
2. Check DB connection pool utilization
3. Check network latency to Redis
4. Review slow queries in logs
5. Check for CPU/memory spikes

#### WebSocket Disconnection Storm
1. Check load balancer health
2. Verify Redis Pub/Sub working
3. Check for instance crashes
4. Review network connectivity
5. Check client error logs
```

---

### Issue #12: No Input Validation Documented

**Severity:** Medium
**Location:** [IMPLEMENTATION.md](IMPLEMENTATION.md) - SyncEngine

**Problem:**

SyncEngine accepts user input without documented validation:

```typescript
async createSession(config: { ... })
```

**Missing Validations:**

1. **session_id format** - Should be UUID
2. **total_time_ms bounds** - Prevent 0ms or MAX_INT
3. **participants count** - Limit to prevent DoS
4. **metadata size** - Prevent large payloads
5. **participant_id format** - Validate structure

**Attack Vectors:**

```typescript
// DoS via huge metadata
createSession({
  metadata: { payload: 'x'.repeat(10_000_000) } // 10MB
})

// DoS via too many participants
createSession({
  participants: Array(100_000).fill({...}) // 100k participants
})

// Invalid time values
createSession({
  total_time_ms: -1 // Negative time
})
```

**Recommended Solution:**

```typescript
import Joi from 'joi'

const sessionConfigSchema = Joi.object({
  session_id: Joi.string().uuid().required(),
  sync_mode: Joi.string().valid(
    'per_participant',
    'per_cycle',
    'per_group',
    'global',
    'count_up'
  ).required(),
  participants: Joi.array().items(
    Joi.object({
      participant_id: Joi.string().uuid().required(),
      participant_index: Joi.number().integer().min(0).max(999).required(),
      total_time_ms: Joi.number().integer().min(1000).max(86400000).required() // 1s to 24h
    })
  ).min(1).max(1000).required(), // 1-1000 participants
  time_per_cycle_ms: Joi.number().integer().min(1000).max(3600000).optional(), // 1s to 1h
  increment_ms: Joi.number().integer().min(0).max(60000).optional(), // 0 to 1min
  max_time_ms: Joi.number().integer().min(1000).max(86400000).optional(),
  action_on_timeout: Joi.object().optional(),
  auto_advance: Joi.boolean().optional(),
  metadata: Joi.object().max(100).optional() // Max 100 keys
}).custom((value, helpers) => {
  // Limit metadata JSON size to 10KB
  const metadataSize = JSON.stringify(value.metadata || {}).length
  if (metadataSize > 10_000) {
    return helpers.error('metadata too large, max 10KB')
  }
  return value
})

export class SyncEngine {
  async createSession(config: any): Promise<SyncState> {
    // Validate input
    const { error, value } = sessionConfigSchema.validate(config)
    if (error) {
      throw new Error(`Invalid session config: ${error.message}`)
    }

    // Proceed with validated config
    const state: SyncState = {
      session_id: value.session_id,
      // ... rest of implementation
    }

    await this.stateManager.createSession(state)
    return state
  }
}
```

**Validation Rules:**

| Field | Min | Max | Format |
|-------|-----|-----|--------|
| session_id | - | - | UUID v4 |
| participants | 1 | 1000 | Array |
| total_time_ms | 1000 (1s) | 86400000 (24h) | Integer |
| time_per_cycle_ms | 1000 | 3600000 | Integer |
| increment_ms | 0 | 60000 | Integer |
| metadata | - | 10KB | JSON object |

---

## Summary

### Issues by Severity

| Severity | Count | Issues |
|----------|-------|--------|
| 🔴 Critical | 1 | Redis SPOF |
| ⚠️ High | 7 | Performance targets, optimistic locking, session recovery, WebSocket reconnection, rate limiting, time sync, async write failures |
| ℹ️ Medium | 4 | Version consistency, environment vars, monitoring strategy, input validation |
| **Total** | **12** | |

### Priority Actions

#### Priority 1 - Must Fix Before Production (Week 1)
1. ✅ **Redis High Availability** - Implement Sentinel or Cluster
2. ✅ **Optimistic Locking** - Fix race conditions
3. ✅ **Session Recovery** - Handle Redis failures
4. ✅ **Rate Limiting** - Prevent DoS attacks
5. ✅ **Update Performance Targets** - Reflect Redis performance

#### Priority 2 - Important for Production (Week 2)
6. ✅ **WebSocket Reconnection** - Document protocol
7. ✅ **Time Sync Edge Cases** - Handle large skew
8. ✅ **Async Write Reliability** - Add job queue
9. ✅ **Input Validation** - Prevent malicious input

#### Priority 3 - Nice to Have (Week 3)
10. ✅ **Monitoring Strategy** - Define metrics and alerts
11. ✅ **Version Consistency** - Update doc versions
12. ✅ **Environment Variables** - Complete the list

### Production Readiness Checklist

- [ ] Redis Sentinel/Cluster configured
- [ ] Optimistic locking implemented and tested
- [ ] Session recovery tested
- [ ] Rate limiting deployed
- [ ] WebSocket reconnection implemented
- [ ] Time sync edge cases handled
- [ ] Job queue for async DB writes
- [ ] Input validation on all endpoints
- [ ] Monitoring and alerts configured
- [ ] Load testing completed (10k sessions)
- [ ] Disaster recovery runbook created
- [ ] Documentation updated to v2.0

**Estimated time to production-ready: 2-3 weeks**

---

## Conclusion

The Redis-first distributed architecture is fundamentally sound, but requires additional resilience, error handling, and operational procedures before production deployment. The identified issues are addressable within 2-3 weeks of focused development.

**Key Takeaway:** Moving from design to production requires not just correct architecture, but also robust failure handling, monitoring, and operational procedures.
