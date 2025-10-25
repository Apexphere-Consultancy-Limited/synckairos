---
name: tester
description: Test generation and validation skill for SyncKairos v2.0 development. Use this skill when creating unit tests, integration tests, or load tests for SyncKairos components. Ensures tests follow the testing requirements, achieve >80% coverage, and validate performance targets (<50ms switchCycle, <100ms WebSocket, 10k+ concurrent sessions).
---

# SyncKairos Tester

## Overview

This skill guides test creation for SyncKairos v2.0, ensuring comprehensive coverage across unit tests (Vitest), integration tests (Supertest), and load tests (k6). It enforces testing requirements, performance targets, and edge case coverage.

⚠️ **CRITICAL**: All tests must use **Zod schemas** ([src/api/schemas/session.ts](../../../src/api/schemas/session.ts)) for validation. Never create manual validation logic - import and use the schema validators. Contract tests ([tests/contract/websocket-schemas.test.ts](../../../tests/contract/websocket-schemas.test.ts)) validate schemas match implementation. API documentation is auto-generated from schemas at `/api-docs`.

## Quick Reference: Test Speed Targets ⚡

| Test Type | Speed Target | Typical Duration | Max Acceptable |
|-----------|--------------|------------------|----------------|
| Unit Test (single) | <20ms | 14-19ms | <100ms |
| Unit Test Suite | <5s | 2-3s | <10s |
| Integration Test | <5s | 2-5s | <10s |
| E2E Test | <30s | 10-20s | <60s |
| Load Test | minutes | 5-15min | 30min |

**Golden Rules:**
1. ⚡ Unit tests should be **FAST** (<100ms) - if not, it's probably an integration test
2. 🎯 Test YOUR code, not libraries (don't test BullMQ, Redis, PostgreSQL)
3. ⏱️ Use `vi.useFakeTimers()` instead of actual `setTimeout` waits
4. 🔬 Call methods directly - don't go through the entire stack in unit tests
5. 📁 Classify correctly: unit vs integration vs E2E vs performance

## Core Capabilities

### 0. Test Classification & Analysis 🔍

**CRITICAL: Run this FIRST before writing any tests!**

Analyze existing tests to ensure proper classification and identify architectural issues.

**When to use:**
- Before writing new tests for a component
- When reviewing existing test files
- When tests are running slowly (>1s for unit tests)
- During code review or refactoring

**Workflow:**
1. Analyze test file structure and dependencies
2. Identify misclassifications:
   - "Unit tests" using real Redis/PostgreSQL/BullMQ
   - Tests with `setTimeout` waits >100ms
   - Tests using actual infrastructure
3. Generate classification report
4. Recommend fixes (split, move, or refactor)

**Classification Criteria:**
```
✅ TRUE UNIT TEST:
- Tests single component/function in isolation
- All dependencies mocked (no real Redis/DB)
- Execution time: <100ms per test
- No network calls, no file I/O
- Location: tests/unit/

✅ INTEGRATION TEST:
- Tests component interaction with infrastructure
- Uses real Redis/PostgreSQL (test instances)
- Execution time: <10s per test
- May use fake timers to speed up
- Location: tests/integration/

✅ E2E TEST:
- Tests full user workflows
- Real infrastructure, real API calls
- Execution time: <30s per test
- Location: tests/e2e/

✅ PERFORMANCE/LOAD TEST:
- Measures throughput, latency, concurrency
- Large data sets, high load
- Execution time: minutes
- Location: tests/performance/ or tests/load/
```

**Example Analysis Output:**
```
❌ tests/unit/DBWriteQueue.retry.test.ts
   Type: Integration Test (MISCLASSIFIED)
   Issues:
     - Creates real DBWriteQueue with Redis (line 36)
     - Uses real PostgreSQL pool (line 70)
     - Waits 70 seconds for retries (line 87)
     - Tests BullMQ library behavior (not our code)

   Recommendations:
     1. Extract error handling logic → new unit test
        - Test: Which errors trigger retries?
        - Mock: pool.connect, logger
        - Expected time: <20ms

     2. Move BullMQ integration tests → tests/integration/
        - Use vi.useFakeTimers() for speed
        - Expected time: ~5s (down from 90s)

   Estimated Impact:
     - Speed: 90s → 5s (18x faster)
     - New unit tests: 7 tests in <20ms
     - Better test architecture
```

**Auto-Fix Suggestions:**
```typescript
// Detected pattern: Testing error classification
// Current (integration): Waits for BullMQ to retry
// Suggested (unit): Test logic directly

// Generate:
it('should throw for ECONNREFUSED (triggers retry)', async () => {
  const performDBWrite = (queue as any).performDBWrite
  pool.connect = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
  await expect(performDBWrite(data)).rejects.toThrow('ECONNREFUSED')
})
```

---

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
- **Performance tests:** `tests/performance/benchmark-name.test.ts`

### Naming Conventions
- Describe behavior: `'should throw error on version mismatch'`
- Use active voice
- Be specific about expected outcome
- Include intent in parentheses: `'should throw for ECONNREFUSED (triggers retry)'`
- For negative tests: `'should NOT throw for duplicate key (no retry)'`

### Test Data
- Use realistic session IDs, participant IDs
- Include edge values (0, negative, max)
- Use consistent test fixtures
- For unit tests: Use fixed dates `new Date('2025-01-01T00:00:00Z')` for deterministic results

### Test Speed & Performance
⚡ **CRITICAL**: Test speed directly impacts developer productivity

**Speed Targets:**
- Unit tests: <100ms per test (ideally <20ms)
- Integration tests: <10s per test (use fake timers if needed)
- E2E tests: <30s per test
- Total unit test suite: <5s

**Techniques:**

1. **Use Fake Timers for Delays**
   ```typescript
   beforeEach(() => vi.useFakeTimers())
   afterEach(() => vi.useRealTimers())

   // Instead of: await new Promise(resolve => setTimeout(resolve, 70000))
   // Use:
   for (let i = 0; i < 5; i++) {
     await vi.runAllTimersAsync()
   }
   ```

2. **Test Methods Directly (Unit Tests)**
   ```typescript
   // ❌ Don't: Go through entire stack
   await queue.queueWrite(...)
   await new Promise(setTimeout(70000))

   // ✅ Do: Call method directly
   const performDBWrite = (queue as any).performDBWrite
   await expect(performDBWrite(data)).rejects.toThrow()
   ```

3. **Mock at the Right Level**
   ```typescript
   // ✅ Mock dependencies, not the system under test
   pool.connect = vi.fn().mockRejectedValue(new Error('...'))

   // ❌ Don't mock the component being tested
   vi.mock('@/state/DBWriteQueue') // Wrong!
   ```

4. **Reuse Test Infrastructure**
   ```typescript
   // ✅ Share setup when safe
   beforeAll(() => {
     queue = new DBWriteQueue(redisUrl)
   })
   afterEach(async () => {
     await queue.cleanup() // Faster than recreating
   })
   afterAll(async () => {
     await queue.close()
   })
   ```

### Test Optimization Principles

#### 1. Test Isolation Enables Parallelism
- **Principle:** Isolated tests can run concurrently; shared resources force sequential execution
- **Implementation:** Use unique identifiers per test (queue names, DB schemas, ports, temp directories)
- **Pattern:** `beforeEach` with unique resources > `beforeAll` with shared resources
- **Benefit:** Unlocks parallel execution for massive performance gains (50%+ faster)

**Example:**
```typescript
// ❌ Bad: Shared resources (forces sequential execution)
beforeAll(() => queue = new DBWriteQueue('redis://localhost'))

// ✅ Good: Isolated resources (enables parallel execution)
beforeEach(() => {
  const uniqueName = `test-queue-${Date.now()}-${Math.random().toString(36).substring(7)}`
  queue = new DBWriteQueue('redis://localhost', { queueName: uniqueName })
})
```

#### 2. Make Product Code Testable, Don't Patch Tests
- **Anti-pattern:** Hardcoding test-specific logic that bypasses product code
- **Better approach:** Make product code configurable (dependency injection, config parameters)
- **Example:** Add `RetryConfig` interface to product code instead of mocking retry delays
- **Result:** Better product design + faster tests

```typescript
// ❌ Anti-pattern: Test-only workaround
// Production code hardcoded with 2000ms delay
// Tests use setTimeout to wait 70 seconds

// ✅ Better: Configurable product code
export interface RetryConfig {
  attempts?: number
  backoffDelay?: number
  queueName?: string // For test isolation
}

// Production: default 2000ms
// Tests: configurable 200ms (10x faster)
```

#### 3. Performance Optimization Hierarchy
Apply optimizations in this order for maximum impact:

1. **Algorithm/Config changes** (10x+ gains)
   - Fast retry delays for tests (2000ms → 200ms)
   - Use vi.useFakeTimers() instead of real waits

2. **Remove unnecessary operations** (2-5x gains)
   - Delete slow cleanup queries
   - Skip redundant validation

3. **Parallelization** (1.5-3x gains)
   - Enable concurrent test execution
   - Check vitest config: `singleFork: false`, `fileParallelism: true`

4. **Fine-tuning** (1.1-1.5x gains)
   - Timeout adjustments
   - Connection pooling

#### 4. Root Cause Over Symptoms
When tests are slow or failing:
- **Symptom:** Tests timing out at 15s
- **Surface cause:** Slow retry delays (2000ms)
- **Root cause:** Mock interference from shared queue names
- **Lesson:** Fix the root cause (isolation) to unlock other optimizations (parallelism)

#### 5. Check Test Configuration Defaults
Test frameworks may prioritize safety over speed:
- ❌ `singleFork: true` (forces sequential execution)
- ❌ `maxConcurrency: 1` (no parallelism)
- ❌ `parallel: false` (explicit sequential)

When test isolation is guaranteed, enable parallel execution:
```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: false, // Enable parallel execution
      },
    },
    fileParallelism: true, // Run test files in parallel
  },
})
```

**⚠️ IMPORTANT:** Only enable parallelism after confirming tests are properly isolated (no shared state, unique resource names).

### What to Test (and What NOT to Test)

✅ **DO Test:**
- YOUR error handling logic
- YOUR business logic
- YOUR data transformations
- Edge cases in YOUR code
- Error classification decisions

❌ **DON'T Test:**
- Library/framework behavior (BullMQ retries, Redis commands)
- Third-party code you don't own
- Database constraint enforcement (PostgreSQL tests this)
- Language features (JavaScript/TypeScript)

**Example:**
```typescript
// ❌ Testing BullMQ (they test this)
it('should retry 5 times with exponential backoff', async () => {
  // Waits 70 seconds for BullMQ to retry...
})

// ✅ Testing OUR error classification
it('should throw for ECONNREFUSED (triggers BullMQ retry)', async () => {
  pool.connect = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
  await expect(performDBWrite(data)).rejects.toThrow()
  // 19ms - Tests OUR logic
})
```

### Mock Strategy

**Level 1: Mock External Dependencies**
```typescript
// Mock database connections
pool.connect = vi.fn().mockResolvedValue(mockClient)

// Mock logger (side effects)
vi.spyOn(logger, 'error').mockImplementation(() => {})

// Mock Redis
redisClient.get = vi.fn().mockResolvedValue(null)
```

**Level 2: Create Test Doubles**
```typescript
const mockClient = {
  query: vi.fn(async (sql) => {
    if (sql.includes('INSERT')) throw new Error('duplicate key')
    return { rows: [], rowCount: 0 }
  }),
  release: vi.fn()
}
```

**Level 3: Spy on Private Methods**
```typescript
const alertSpy = vi.spyOn(queue as any, 'alertOnPersistentFailure')
// Test that private method was called correctly
```

### Cleanup
- Clear Redis after each test: `await redisClient.flushall()`
- Reset PostgreSQL test database
- Close WebSocket connections
- Restore mocks: `vi.restoreAllMocks()`
- Restore timers: `vi.useRealTimers()`

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
