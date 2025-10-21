# SyncKairos Testing Requirements & Patterns

**Purpose:** Reference for test generation and validation
**Version:** v2.0
**Last Updated:** 2025-10-21

---

## Testing Strategy Overview

### Test Pyramid

```
        /\
       /  \  E2E Tests (k6 Load Tests)
      /____\
     /      \  Integration Tests (API, WebSocket)
    /________\
   /          \  Unit Tests (RedisStateManager, SyncEngine)
  /______________\
```

**Target Coverage:**
- Unit Tests: >80%
- Integration Tests: All critical paths
- Load Tests: 10,000+ concurrent sessions

---

## Test Stack

### Unit Tests: Vitest
- **Framework:** Vitest (Jest-compatible, faster)
- **Location:** `tests/unit/`
- **Run:** `pnpm test`
- **Coverage:** `pnpm test:coverage`

### Integration Tests: Supertest
- **Framework:** Supertest (HTTP assertions)
- **Location:** `tests/integration/`
- **Run:** `pnpm test:integration`

### Load Tests: k6
- **Framework:** k6 (Grafana Labs)
- **Location:** `tests/load/`
- **Run:** `k6 run tests/load/scenario.js`

---

## Unit Testing Patterns

### Pattern 1: RedisStateManager Tests

**What to test:**
- CRUD operations (create, read, update, delete)
- Redis operations (GET, SET, DEL)
- TTL configuration (1 hour)
- JSON serialization/deserialization
- Pub/Sub broadcasting
- Optimistic locking (version checks)
- Error handling
- Connection management

**Example Test Structure:**
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { RedisStateManager } from '@/state/RedisStateManager'
import { Redis } from 'ioredis'

describe('RedisStateManager', () => {
  let redis: Redis
  let stateManager: RedisStateManager

  beforeEach(() => {
    redis = new Redis(process.env.REDIS_URL)
    stateManager = new RedisStateManager(redis)
  })

  afterEach(async () => {
    await redis.flushdb() // Clean up after each test
    await redis.quit()
  })

  describe('getSession', () => {
    it('should return session if exists', async () => {
      const sessionId = 'test-session-1'
      const state = { session_id: sessionId, version: 1, /* ... */ }

      await redis.setex(`session:${sessionId}`, 3600, JSON.stringify(state))

      const result = await stateManager.getSession(sessionId)

      expect(result).toEqual(state)
    })

    it('should return null if session does not exist', async () => {
      const result = await stateManager.getSession('nonexistent')
      expect(result).toBeNull()
    })
  })

  describe('updateSession', () => {
    it('should update session with TTL', async () => {
      const sessionId = 'test-session-1'
      const state = { session_id: sessionId, version: 1 }

      await stateManager.updateSession(sessionId, state)

      const ttl = await redis.ttl(`session:${sessionId}`)
      expect(ttl).toBeGreaterThan(3500) // ~1 hour
      expect(ttl).toBeLessThanOrEqual(3600)
    })

    it('should throw error on version mismatch', async () => {
      const sessionId = 'test-session-1'
      const state = { session_id: sessionId, version: 2 }

      await stateManager.updateSession(sessionId, { ...state, version: 1 })

      await expect(
        stateManager.updateSession(sessionId, state, 1)
      ).rejects.toThrow('Concurrent modification detected')
    })

    it('should broadcast update via Pub/Sub', async () => {
      const sessionId = 'test-session-1'
      const state = { session_id: sessionId, version: 1 }

      const messages: any[] = []
      stateManager.subscribeToUpdates((id, s) => messages.push({ id, s }))

      await stateManager.updateSession(sessionId, state)

      // Wait for Pub/Sub
      await new Promise(resolve => setTimeout(resolve, 100))

      expect(messages).toHaveLength(1)
      expect(messages[0].id).toBe(sessionId)
    })
  })
})
```

### Pattern 2: SyncEngine Tests

**What to test:**
- Session lifecycle (create, start, pause, resume, complete)
- switchCycle() logic (hot path)
- Time calculations
- Participant rotation
- Increment time handling
- Expiration detection
- Version increment
- All sync modes
- Edge cases (expired participant, invalid state)

**Example Test Structure:**
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SyncEngine } from '@/engine/SyncEngine'
import { RedisStateManager } from '@/state/RedisStateManager'

describe('SyncEngine', () => {
  let stateManager: RedisStateManager
  let syncEngine: SyncEngine

  beforeEach(() => {
    stateManager = new RedisStateManager(process.env.REDIS_URL)
    syncEngine = new SyncEngine(stateManager)
  })

  describe('createSession', () => {
    it('should create session with pending status', async () => {
      const config = {
        session_id: 'test-1',
        sync_mode: 'per_participant',
        participants: [
          { participant_id: 'p1', total_time_ms: 60000, participant_index: 0 },
          { participant_id: 'p2', total_time_ms: 60000, participant_index: 1 }
        ]
      }

      const result = await syncEngine.createSession(config)

      expect(result.status).toBe('pending')
      expect(result.participants).toHaveLength(2)
      expect(result.version).toBe(1)
    })
  })

  describe('startSession', () => {
    it('should activate first participant', async () => {
      const session = await syncEngine.createSession({
        session_id: 'test-1',
        sync_mode: 'per_participant',
        participants: [
          { participant_id: 'p1', total_time_ms: 60000, participant_index: 0 }
        ]
      })

      const result = await syncEngine.startSession(session.session_id)

      expect(result.status).toBe('running')
      expect(result.active_participant_id).toBe('p1')
      expect(result.cycle_started_at).toBeDefined()
      expect(result.participants[0].is_active).toBe(true)
    })

    it('should throw error if already started', async () => {
      const session = await syncEngine.createSession({
        session_id: 'test-1',
        sync_mode: 'per_participant',
        participants: [
          { participant_id: 'p1', total_time_ms: 60000, participant_index: 0 }
        ]
      })

      await syncEngine.startSession(session.session_id)

      await expect(
        syncEngine.startSession(session.session_id)
      ).rejects.toThrow('Session already started')
    })
  })

  describe('switchCycle - HOT PATH', () => {
    it('should switch to next participant', async () => {
      // Setup session with 2 participants
      const session = await syncEngine.createSession({
        session_id: 'test-1',
        sync_mode: 'per_participant',
        participants: [
          { participant_id: 'p1', total_time_ms: 60000, participant_index: 0 },
          { participant_id: 'p2', total_time_ms: 60000, participant_index: 1 }
        ]
      })
      await syncEngine.startSession(session.session_id)

      // Wait 100ms to simulate time passage
      await new Promise(resolve => setTimeout(resolve, 100))

      const result = await syncEngine.switchCycle(session.session_id)

      expect(result.active_participant_id).toBe('p2')
      expect(result.participants[0].is_active).toBe(false)
      expect(result.participants[1].is_active).toBe(true)
      expect(result.participants[0].time_used_ms).toBeGreaterThan(90)
    })

    it('should calculate time used correctly', async () => {
      const session = await syncEngine.createSession({
        session_id: 'test-1',
        sync_mode: 'per_participant',
        participants: [
          { participant_id: 'p1', total_time_ms: 60000, participant_index: 0 },
          { participant_id: 'p2', total_time_ms: 60000, participant_index: 1 }
        ]
      })
      await syncEngine.startSession(session.session_id)

      await new Promise(resolve => setTimeout(resolve, 500))

      const result = await syncEngine.switchCycle(session.session_id)

      const p1 = result.participants[0]
      expect(p1.time_used_ms).toBeGreaterThanOrEqual(400)
      expect(p1.time_used_ms).toBeLessThan(600)
      expect(p1.total_time_ms).toBe(60000 - p1.time_used_ms)
    })

    it('should detect expired participant', async () => {
      const session = await syncEngine.createSession({
        session_id: 'test-1',
        sync_mode: 'per_participant',
        participants: [
          { participant_id: 'p1', total_time_ms: 100, participant_index: 0 }, // 100ms
          { participant_id: 'p2', total_time_ms: 60000, participant_index: 1 }
        ]
      })
      await syncEngine.startSession(session.session_id)

      await new Promise(resolve => setTimeout(resolve, 200))

      const result = await syncEngine.switchCycle(session.session_id)

      expect(result.participants[0].has_expired).toBe(true)
      expect(result.participants[0].total_time_ms).toBe(0)
      expect(result.expired_participant_id).toBe('p1')
    })

    it('should add increment time', async () => {
      const session = await syncEngine.createSession({
        session_id: 'test-1',
        sync_mode: 'per_participant',
        increment_ms: 5000, // +5 seconds per turn
        participants: [
          { participant_id: 'p1', total_time_ms: 60000, participant_index: 0 },
          { participant_id: 'p2', total_time_ms: 60000, participant_index: 1 }
        ]
      })
      await syncEngine.startSession(session.session_id)

      await new Promise(resolve => setTimeout(resolve, 100))

      const result = await syncEngine.switchCycle(session.session_id)

      const p1 = result.participants[0]
      const expectedTime = 60000 - p1.time_used_ms + 5000
      expect(p1.total_time_ms).toBe(expectedTime)
    })

    it('should use optimistic locking', async () => {
      const session = await syncEngine.createSession({
        session_id: 'test-1',
        sync_mode: 'per_participant',
        participants: [
          { participant_id: 'p1', total_time_ms: 60000, participant_index: 0 },
          { participant_id: 'p2', total_time_ms: 60000, participant_index: 1 }
        ]
      })
      await syncEngine.startSession(session.session_id)

      // Simulate concurrent update
      const state = await stateManager.getSession(session.session_id)
      state.version = 999
      await stateManager.updateSession(session.session_id, state)

      await expect(
        syncEngine.switchCycle(session.session_id)
      ).rejects.toThrow('Concurrent modification')
    })

    it('should complete in <50ms', async () => {
      const session = await syncEngine.createSession({
        session_id: 'test-1',
        sync_mode: 'per_participant',
        participants: [
          { participant_id: 'p1', total_time_ms: 60000, participant_index: 0 },
          { participant_id: 'p2', total_time_ms: 60000, participant_index: 1 }
        ]
      })
      await syncEngine.startSession(session.session_id)

      const start = Date.now()
      await syncEngine.switchCycle(session.session_id)
      const duration = Date.now() - start

      expect(duration).toBeLessThan(50) // Performance target
    })
  })
})
```

---

## Integration Testing Patterns

### Pattern 3: REST API Tests

**What to test:**
- All 8 endpoints
- Request validation (400 errors)
- Error responses (404, 409, 500)
- Rate limiting (429)
- Full session lifecycle
- Authentication (if enabled)

**Example Test Structure:**
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { app } from '@/api/app'
import { Redis } from 'ioredis'

describe('POST /v1/sessions/:id/switch', () => {
  let redis: Redis

  beforeEach(() => {
    redis = new Redis(process.env.REDIS_URL)
  })

  afterEach(async () => {
    await redis.flushdb()
    await redis.quit()
  })

  it('should switch cycle successfully', async () => {
    // Create session first
    const createResponse = await request(app)
      .post('/v1/sessions')
      .send({
        session_id: 'test-1',
        sync_mode: 'per_participant',
        participants: [
          { participant_id: 'p1', total_time_ms: 60000, participant_index: 0 },
          { participant_id: 'p2', total_time_ms: 60000, participant_index: 1 }
        ]
      })
      .expect(201)

    // Start session
    await request(app)
      .post('/v1/sessions/test-1/start')
      .expect(200)

    // Switch cycle
    const response = await request(app)
      .post('/v1/sessions/test-1/switch')
      .expect(200)

    expect(response.body.active_participant_id).toBe('p2')
    expect(response.body.status).toBe('running')
  })

  it('should return 404 for non-existent session', async () => {
    await request(app)
      .post('/v1/sessions/nonexistent/switch')
      .expect(404)
  })

  it('should return 409 for invalid state transition', async () => {
    // Create but don't start
    await request(app)
      .post('/v1/sessions')
      .send({
        session_id: 'test-1',
        sync_mode: 'per_participant',
        participants: [
          { participant_id: 'p1', total_time_ms: 60000, participant_index: 0 }
        ]
      })

    await request(app)
      .post('/v1/sessions/test-1/switch')
      .expect(409) // Session not running
  })

  it('should enforce rate limiting', async () => {
    // Setup session
    await request(app).post('/v1/sessions').send({/* ... */}).expect(201)
    await request(app).post('/v1/sessions/test-1/start').expect(200)

    // Make requests rapidly
    const requests = Array.from({ length: 20 }, () =>
      request(app).post('/v1/sessions/test-1/switch')
    )

    const responses = await Promise.all(requests)
    const rateLimited = responses.filter(r => r.status === 429)

    expect(rateLimited.length).toBeGreaterThan(0)
  })
})
```

### Pattern 4: WebSocket Tests

**What to test:**
- Connection establishment
- Message broadcasting
- Cross-instance broadcasting (Redis Pub/Sub)
- Heartbeat (PING/PONG)
- Disconnection handling

**Example Test Structure:**
```typescript
import { describe, it, expect } from 'vitest'
import WebSocket from 'ws'

describe('WebSocket Server', () => {
  it('should broadcast state updates to all clients', async () => {
    const sessionId = 'test-1'

    // Create 2 clients
    const client1 = new WebSocket(`ws://localhost:3000?sessionId=${sessionId}`)
    const client2 = new WebSocket(`ws://localhost:3000?sessionId=${sessionId}`)

    await Promise.all([
      new Promise(resolve => client1.on('open', resolve)),
      new Promise(resolve => client2.on('open', resolve))
    ])

    const messages1: any[] = []
    const messages2: any[] = []

    client1.on('message', data => messages1.push(JSON.parse(data.toString())))
    client2.on('message', data => messages2.push(JSON.parse(data.toString())))

    // Trigger state update via API
    await request(app).post(`/v1/sessions/${sessionId}/switch`)

    await new Promise(resolve => setTimeout(resolve, 200))

    expect(messages1.length).toBeGreaterThan(0)
    expect(messages2.length).toBeGreaterThan(0)
    expect(messages1[0].type).toBe('STATE_UPDATE')
  })
})
```

---

## Load Testing Patterns (k6)

### Pattern 5: Concurrent Sessions

**What to test:**
- 1,000 concurrent sessions
- 10,000 concurrent sessions
- Latency under load (p50, p95, p99)
- Error rates
- Memory usage

**Example k6 Script:**
```javascript
// tests/load/concurrent-sessions.js
import http from 'k6/http'
import { check, sleep } from 'k6'
import { Rate, Trend } from 'k6/metrics'

// Custom metrics
const errorRate = new Rate('errors')
const switchLatency = new Trend('switch_latency')

export const options = {
  stages: [
    { duration: '2m', target: 1000 },   // Ramp up to 1k
    { duration: '5m', target: 1000 },   // Stay at 1k
    { duration: '2m', target: 10000 },  // Ramp up to 10k
    { duration: '5m', target: 10000 },  // Stay at 10k
    { duration: '2m', target: 0 },      // Ramp down
  ],
  thresholds: {
    'http_req_duration': ['p95<50'],     // 95% under 50ms
    'errors': ['rate<0.01'],              // <1% errors
    'switch_latency': ['p99<100'],        // 99% under 100ms
  },
}

export default function () {
  const sessionId = `session-${__VU}`
  const baseURL = 'http://localhost:3000/v1'

  // Create session
  let res = http.post(`${baseURL}/sessions`, JSON.stringify({
    session_id: sessionId,
    sync_mode: 'per_participant',
    participants: [
      { participant_id: 'p1', total_time_ms: 600000, participant_index: 0 },
      { participant_id: 'p2', total_time_ms: 600000, participant_index: 1 },
    ]
  }), {
    headers: { 'Content-Type': 'application/json' },
  })

  check(res, {
    'session created': (r) => r.status === 201,
  }) || errorRate.add(1)

  // Start session
  res = http.post(`${baseURL}/sessions/${sessionId}/start`)
  check(res, {
    'session started': (r) => r.status === 200,
  }) || errorRate.add(1)

  // Switch cycle multiple times
  for (let i = 0; i < 10; i++) {
    const start = Date.now()

    res = http.post(`${baseURL}/sessions/${sessionId}/switch`)

    const duration = Date.now() - start
    switchLatency.add(duration)

    check(res, {
      'switch successful': (r) => r.status === 200,
      'latency <50ms': () => duration < 50,
    }) || errorRate.add(1)

    sleep(0.5) // Wait 500ms between switches
  }

  // Complete session
  http.post(`${baseURL}/sessions/${sessionId}/complete`)
}
```

### Pattern 6: WebSocket Stress Test

**Example k6 Script:**
```javascript
// tests/load/websocket-stress.js
import ws from 'k6/ws'
import { check } from 'k6'

export const options = {
  vus: 1000, // 1000 WebSocket connections
  duration: '5m',
}

export default function () {
  const sessionId = 'shared-session'
  const url = `ws://localhost:3000?sessionId=${sessionId}`

  const res = ws.connect(url, {}, function (socket) {
    socket.on('open', () => console.log('connected'))

    socket.on('message', (data) => {
      const msg = JSON.parse(data)
      check(msg, {
        'message received': (m) => m.type === 'STATE_UPDATE',
      })
    })

    socket.on('close', () => console.log('disconnected'))

    // Keep connection open
    socket.setTimeout(() => {
      socket.close()
    }, 300000) // 5 minutes
  })

  check(res, { 'connected': (r) => r && r.status === 101 })
}
```

---

## Test Coverage Requirements

### Unit Tests (>80% coverage)

**Must cover:**
- All public methods
- Error paths
- Edge cases
- Concurrency scenarios

**Coverage by component:**
- RedisStateManager: >90%
- SyncEngine: >85%
- DBWriteQueue: >80%
- API routes: >75%

### Integration Tests (All critical paths)

**Must cover:**
- Full session lifecycle (create → start → switch → complete)
- All API endpoints
- WebSocket real-time updates
- Cross-instance broadcasting

### Load Tests (Performance validation)

**Must validate:**
- 10,000+ concurrent sessions supported
- switchCycle() p95 <50ms
- WebSocket delivery p95 <100ms
- Error rate <1%
- No memory leaks

---

## Edge Cases to Test

### SyncEngine Edge Cases
- [ ] Participant expires during cycle
- [ ] All participants expired
- [ ] Switching when session paused
- [ ] Concurrent switchCycle calls (optimistic locking)
- [ ] Very short time_per_cycle (100ms)
- [ ] Very large participant count (1000+)
- [ ] Zero time remaining
- [ ] Negative time (shouldn't happen, but test)

### RedisStateManager Edge Cases
- [ ] Redis connection lost
- [ ] Invalid JSON in Redis
- [ ] Session expired (TTL)
- [ ] Concurrent updates (version mismatch)
- [ ] Very large session state (>1MB)
- [ ] Pub/Sub message loss

### API Edge Cases
- [ ] Invalid session_id format
- [ ] Missing required fields
- [ ] Invalid sync_mode
- [ ] Empty participants array
- [ ] Negative time values
- [ ] Extremely long request body

---

## Performance Benchmarks

### Target Latencies

| Operation | Target | p50 | p95 | p99 |
|-----------|--------|-----|-----|-----|
| Redis GET | <5ms | ~1ms | ~2ms | ~5ms |
| Redis SET | <5ms | ~2ms | ~3ms | ~5ms |
| switchCycle() | <50ms | ~3ms | ~5ms | ~10ms |
| WebSocket delivery | <100ms | ~50ms | ~80ms | ~100ms |
| API endpoint | <100ms | ~10ms | ~30ms | ~50ms |

### Resource Limits

| Metric | Target | Max Acceptable |
|--------|--------|----------------|
| Memory per session | ~2KB | ~5KB |
| Concurrent sessions | 10,000 | 50,000 |
| WebSocket connections | 1,000/instance | 5,000/instance |
| Redis memory | <1GB | <2GB |
| CPU usage | <50% | <80% |

---

## Test Organization

```
tests/
├── unit/
│   ├── RedisStateManager.test.ts
│   ├── SyncEngine.test.ts
│   ├── DBWriteQueue.test.ts
│   └── utils.test.ts
├── integration/
│   ├── api/
│   │   ├── sessions.test.ts
│   │   ├── time.test.ts
│   │   └── health.test.ts
│   ├── websocket.test.ts
│   └── e2e.test.ts
└── load/
    ├── scenarios/
    │   ├── concurrent-sessions.js
    │   ├── high-frequency-switching.js
    │   └── websocket-stress.js
    └── utils/
        └── helpers.js
```

---

## References

- [Phase 3 Testing Tasks](../../../docs/project-tracking/phases/PHASE_3.md)
- [Architecture Document](../../../docs/design/ARCHITECTURE.md)
- [Implementation Guide](../../../docs/design/IMPLEMENTATION.md)
