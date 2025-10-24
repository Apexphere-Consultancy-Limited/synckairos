---
name: tester
description: Test generation and validation skill for SyncKairos v2.0 development. Use this skill when creating unit tests, integration tests, or load tests for SyncKairos components. Ensures tests follow the testing requirements, achieve >80% coverage, and validate performance targets (<50ms switchCycle, <100ms WebSocket, 10k+ concurrent sessions).
---

# SyncKairos Tester

## Overview

This skill guides test creation for SyncKairos v2.0, ensuring comprehensive coverage across unit tests (Vitest), integration tests (Supertest), and load tests (k6). It enforces testing requirements, performance targets, and edge case coverage.

⚠️ **CRITICAL**: All tests must use **Zod schemas** ([src/types/api-contracts.ts](../../../src/types/api-contracts.ts)) for validation. Never create manual validation logic - import and use the schema validators. Contract tests ([tests/contract/websocket-schemas.test.ts](../../../tests/contract/websocket-schemas.test.ts)) validate schemas match implementation.

## Core Capabilities

### 1. Unit Test Generation (Vitest)

Generate unit tests for core components with >80% coverage target.

**When to use:**
- Testing RedisStateManager (CRUD, Pub/Sub, optimistic locking)
- Testing SyncEngine (lifecycle, switchCycle, time calculations)
- Testing DBWriteQueue (BullMQ job processing)
- Testing utility functions and validation logic

**Workflow:**
1. Identify component and methods to test
2. Review testing_requirements.md for patterns
3. Generate test cases covering:
   - Happy path
   - Edge cases
   - Error conditions
   - Concurrent operations
4. Validate >80% coverage for the component
5. Ensure tests use proper mocking (Redis, PostgreSQL)

**Example Output:**
```typescript
// tests/unit/RedisStateManager.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { RedisStateManager } from '@/state/RedisStateManager'
import Redis from 'ioredis'

describe('RedisStateManager', () => {
  let stateManager: RedisStateManager
  let redisClient: Redis

  beforeEach(async () => {
    redisClient = new Redis()
    stateManager = new RedisStateManager(redisClient)
    await redisClient.flushall()
  })

  describe('updateSession', () => {
    it('should throw error on version mismatch (optimistic locking)', async () => {
      const sessionId = 'test-session-1'
      const initialState = {
        session_id: sessionId,
        version: 1,
        status: 'running',
        // ... other fields
      }

      await stateManager.createSession(initialState)

      // Simulate concurrent update
      await stateManager.updateSession(sessionId, { ...initialState, version: 2 })

      // This should fail due to version mismatch
      await expect(
        stateManager.updateSession(sessionId, initialState, 1)
      ).rejects.toThrow('Concurrent modification detected')
    })
  })
})
```

---

### 2. Integration Test Generation (Supertest)

Generate integration tests for REST API endpoints and WebSocket server.

**When to use:**
- Testing REST API endpoints (all 8 endpoints)
- Testing WebSocket connections and broadcasting
- Testing cross-instance communication via Redis Pub/Sub
- Testing error responses and rate limiting

**Workflow:**
1. Identify API endpoints or WebSocket scenarios to test
2. Review testing_requirements.md for integration patterns
3. Generate test cases covering:
   - Full request/response cycle
   - Authentication and authorization
   - Error responses (400, 404, 409, 429)
   - Rate limiting behavior
   - Cross-instance broadcasting
4. Ensure tests use test Redis/PostgreSQL instances
5. Validate performance targets (<50ms for switchCycle)

**Example Output:**
```typescript
// tests/integration/api.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app } from '@/api/app'

describe('Session API', () => {
  describe('POST /v1/sessions/:id/switch (HOT PATH)', () => {
    it('should switch cycle in <50ms', async () => {
      // Create and start session
      const createRes = await request(app)
        .post('/v1/sessions')
        .send({
          session_id: 'perf-test-1',
          sync_mode: 'per_participant',
          participants: [
            { participant_id: 'p1', total_time_ms: 300000 },
            { participant_id: 'p2', total_time_ms: 300000 }
          ]
        })

      await request(app).post(`/v1/sessions/${createRes.body.session_id}/start`)

      // Measure switchCycle latency
      const startTime = Date.now()
      const res = await request(app)
        .post(`/v1/sessions/${createRes.body.session_id}/switch`)
        .send({})
      const latency = Date.now() - startTime

      expect(res.status).toBe(200)
      expect(latency).toBeLessThan(50) // Performance target
      expect(res.body.new_active_participant_id).toBe('p2')
    })
  })
})
```

---

### 3. Load Test Generation (k6)

Generate k6 load test scripts for performance validation.

**When to use:**
- Testing 1,000 to 10,000+ concurrent sessions
- Testing high-frequency cycle switching
- Testing WebSocket connection scaling
- Validating performance targets under load

**Workflow:**
1. Identify load testing scenario (concurrent sessions, switching frequency, WebSocket stress)
2. Review testing_requirements.md for k6 patterns
3. Generate k6 script with:
   - Ramp-up stages (1k → 10k)
   - Virtual users (VUs)
   - Performance thresholds (p95<50ms, errors<1%)
   - Realistic test data
4. Include setup/teardown for test sessions
5. Document expected results and success criteria

**Example Output:**
```javascript
// tests/load/scenarios/concurrent-sessions.js
import http from 'k6/http'
import { check, sleep } from 'k6'

export const options = {
  stages: [
    { duration: '2m', target: 1000 },   // Ramp up to 1k
    { duration: '5m', target: 1000 },   // Stay at 1k
    { duration: '2m', target: 10000 },  // Ramp up to 10k
    { duration: '5m', target: 10000 },  // Stay at 10k
    { duration: '2m', target: 0 },      // Ramp down
  ],
  thresholds: {
    'http_req_duration{endpoint:switch}': ['p95<50'], // <50ms for switchCycle
    'http_req_duration{endpoint:websocket}': ['p95<100'], // <100ms for WS
    'http_req_failed': ['rate<0.01'], // <1% errors
    'websocket_messages_received': ['count>100000'], // Message throughput
  },
}

export default function () {
  const sessionId = `session-${__VU}-${Date.now()}`

  // Create session
  const createRes = http.post('http://localhost:3000/v1/sessions', JSON.stringify({
    session_id: sessionId,
    sync_mode: 'per_participant',
    participants: [
      { participant_id: 'p1', total_time_ms: 300000 },
      { participant_id: 'p2', total_time_ms: 300000 }
    ]
  }), { headers: { 'Content-Type': 'application/json' }})

  check(createRes, { 'session created': (r) => r.status === 201 })

  // Start session
  http.post(`http://localhost:3000/v1/sessions/${sessionId}/start`)

  // High-frequency switching
  for (let i = 0; i < 10; i++) {
    const switchRes = http.post(
      `http://localhost:3000/v1/sessions/${sessionId}/switch`,
      '{}',
      {
        headers: { 'Content-Type': 'application/json' },
        tags: { endpoint: 'switch' }
      }
    )
    check(switchRes, { 'switch successful': (r) => r.status === 200 })
    sleep(0.1) // 10 switches per second per session
  }

  // Cleanup
  http.del(`http://localhost:3000/v1/sessions/${sessionId}`)
}
```

---

### 4. Edge Case Coverage

Ensure all critical edge cases are tested.

**When to use:**
- After completing happy path tests
- Before marking a component as complete
- During code review to identify missing test cases

**Edge cases to verify:**
1. **Time Calculations:**
   - Participant time expires mid-cycle
   - Negative time_remaining
   - Server time skew
   - Pause during cycle transition

2. **Concurrency:**
   - Concurrent switchCycle() calls
   - Version conflicts (optimistic locking)
   - Race conditions in WebSocket broadcasting

3. **State Transitions:**
   - Invalid status transitions (running → pending)
   - Operations on completed sessions
   - Operations on deleted sessions

4. **Boundary Conditions:**
   - Single participant sessions
   - 100+ participants
   - Zero time remaining
   - Maximum time values

5. **Network Failures:**
   - Redis connection lost
   - PostgreSQL unavailable
   - WebSocket disconnects

**Workflow:**
1. Review edge case list in testing_requirements.md
2. Identify which cases apply to the component
3. Generate test cases for each applicable edge case
4. Ensure error handling is tested
5. Document expected behavior

---

### 5. Test Coverage Validation

Validate test coverage meets >80% requirement.

**When to use:**
- After completing unit tests for a component
- Before marking a phase as complete
- During CI/CD pipeline runs

**Workflow:**
1. Run: `pnpm run test:coverage`
2. Review coverage report for:
   - Line coverage >80%
   - Branch coverage >75%
   - Function coverage >85%
3. Identify uncovered code paths
4. Generate additional tests for uncovered areas
5. Re-run coverage validation

**Coverage Targets:**
- RedisStateManager: >85%
- SyncEngine: >90% (hot path critical)
- REST API routes: >80%
- WebSocket server: >80%
- Overall project: >80%

---

## Test Generation Workflow Decision Tree

```
User Request
    ↓
Is it a unit test for a single component/function?
    YES → Use Capability 1 (Unit Test Generation)
          - Review component methods
          - Generate Vitest tests
          - Cover happy path + edge cases + errors
          - Target >80% coverage
    NO ↓

Is it an integration test for API/WebSocket?
    YES → Use Capability 2 (Integration Test Generation)
          - Review API endpoints or WS scenarios
          - Generate Supertest tests
          - Test full request/response cycle
          - Validate performance targets
    NO ↓

Is it a load test for performance validation?
    YES → Use Capability 3 (Load Test Generation)
          - Identify scenario (concurrent sessions, switching, WS)
          - Generate k6 script
          - Set performance thresholds
          - Document expected results
    NO ↓

Is it edge case coverage or validation?
    YES → Use Capability 4 (Edge Case Coverage)
          - Review edge case list
          - Generate tests for applicable cases
          - Ensure error handling tested
    NO ↓

Is it coverage validation?
    YES → Use Capability 5 (Test Coverage Validation)
          - Run coverage report
          - Identify gaps
          - Generate additional tests
```

---

## Best Practices

### Test Organization
- **Unit tests:** `tests/unit/ComponentName.test.ts`
- **Integration tests:** `tests/integration/api.test.ts`, `tests/integration/websocket.test.ts`
- **Load tests:** `tests/load/scenarios/scenario-name.js`

### Naming Conventions
- Describe behavior: `'should throw error on version mismatch'`
- Use active voice
- Be specific about expected outcome

### Test Data
- Use realistic session IDs, participant IDs
- Include edge values (0, negative, max)
- Use consistent test fixtures

### Performance Testing
- Always measure latency for hot paths
- Use `Date.now()` for timing
- Assert against performance budgets (<50ms, <100ms)

### Cleanup
- Clear Redis after each test: `await redisClient.flushall()`
- Reset PostgreSQL test database
- Close WebSocket connections

---

## Resources

### references/
- `testing_requirements.md` - Comprehensive testing patterns, test stack documentation, edge cases, and performance benchmarks

This reference file provides:
- Testing strategy (test pyramid)
- Test stack (Vitest, Supertest, k6)
- Complete code examples for unit, integration, and load tests
- 22 specific edge cases to test
- Performance targets and thresholds
- Test organization structure
