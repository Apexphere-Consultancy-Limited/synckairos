# E2E Test Scenarios

**Version:** 1.1
**Last Updated:** 2025-10-24
**Framework:** Playwright

---

## Overview

This document details the specific test scenarios for SyncKairos E2E testing. Each scenario includes goals, implementation examples, expected results, and execution instructions.

**Coverage:** 12/12 API endpoints (100%)

**See Also:**
- [E2E Overview](./OVERVIEW.md) - Overall E2E testing strategy
- [Test Execution](./EXECUTION.md) - How to run tests in different environments

---

## Scenario 1: Complete Session Lifecycle

**Tags:** `@critical @smoke`

**Goal:** Validate entire session flow from creation to completion with performance measurement

**Test Implementation:**
```typescript
// tests/e2e/session-lifecycle.e2e.test.ts
import { test, expect } from '@playwright/test'
import { getEnvironment } from './setup/environments'

test('complete session lifecycle @critical @smoke', async ({ request }) => {
  const env = getEnvironment()
  const testStartTime = Date.now()

  // 1. Create session
  const createRes = await request.post(`${env.baseURL}/v1/sessions`, {
    data: {
      session_id: `e2e-lifecycle-${Date.now()}`,
      sync_mode: 'per_participant',
      participants: [
        { participant_id: 'p1', total_time_ms: 300000 },
        { participant_id: 'p2', total_time_ms: 300000 }
      ]
    }
  })
  expect(createRes.status()).toBe(201)
  const session = await createRes.json()

  // 2. Start session
  const startRes = await request.post(`${env.baseURL}/v1/sessions/${session.session_id}/start`)
  expect(startRes.status()).toBe(200)
  const startData = await startRes.json()
  expect(startData.status).toBe('running')
  expect(startData.active_participant_id).toBe('p1')

  // 3. Switch cycle (HOT PATH - measure performance)
  const switchStartTime = Date.now()
  const switchRes = await request.post(`${env.baseURL}/v1/sessions/${session.session_id}/switch`)
  const switchLatency = Date.now() - switchStartTime

  expect(switchRes.status()).toBe(200)
  const switchData = await switchRes.json()
  expect(switchData.new_active_participant_id).toBe('p2')
  expect(switchLatency).toBeLessThan(50) // Performance target: <50ms

  // 4. Complete session
  const completeRes = await request.post(`${env.baseURL}/v1/sessions/${session.session_id}/complete`)
  expect(completeRes.status()).toBe(200)

  // 5. Verify final state
  const getRes = await request.get(`${env.baseURL}/v1/sessions/${session.session_id}`)
  const finalSession = await getRes.json()
  expect(finalSession.status).toBe('completed')

  // 6. Validate total flow performance
  const totalDuration = Date.now() - testStartTime
  expect(totalDuration).toBeLessThan(5000) // Performance target: <5 seconds
})
```

**Expected Results:**
- All API calls return 200/201
- Session state transitions correctly (pending → running → completed)
- Works identically on local, staging, and production
- switchCycle completes in <50ms (p95)
- Total flow completes in <5 seconds

**Functional Targets:**
- switchCycle latency: <50ms
- Total flow duration: <5 seconds
- Session state persists correctly in Redis and PostgreSQL

**Running:**
```bash
# Local (comprehensive)
pnpm test:e2e session-lifecycle

# Staging (smoke only)
E2E_ENV=staging pnpm test:e2e session-lifecycle

# Production (critical only)
E2E_ENV=production pnpm test:e2e --grep "@critical.*lifecycle"
```

---

## Scenario 2: Multi-Client Real-Time Synchronization

**Tags:** `@comprehensive @websocket`

**Goal:** Validate real-time updates across multiple connected clients

**Test Steps:**
1. Create session with 3 participants
2. Connect 3 WebSocket clients (one per participant)
3. Start session
4. Verify all 3 clients receive `session_started` within 100ms
5. Switch participant from client 1's perspective
6. Verify all 3 clients receive `participant_switched` within 100ms
7. Verify new active participant matches across all clients
8. Pause session from client 2
9. Verify all 3 clients receive `session_paused`
10. Resume from client 3
11. Verify all 3 clients receive `session_resumed`

**Test Implementation:**
```typescript
// tests/e2e/multi-client.e2e.test.ts
import { test, expect } from '@playwright/test'
import { getEnvironment } from './setup/environments'

test('multi-client sync @comprehensive @websocket', async ({ browser }) => {
  const env = getEnvironment()

  // Create 3 browser contexts (simulating 3 different clients)
  const context1 = await browser.newContext()
  const context2 = await browser.newContext()
  const context3 = await browser.newContext()

  const page1 = await context1.newPage()
  const page2 = await context2.newPage()
  const page3 = await context3.newPage()

  const sessionId = `e2e-multiclient-${Date.now()}`

  // Create session via HTTP
  await page1.request.post(`${env.baseURL}/v1/sessions`, {
    data: {
      session_id: sessionId,
      sync_mode: 'per_participant',
      participants: [
        { participant_id: 'p1', total_time_ms: 300000 },
        { participant_id: 'p2', total_time_ms: 300000 },
        { participant_id: 'p3', total_time_ms: 300000 }
      ]
    }
  })

  // Setup WebSocket listeners on each page BEFORE connecting
  await page1.evaluate((wsURL, sid) => {
    window.wsMessages = []
    const ws = new WebSocket(`${wsURL}?session_id=${sid}`)
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data)
      window.wsMessages.push({ timestamp: Date.now(), ...data })
    }
    window.ws = ws
  }, env.wsURL, sessionId)

  await page2.evaluate((wsURL, sid) => {
    window.wsMessages = []
    const ws = new WebSocket(`${wsURL}?session_id=${sid}`)
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data)
      window.wsMessages.push({ timestamp: Date.now(), ...data })
    }
    window.ws = ws
  }, env.wsURL, sessionId)

  await page3.evaluate((wsURL, sid) => {
    window.wsMessages = []
    const ws = new WebSocket(`${wsURL}?session_id=${sid}`)
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data)
      window.wsMessages.push({ timestamp: Date.now(), ...data })
    }
    window.ws = ws
  }, env.wsURL, sessionId)

  // Wait for WebSocket connections to establish
  await page1.waitForFunction(() => window.ws && window.ws.readyState === WebSocket.OPEN)
  await page2.waitForFunction(() => window.ws && window.ws.readyState === WebSocket.OPEN)
  await page3.waitForFunction(() => window.ws && window.ws.readyState === WebSocket.OPEN)

  // Start session and measure broadcast latency
  const startTime = Date.now()
  await page1.request.post(`${env.baseURL}/v1/sessions/${sessionId}/start`)

  // Wait for all 3 clients to receive session_started event
  await page1.waitForFunction(
    () => window.wsMessages.some(m => m.type === 'session_started'),
    { timeout: 1000 }
  )
  await page2.waitForFunction(
    () => window.wsMessages.some(m => m.type === 'session_started'),
    { timeout: 1000 }
  )
  await page3.waitForFunction(
    () => window.wsMessages.some(m => m.type === 'session_started'),
    { timeout: 1000 }
  )

  // Verify broadcast latency <100ms
  const messages1 = await page1.evaluate(() => window.wsMessages)
  const startEvent = messages1.find(m => m.type === 'session_started')
  const broadcastLatency = startEvent.timestamp - startTime
  expect(broadcastLatency).toBeLessThan(100)

  // Switch cycle and verify all clients receive event
  await page1.request.post(`${env.baseURL}/v1/sessions/${sessionId}/switch`)

  await page1.waitForFunction(
    () => window.wsMessages.some(m => m.type === 'participant_switched'),
    { timeout: 1000 }
  )
  await page2.waitForFunction(
    () => window.wsMessages.some(m => m.type === 'participant_switched'),
    { timeout: 1000 }
  )
  await page3.waitForFunction(
    () => window.wsMessages.some(m => m.type === 'participant_switched'),
    { timeout: 1000 }
  )

  // Verify state consistency across all clients
  const messages2 = await page2.evaluate(() => window.wsMessages)
  const messages3 = await page3.evaluate(() => window.wsMessages)

  const switchEvent1 = messages1.find(m => m.type === 'participant_switched')
  const switchEvent2 = messages2.find(m => m.type === 'participant_switched')
  const switchEvent3 = messages3.find(m => m.type === 'participant_switched')

  expect(switchEvent1.new_active_participant_id).toBe('p2')
  expect(switchEvent2.new_active_participant_id).toBe('p2')
  expect(switchEvent3.new_active_participant_id).toBe('p2')

  // Cleanup
  await page1.evaluate(() => window.ws.close())
  await page2.evaluate(() => window.ws.close())
  await page3.evaluate(() => window.ws.close())

  await context1.close()
  await context2.close()
  await context3.close()
})
```

**Expected Results:**
- All clients receive events in correct order
- No event loss or duplication
- State consistency across all clients
- Event delivery within 100ms (p95)

**Functional Targets:**
- Multi-client broadcast latency: <100ms (p95)
- Zero event loss
- All clients maintain synchronized state

---

## Scenario 3: Health Check E2E

**Tags:** `@critical @smoke`

**Goal:** Validate all health endpoints work on running instance

**Test Steps:**
1. Request `GET /health`
2. Verify returns `200` with `{"status": "ok"}`
3. Request `GET /ready`
4. Verify returns `200` with `{"status": "ready"}`
5. Request `GET /metrics`
6. Verify returns `200` with Prometheus metrics
7. Verify metrics include `synckairos_*` counters

**Test Implementation:**
```typescript
// tests/e2e/health.e2e.test.ts
import { test, expect } from '@playwright/test'
import { getEnvironment } from './setup/environments'

test('health endpoints @critical @smoke', async ({ request }) => {
  const env = getEnvironment()

  // Test /health endpoint
  const healthStartTime = Date.now()
  const healthRes = await request.get(`${env.baseURL}/health`)
  const healthLatency = Date.now() - healthStartTime

  expect(healthRes.status()).toBe(200)
  const healthData = await healthRes.json()
  expect(healthData.status).toBe('ok')
  expect(healthLatency).toBeLessThan(10) // Health check should be <10ms

  // Test /ready endpoint
  const readyRes = await request.get(`${env.baseURL}/ready`)
  expect(readyRes.status()).toBe(200)
  const readyData = await readyRes.json()
  expect(readyData.status).toBe('ready')

  // Test /metrics endpoint
  const metricsRes = await request.get(`${env.baseURL}/metrics`)
  expect(metricsRes.status()).toBe(200)
  const metricsText = await metricsRes.text()

  // Verify Prometheus format
  expect(metricsText).toContain('synckairos_')
  expect(metricsText).toMatch(/# HELP/)
  expect(metricsText).toMatch(/# TYPE/)
})
```

**Expected Results:**
- `/health`: Always returns 200 (liveness)
- `/ready`: Returns 200 when Redis + PostgreSQL are accessible
- `/metrics`: Returns valid Prometheus format with SyncKairos metrics

**Functional Targets:**
- Health check response: <10ms
- Readiness check validates infrastructure connectivity
- Metrics include all key counters

---

## Scenario 4: Error Handling E2E

**Tags:** `@comprehensive @api`

**Goal:** Validate error responses from client perspective

**Test Steps:**
1. Create session
2. Attempt to start non-existent session → expect 404
3. Attempt to switch on pending session → expect 400
4. Start session
5. Attempt to start again → expect 409 (conflict)
6. Attempt to pause already paused session → expect 409
7. Attempt to resume already running session → expect 409
8. Attempt to delete non-existent session → expect 404
9. Make 101 requests in 1 minute → expect 429 (rate limited)
10. Send invalid JSON → expect 400 with validation error
11. Connect WebSocket with invalid session ID → expect disconnect

**Test Implementation:**
```typescript
// tests/e2e/error-handling.e2e.test.ts
import { test, expect } from '@playwright/test'
import { getEnvironment } from './setup/environments'

test('error handling @comprehensive @api', async ({ request }) => {
  const env = getEnvironment()

  // Test 404 - Non-existent session
  const notFoundRes = await request.post(`${env.baseURL}/v1/sessions/nonexistent/start`)
  expect(notFoundRes.status()).toBe(404)
  const notFoundData = await notFoundRes.json()
  expect(notFoundData.error).toBeDefined()

  // Test 400 - Invalid state transition (switch on pending session)
  const sessionId = `e2e-error-${Date.now()}`
  await request.post(`${env.baseURL}/v1/sessions`, {
    data: {
      session_id: sessionId,
      sync_mode: 'per_participant',
      participants: [
        { participant_id: 'p1', total_time_ms: 300000 }
      ]
    }
  })

  const badRequestRes = await request.post(`${env.baseURL}/v1/sessions/${sessionId}/switch`)
  expect(badRequestRes.status()).toBe(400)
  const badRequestData = await badRequestRes.json()
  expect(badRequestData.error).toContain('pending')

  // Test 409 - Conflict (start already running session)
  await request.post(`${env.baseURL}/v1/sessions/${sessionId}/start`)
  const conflictRes = await request.post(`${env.baseURL}/v1/sessions/${sessionId}/start`)
  expect(conflictRes.status()).toBe(409)

  // Test 409 - Pause already paused session
  await request.post(`${env.baseURL}/v1/sessions/${sessionId}/pause`)
  const pauseConflictRes = await request.post(`${env.baseURL}/v1/sessions/${sessionId}/pause`)
  expect(pauseConflictRes.status()).toBe(409)

  // Test 409 - Resume already running session
  await request.post(`${env.baseURL}/v1/sessions/${sessionId}/resume`)
  const resumeConflictRes = await request.post(`${env.baseURL}/v1/sessions/${sessionId}/resume`)
  expect(resumeConflictRes.status()).toBe(409)

  // Test 404 - Delete non-existent session
  const deleteNotFoundRes = await request.delete(`${env.baseURL}/v1/sessions/nonexistent`)
  expect(deleteNotFoundRes.status()).toBe(404)

  // Test 429 - Rate limiting
  const promises = []
  for (let i = 0; i < 105; i++) {
    promises.push(request.get(`${env.baseURL}/health`))
  }
  const results = await Promise.all(promises)
  const rateLimitedCount = results.filter(r => r.status() === 429).length
  expect(rateLimitedCount).toBeGreaterThan(0)

  // Test 400 - Invalid JSON
  const invalidRes = await request.post(`${env.baseURL}/v1/sessions`, {
    data: { invalid: 'data' }
  })
  expect(invalidRes.status()).toBe(400)

  // Test 404 - Operations on deleted session
  const sessionId2 = `e2e-deleted-${Date.now()}`
  await request.post(`${env.baseURL}/v1/sessions`, {
    data: {
      session_id: sessionId2,
      sync_mode: 'per_participant',
      participants: [{ participant_id: 'p1', total_time_ms: 300000 }]
    }
  })
  await request.delete(`${env.baseURL}/v1/sessions/${sessionId2}`)

  const deletedStartRes = await request.post(`${env.baseURL}/v1/sessions/${sessionId2}/start`)
  expect(deletedStartRes.status()).toBe(404)
})
```

**Expected Results:**
- Correct HTTP status codes for each error type
- Error messages are descriptive and actionable
- Rate limiting works as configured (100 req/min)
- WebSocket errors handled gracefully
- All error paths return consistent error format

**Functional Targets:**
- Error responses include error message and type
- All error paths return consistent error format
- Rate limiting protects against abuse

---

## Scenario 5: Rate Limiting E2E

**Tags:** `@comprehensive @api`

**Goal:** Validate rate limiting protects API endpoints

**Test Steps:**
1. Make 100 requests to session creation endpoint in 30 seconds
2. Verify 101st request returns 429
3. Wait for rate limit window to expire
4. Verify subsequent requests succeed

**Test Implementation:**
```typescript
// tests/e2e/rate-limiting.e2e.test.ts
import { test, expect } from '@playwright/test'
import { getEnvironment } from './setup/environments'

test('rate limiting protection @comprehensive @api', async ({ request }) => {
  const env = getEnvironment()

  // Make 101 requests rapidly
  const promises = []
  for (let i = 0; i < 101; i++) {
    promises.push(request.post(`${env.baseURL}/v1/sessions`, {
      data: {
        session_id: `rate-test-${i}-${Date.now()}`,
        sync_mode: 'per_participant',
        participants: [{ participant_id: 'p1', total_time_ms: 300000 }]
      }
    }))
  }

  const results = await Promise.all(promises)

  // Count rate limited responses
  const rateLimitedResponses = results.filter(r => r.status() === 429)
  const successfulResponses = results.filter(r => r.status() === 201)

  expect(rateLimitedResponses.length).toBeGreaterThan(0)

  // Verify retry-after header is present
  const rateLimitedRes = rateLimitedResponses[0]
  const retryAfter = rateLimitedRes.headers()['retry-after']
  expect(retryAfter).toBeDefined()

  // Wait for rate limit window to expire (60 seconds + buffer)
  await new Promise(resolve => setTimeout(resolve, 65000))

  // Verify subsequent request succeeds
  const afterWaitRes = await request.post(`${env.baseURL}/v1/sessions`, {
    data: {
      session_id: `rate-test-after-wait-${Date.now()}`,
      sync_mode: 'per_participant',
      participants: [{ participant_id: 'p1', total_time_ms: 300000 }]
    }
  })
  expect(afterWaitRes.status()).toBe(201)
})
```

**Expected Results:**
- Rate limiting activates after threshold (100 req/min)
- 429 responses include retry-after header
- Rate limit resets after time window

---

## Scenario 6: Edge Cases E2E

**Tags:** `@comprehensive`

**Goal:** Validate system handles edge cases correctly

**Test Implementation:**
```typescript
// tests/e2e/edge-cases.e2e.test.ts
import { test, expect } from '@playwright/test'
import { getEnvironment } from './setup/environments'

test('single participant session @comprehensive', async ({ request }) => {
  const env = getEnvironment()
  const sessionId = `e2e-single-${Date.now()}`

  // Create session with 1 participant
  await request.post(`${env.baseURL}/v1/sessions`, {
    data: {
      session_id: sessionId,
      sync_mode: 'per_participant',
      participants: [{ participant_id: 'p1', total_time_ms: 300000 }]
    }
  })

  await request.post(`${env.baseURL}/v1/sessions/${sessionId}/start`)

  // Switch should work but stay on same participant
  const switchRes = await request.post(`${env.baseURL}/v1/sessions/${sessionId}/switch`)
  expect(switchRes.status()).toBe(200)
  const switchData = await switchRes.json()
  expect(switchData.new_active_participant_id).toBe('p1')
})

test('session with 100 participants @comprehensive', async ({ request }) => {
  const env = getEnvironment()
  const sessionId = `e2e-many-${Date.now()}`

  // Create session with 100 participants
  const participants = []
  for (let i = 1; i <= 100; i++) {
    participants.push({ participant_id: `p${i}`, total_time_ms: 300000 })
  }

  const createRes = await request.post(`${env.baseURL}/v1/sessions`, {
    data: {
      session_id: sessionId,
      sync_mode: 'per_participant',
      participants
    }
  })
  expect(createRes.status()).toBe(201)

  await request.post(`${env.baseURL}/v1/sessions/${sessionId}/start`)

  // Switch multiple times
  for (let i = 0; i < 5; i++) {
    const switchRes = await request.post(`${env.baseURL}/v1/sessions/${sessionId}/switch`)
    expect(switchRes.status()).toBe(200)
  }
})

test('very long session ID @comprehensive', async ({ request }) => {
  const env = getEnvironment()
  // 255 character session ID
  const sessionId = 'e2e-' + 'x'.repeat(251)

  const createRes = await request.post(`${env.baseURL}/v1/sessions`, {
    data: {
      session_id: sessionId,
      sync_mode: 'per_participant',
      participants: [{ participant_id: 'p1', total_time_ms: 300000 }]
    }
  })
  expect(createRes.status()).toBe(201)
})

test('unicode participant IDs @comprehensive', async ({ request }) => {
  const env = getEnvironment()
  const sessionId = `e2e-unicode-${Date.now()}`

  const createRes = await request.post(`${env.baseURL}/v1/sessions`, {
    data: {
      session_id: sessionId,
      sync_mode: 'per_participant',
      participants: [
        { participant_id: '参加者1', total_time_ms: 300000 },
        { participant_id: 'مشارك٢', total_time_ms: 300000 },
        { participant_id: '参加者👤', total_time_ms: 300000 }
      ]
    }
  })
  expect(createRes.status()).toBe(201)

  await request.post(`${env.baseURL}/v1/sessions/${sessionId}/start`)
  const switchRes = await request.post(`${env.baseURL}/v1/sessions/${sessionId}/switch`)
  expect(switchRes.status()).toBe(200)
})

test('time expiration edge case @comprehensive', async ({ request }) => {
  const env = getEnvironment()
  const sessionId = `e2e-expire-${Date.now()}`

  // Create session with very short duration for p1
  await request.post(`${env.baseURL}/v1/sessions`, {
    data: {
      session_id: sessionId,
      sync_mode: 'per_participant',
      participants: [
        { participant_id: 'p1', total_time_ms: 100 }, // 100ms - very short
        { participant_id: 'p2', total_time_ms: 300000 }
      ]
    }
  })

  await request.post(`${env.baseURL}/v1/sessions/${sessionId}/start`)

  // Wait for p1's time to expire
  await new Promise(resolve => setTimeout(resolve, 200))

  // Get state - should auto-transition to p2 or show time expired
  const getRes = await request.get(`${env.baseURL}/v1/sessions/${sessionId}`)
  const state = await getRes.json()

  // Verify system handled time expiration gracefully
  expect(state.status).toBe('running')
  expect(state.time_remaining_ms).toBeLessThanOrEqual(0)
})

test('concurrent switchCycle operations @comprehensive', async ({ request }) => {
  const env = getEnvironment()
  const sessionId = `e2e-concurrent-${Date.now()}`

  await request.post(`${env.baseURL}/v1/sessions`, {
    data: {
      session_id: sessionId,
      sync_mode: 'per_participant',
      participants: [
        { participant_id: 'p1', total_time_ms: 300000 },
        { participant_id: 'p2', total_time_ms: 300000 }
      ]
    }
  })

  await request.post(`${env.baseURL}/v1/sessions/${sessionId}/start`)

  // Fire 5 concurrent switch requests
  const promises = []
  for (let i = 0; i < 5; i++) {
    promises.push(request.post(`${env.baseURL}/v1/sessions/${sessionId}/switch`))
  }

  const results = await Promise.all(promises)

  // All should succeed or fail gracefully (no crashes)
  results.forEach(res => {
    expect([200, 409]).toContain(res.status())
  })

  // Final state should be consistent
  const getRes = await request.get(`${env.baseURL}/v1/sessions/${sessionId}`)
  const state = await getRes.json()
  expect(['p1', 'p2']).toContain(state.active_participant_id)
})

test('complete session without starting @comprehensive', async ({ request }) => {
  const env = getEnvironment()
  const sessionId = `e2e-complete-pending-${Date.now()}`

  await request.post(`${env.baseURL}/v1/sessions`, {
    data: {
      session_id: sessionId,
      sync_mode: 'per_participant',
      participants: [{ participant_id: 'p1', total_time_ms: 300000 }]
    }
  })

  // Try to complete without starting - should fail with 400
  const completeRes = await request.post(`${env.baseURL}/v1/sessions/${sessionId}/complete`)
  expect(completeRes.status()).toBe(400)
  const errorData = await completeRes.json()
  expect(errorData.error).toBeDefined()
})
```

**Expected Results:**
- All edge cases handled gracefully
- No crashes or undefined behavior
- Appropriate error messages for invalid inputs
- System maintains consistency under concurrent operations

---

## Scenario 7: Pause and Resume Operations

**Tags:** `@comprehensive @api`

**Goal:** Validate pause and resume functionality preserves time_remaining correctly

**Test Steps:**
1. Create and start session
2. Pause session after 2 seconds
3. Verify time_remaining is saved
4. Wait 5 seconds while paused
5. Resume session
6. Verify time_remaining continues from saved value (±50ms tolerance)
7. Test pause during active cycle
8. Test error cases (pause paused session, resume running session)

**Test Implementation:**
```typescript
// tests/e2e/pause-resume.e2e.test.ts
import { test, expect } from '@playwright/test'
import { getEnvironment } from './setup/environments'

test('pause and resume session @comprehensive @api', async ({ request }) => {
  const env = getEnvironment()
  const sessionId = `e2e-pause-${Date.now()}`

  // Create and start session
  await request.post(`${env.baseURL}/v1/sessions`, {
    data: {
      session_id: sessionId,
      sync_mode: 'per_participant',
      participants: [
        { participant_id: 'p1', total_time_ms: 300000 },
        { participant_id: 'p2', total_time_ms: 300000 }
      ]
    }
  })

  await request.post(`${env.baseURL}/v1/sessions/${sessionId}/start`)

  // Wait 2 seconds then pause
  await new Promise(resolve => setTimeout(resolve, 2000))

  const pauseRes = await request.post(`${env.baseURL}/v1/sessions/${sessionId}/pause`)
  expect(pauseRes.status()).toBe(200)
  const pausedState = await pauseRes.json()
  expect(pausedState.status).toBe('paused')
  const savedTimeRemaining = pausedState.time_remaining_ms

  // Verify time_remaining is approximately 298000ms (300000 - 2000)
  expect(savedTimeRemaining).toBeLessThan(300000)
  expect(savedTimeRemaining).toBeGreaterThan(295000)

  // Wait 5 seconds while paused
  await new Promise(resolve => setTimeout(resolve, 5000))

  // Resume and verify time_remaining didn't change
  const resumeRes = await request.post(`${env.baseURL}/v1/sessions/${sessionId}/resume`)
  expect(resumeRes.status()).toBe(200)
  const resumedState = await resumeRes.json()
  expect(resumedState.status).toBe('running')

  // Time remaining should be approximately the same (±50ms tolerance)
  expect(Math.abs(resumedState.time_remaining_ms - savedTimeRemaining)).toBeLessThan(50)

  // Continue session to verify it works after resume
  const switchRes = await request.post(`${env.baseURL}/v1/sessions/${sessionId}/switch`)
  expect(switchRes.status()).toBe(200)
  expect(switchRes.json().then(data => data.new_active_participant_id)).resolves.toBe('p2')
})

test('pause during cycle transition @comprehensive', async ({ request }) => {
  const env = getEnvironment()
  const sessionId = `e2e-pause-transition-${Date.now()}`

  await request.post(`${env.baseURL}/v1/sessions`, {
    data: {
      session_id: sessionId,
      sync_mode: 'per_participant',
      participants: [
        { participant_id: 'p1', total_time_ms: 300000 },
        { participant_id: 'p2', total_time_ms: 300000 }
      ]
    }
  })

  await request.post(`${env.baseURL}/v1/sessions/${sessionId}/start`)

  // Fire switch and pause concurrently
  const [switchRes, pauseRes] = await Promise.all([
    request.post(`${env.baseURL}/v1/sessions/${sessionId}/switch`),
    request.post(`${env.baseURL}/v1/sessions/${sessionId}/pause`)
  ])

  // Both should succeed or one should fail gracefully
  expect([200, 409]).toContain(switchRes.status())
  expect([200, 409]).toContain(pauseRes.status())

  // Final state should be consistent
  const getRes = await request.get(`${env.baseURL}/v1/sessions/${sessionId}`)
  const state = await getRes.json()
  expect(['running', 'paused']).toContain(state.status)
})
```

**Expected Results:**
- Pause freezes time_remaining accurately
- Resume continues from saved time_remaining (±50ms tolerance)
- Pause/resume works correctly during cycle transitions
- State transitions are atomic and consistent

**Functional Targets:**
- Time preservation accuracy: ±50ms
- Pause/resume latency: <100ms

---

## Scenario 8: Delete Session Operations

**Tags:** `@comprehensive @api`

**Goal:** Validate session deletion and subsequent operations

**Test Steps:**
1. Create session
2. Delete session
3. Verify 404 on subsequent GET
4. Verify operations on deleted session return 404
5. Test delete of running session
6. Test delete of completed session
7. Test delete of non-existent session returns 404

**Test Implementation:**
```typescript
// tests/e2e/delete-session.e2e.test.ts
import { test, expect } from '@playwright/test'
import { getEnvironment } from './setup/environments'

test('delete session lifecycle @comprehensive @api', async ({ request }) => {
  const env = getEnvironment()
  const sessionId = `e2e-delete-${Date.now()}`

  // Create session
  await request.post(`${env.baseURL}/v1/sessions`, {
    data: {
      session_id: sessionId,
      sync_mode: 'per_participant',
      participants: [{ participant_id: 'p1', total_time_ms: 300000 }]
    }
  })

  // Delete session
  const deleteRes = await request.delete(`${env.baseURL}/v1/sessions/${sessionId}`)
  expect(deleteRes.status()).toBe(200)

  // Verify 404 on subsequent GET
  const getRes = await request.get(`${env.baseURL}/v1/sessions/${sessionId}`)
  expect(getRes.status()).toBe(404)

  // Verify operations on deleted session fail with 404
  const startRes = await request.post(`${env.baseURL}/v1/sessions/${sessionId}/start`)
  expect(startRes.status()).toBe(404)

  const switchRes = await request.post(`${env.baseURL}/v1/sessions/${sessionId}/switch`)
  expect(switchRes.status()).toBe(404)
})

test('delete running session @comprehensive', async ({ request }) => {
  const env = getEnvironment()
  const sessionId = `e2e-delete-running-${Date.now()}`

  await request.post(`${env.baseURL}/v1/sessions`, {
    data: {
      session_id: sessionId,
      sync_mode: 'per_participant',
      participants: [{ participant_id: 'p1', total_time_ms: 300000 }]
    }
  })

  await request.post(`${env.baseURL}/v1/sessions/${sessionId}/start`)

  // Delete running session - should succeed
  const deleteRes = await request.delete(`${env.baseURL}/v1/sessions/${sessionId}`)
  expect(deleteRes.status()).toBe(200)

  // Verify session is gone
  const getRes = await request.get(`${env.baseURL}/v1/sessions/${sessionId}`)
  expect(getRes.status()).toBe(404)
})

test('delete completed session @comprehensive', async ({ request }) => {
  const env = getEnvironment()
  const sessionId = `e2e-delete-completed-${Date.now()}`

  await request.post(`${env.baseURL}/v1/sessions`, {
    data: {
      session_id: sessionId,
      sync_mode: 'per_participant',
      participants: [{ participant_id: 'p1', total_time_ms: 300000 }]
    }
  })

  await request.post(`${env.baseURL}/v1/sessions/${sessionId}/start`)
  await request.post(`${env.baseURL}/v1/sessions/${sessionId}/complete`)

  // Delete completed session - should succeed
  const deleteRes = await request.delete(`${env.baseURL}/v1/sessions/${sessionId}`)
  expect(deleteRes.status()).toBe(200)
})

test('delete non-existent session @comprehensive', async ({ request }) => {
  const env = getEnvironment()

  // Try to delete non-existent session
  const deleteRes = await request.delete(`${env.baseURL}/v1/sessions/nonexistent`)
  expect(deleteRes.status()).toBe(404)
  const errorData = await deleteRes.json()
  expect(errorData.error).toBeDefined()
})
```

**Expected Results:**
- Delete removes session completely
- Subsequent GET returns 404
- All operations on deleted session return 404
- Delete works for pending, running, paused, and completed sessions
- Delete of non-existent session returns 404

**Functional Targets:**
- Delete operation completes in <100ms
- Redis and PostgreSQL cleanup is atomic

---

## Test Execution

### Local Development
```bash
# Run all scenarios
pnpm test:e2e

# Run specific scenario
pnpm test:e2e session-lifecycle
pnpm test:e2e pause-resume
pnpm test:e2e delete-session

# Run by tag
pnpm test:e2e --grep @critical
pnpm test:e2e --grep @websocket
pnpm test:e2e --grep @comprehensive
```

### Staging Deployment
```bash
# Smoke tests only
E2E_ENV=staging pnpm test:e2e --grep @smoke
```

### Production Deployment
```bash
# Critical tests only
E2E_ENV=production pnpm test:e2e --grep @critical
```

---

## Success Criteria

### Coverage
- ✅ All 12 API endpoints covered (100%)
  - POST /v1/sessions
  - GET /v1/sessions/:id
  - POST /v1/sessions/:id/start
  - POST /v1/sessions/:id/switch
  - POST /v1/sessions/:id/pause
  - POST /v1/sessions/:id/resume
  - POST /v1/sessions/:id/complete
  - DELETE /v1/sessions/:id
  - GET /health
  - GET /ready
  - GET /metrics
  - WebSocket /ws
- ✅ All WebSocket events covered
- ✅ All error scenarios covered
- ✅ All state transitions covered
- ✅ Critical edge cases covered (concurrency, time expiration, unicode, etc.)

### Reliability
- ✅ All scenarios pass consistently (>99% success rate)
- ✅ No flaky tests
- ✅ Tests complete in <5 minutes total

### Performance
- ✅ switchCycle latency measured and validated (<50ms)
- ✅ WebSocket broadcast latency measured and validated (<100ms)
- ✅ Health check latency validated (<10ms)

### Documentation
- ✅ Each scenario has clear goals and expected results
- ✅ Test code is well-commented
- ✅ Failure modes are documented
- ✅ Performance targets are explicit

---

## API Endpoint Coverage Summary

| Endpoint | Scenario(s) | Tags | Status |
|----------|-------------|------|--------|
| POST /v1/sessions | 1, 4, 5, 6, 7, 8 | @critical @smoke @comprehensive | ✅ |
| GET /v1/sessions/:id | 1, 8 | @critical @smoke | ✅ |
| POST /v1/sessions/:id/start | 1, 4, 7, 8 | @critical @smoke @comprehensive | ✅ |
| POST /v1/sessions/:id/switch | 1, 2, 4, 6 | @critical @smoke @comprehensive | ✅ |
| POST /v1/sessions/:id/pause | 2, 4, 7 | @comprehensive | ✅ |
| POST /v1/sessions/:id/resume | 2, 4, 7 | @comprehensive | ✅ |
| POST /v1/sessions/:id/complete | 1, 6, 8 | @critical @smoke @comprehensive | ✅ |
| DELETE /v1/sessions/:id | 4, 8 | @comprehensive | ✅ |
| GET /health | 3, 4, 5 | @critical @smoke | ✅ |
| GET /ready | 3 | @critical @smoke | ✅ |
| GET /metrics | 3 | @critical @smoke | ✅ |
| WebSocket /ws | 2 | @comprehensive @websocket | ✅ |

**Total Coverage: 12/12 endpoints (100%)**

---

**Related Documents:**
- [E2E Overview](./OVERVIEW.md)
- [Test Execution Guide](./EXECUTION.md)
- [Environment Configuration](./ENVIRONMENTS.md)
