# Task 4.5: API Documentation & Contract Validation (Single Source of Truth)

**Phase:** 4 - Deployment & Quality Assurance
**Component:** API Documentation & Contract Validation
**Priority:** ⭐⭐ **HIGH - Quality & Developer Experience**
**Estimated Time:** 1.5 days (12 hours)
**Status:** ⚪ Pending
**Dependencies:** E2E Tests Complete ✅, Architecture Review ✅

---

## Objective

Establish a **Single Source of Truth** for API contracts using Zod schemas, fix E2E tests to match the correct STATE_UPDATE WebSocket design, and create accurate documentation that reflects the actual implementation.

**Key Focus:** Align tests and documentation with correct architecture; prevent future drift; improve developer experience.

---

## Problem Statement

**Issues Discovered During E2E Testing:**

1. ❌ **E2E tests expect wrong WebSocket events**
   - Tests expect: `session_started`, `participant_switched`, `session_paused`, etc.
   - Implementation sends: `STATE_UPDATE` with full state
   - **Root cause:** Tests based on incorrect event-driven assumption

2. ❌ **WebSocket parameter inconsistency**
   - Implementation expects: `sessionId` (camelCase) ✅
   - Tests use: `participant_id` (doesn't exist in backend)
   - Documentation says: `session_id` (snake_case)

3. ❌ **No validation that docs match implementation**
   - Manual docs drift from code
   - No contract tests
   - Breaking changes undetected

4. ❌ **No shared type definitions**
   - Backend has `src/types/websocket.ts`
   - Tests define their own types
   - No single source of truth

**Architecture Review Decision:**
After first principles analysis ([WEBSOCKET_API_ANALYSIS.md](../../design/WEBSOCKET_API_ANALYSIS.md)), **the implementation is CORRECT**. The STATE_UPDATE design aligns with SyncKairos architecture principles ("Calculate, Don't Count", distributed-first, state synchronization).

**Impact:**
- E2E tests testing non-existent API
- Documentation describing wrong protocol
- Developer confusion about correct API
- False confidence in test coverage

---

## Success Criteria

### Phase 1: Fix Tests to Match Implementation ✅

- [ ] Update E2E tests to listen for `STATE_UPDATE` events
- [ ] Remove fake event types (`session_started`, `participant_switched`, etc.)
- [ ] Fix WebSocket connection to use `sessionId` (remove invalid `participant_id`)
- [ ] Tests detect state transitions by comparing state changes
- [ ] All E2E tests pass with correct API

### Phase 2: Create Shared Zod Schemas ✅

- [ ] Create schemas for ACTUAL WebSocket events (from `src/types/websocket.ts`)
- [ ] Create schemas for REST API endpoints
- [ ] Backend uses Zod for runtime validation
- [ ] E2E tests use same schemas for type safety
- [ ] Contract tests validate schema consistency

### Phase 3: Document Correct API ✅

- [ ] Create `docs/api/WEBSOCKET.md` with STATE_UPDATE specification
- [ ] Update `docs/design/API_REFERENCE.md` to match implementation
- [ ] Document state transition detection patterns for clients
- [ ] Add client usage examples (React/Vue)
- [ ] Create migration guide explaining the design decision

### Quality Assurance ✅

- [ ] All E2E tests pass
- [ ] All contract tests pass
- [ ] TypeScript compiles without errors
- [ ] No breaking changes to existing functionality
- [ ] Documentation reviewed for accuracy

---

## Implementation Plan

### Morning: Fix E2E Tests (4 hours)

#### 1. Update WebSocket Test to Use STATE_UPDATE (2 hours)

**File:** `tests/e2e/multi-client-websocket.e2e.test.ts`

**Before (WRONG - testing non-existent API):**
```typescript
// ❌ This API doesn't exist!
const startEvent = await waitForEvent(client1, 'session_started')
expect(startEvent.data.status).toBe('running')

const switchEvent = await waitForEvent(client1, 'participant_switched')
expect(switchEvent.data.new_active_participant_id).toBe('p2')
```

**After (CORRECT - testing actual API):**
```typescript
import type { ServerMessage, WSStateUpdateMessage } from '../../src/types/websocket'

// Helper: Wait for STATE_UPDATE with specific condition
async function waitForStateUpdate(
  client: WebSocketClient,
  condition: (state: SyncState) => boolean,
  timeoutMs: number = 2000
): Promise<WSStateUpdateMessage> {
  const startTime = Date.now()

  while (Date.now() - startTime < timeoutMs) {
    const msg = client.receivedEvents.find(
      e => e.type === 'STATE_UPDATE' && condition(e.state)
    )
    if (msg) return msg
    await new Promise(resolve => setTimeout(resolve, 50))
  }

  throw new Error('Timeout waiting for STATE_UPDATE')
}

test('multi-client WebSocket synchronization @critical @websocket', async ({ request }) => {
  const env = getEnvironment()
  const sessionId = `e2e-ws-${Date.now()}`
  let client1: WebSocketClient | null = null
  let client2: WebSocketClient | null = null
  let client3: WebSocketClient | null = null

  try {
    // 1. Create session
    await request.post(`${env.baseURL}/v1/sessions`, {
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

    // 2. Connect 3 WebSocket clients (NO participant_id parameter!)
    client1 = await createWebSocketClient(sessionId, env.wsURL)
    client2 = await createWebSocketClient(sessionId, env.wsURL)
    client3 = await createWebSocketClient(sessionId, env.wsURL)

    // 3. All clients should receive CONNECTED message
    await waitForEvent(client1, 'CONNECTED')
    await waitForEvent(client2, 'CONNECTED')
    await waitForEvent(client3, 'CONNECTED')

    // 4. Start session - all clients receive STATE_UPDATE with status='running'
    const broadcastStartTime = Date.now()
    await request.post(`${env.baseURL}/v1/sessions/${sessionId}/start`)

    const update1 = await waitForStateUpdate(client1, s => s.status === 'running')
    const update2 = await waitForStateUpdate(client2, s => s.status === 'running')
    const update3 = await waitForStateUpdate(client3, s => s.status === 'running')

    // Verify state content
    expect(update1.state.status).toBe('running')
    expect(update1.state.active_participant_id).toBe('p1')
    expect(update2.state.active_participant_id).toBe('p1')
    expect(update3.state.active_participant_id).toBe('p1')

    // Verify broadcast latency <100ms
    const broadcastLatency = Math.max(
      update1.timestamp - broadcastStartTime,
      update2.timestamp - broadcastStartTime,
      update3.timestamp - broadcastStartTime
    )
    expect(broadcastLatency).toBeLessThan(100)
    console.log(`✅ STATE_UPDATE broadcast latency: ${broadcastLatency}ms`)

    // 5. Switch participant - all clients receive STATE_UPDATE with new active participant
    client1.receivedEvents = []
    client2.receivedEvents = []
    client3.receivedEvents = []

    const switchStartTime = Date.now()
    await request.post(`${env.baseURL}/v1/sessions/${sessionId}/switch`)

    const switch1 = await waitForStateUpdate(client1, s => s.active_participant_id === 'p2')
    const switch2 = await waitForStateUpdate(client2, s => s.active_participant_id === 'p2')
    const switch3 = await waitForStateUpdate(client3, s => s.active_participant_id === 'p2')

    expect(switch1.state.active_participant_id).toBe('p2')
    expect(switch2.state.active_participant_id).toBe('p2')
    expect(switch3.state.active_participant_id).toBe('p2')

    const switchLatency = Date.now() - switchStartTime
    expect(switchLatency).toBeLessThan(100)
    console.log(`✅ Switch broadcast latency: ${switchLatency}ms`)

    // 6. Pause - all clients receive STATE_UPDATE with status='paused'
    client1.receivedEvents = []
    client2.receivedEvents = []
    client3.receivedEvents = []

    await request.post(`${env.baseURL}/v1/sessions/${sessionId}/pause`)

    const pause1 = await waitForStateUpdate(client1, s => s.status === 'paused')
    const pause2 = await waitForStateUpdate(client2, s => s.status === 'paused')
    const pause3 = await waitForStateUpdate(client3, s => s.status === 'paused')

    expect(pause1.state.status).toBe('paused')
    expect(pause2.state.status).toBe('paused')
    expect(pause3.state.status).toBe('paused')

    // 7. Resume - all clients receive STATE_UPDATE with status='running'
    client1.receivedEvents = []
    client2.receivedEvents = []
    client3.receivedEvents = []

    await request.post(`${env.baseURL}/v1/sessions/${sessionId}/resume`)

    const resume1 = await waitForStateUpdate(client1, s => s.status === 'running')
    const resume2 = await waitForStateUpdate(client2, s => s.status === 'running')
    const resume3 = await waitForStateUpdate(client3, s => s.status === 'running')

    expect(resume1.state.status).toBe('running')
    expect(resume2.state.status).toBe('running')
    expect(resume3.state.status).toBe('running')

    // 8. Complete - all clients receive STATE_UPDATE with status='completed'
    client1.receivedEvents = []
    client2.receivedEvents = []
    client3.receivedEvents = []

    await request.post(`${env.baseURL}/v1/sessions/${sessionId}/complete`)

    const complete1 = await waitForStateUpdate(client1, s => s.status === 'completed')
    const complete2 = await waitForStateUpdate(client2, s => s.status === 'completed')
    const complete3 = await waitForStateUpdate(client3, s => s.status === 'completed')

    expect(complete1.state.status).toBe('completed')
    expect(complete2.state.status).toBe('completed')
    expect(complete3.state.status).toBe('completed')

    console.log(`✅ Multi-client STATE_UPDATE synchronization validated`)
  } finally {
    // Cleanup
    if (client1) await closeWebSocketClient(client1)
    if (client2) await closeWebSocketClient(client2)
    if (client3) await closeWebSocketClient(client3)

    try {
      await request.delete(`${env.baseURL}/v1/sessions/${sessionId}`)
      console.log(`🧹 Cleaned up session: ${sessionId}`)
    } catch (error) {
      console.warn(`⚠️ Cleanup failed for session: ${sessionId}`)
    }
  }
})
```

**Updated Helper Function:**
```typescript
async function createWebSocketClient(
  sessionId: string,
  wsURL: string
): Promise<WebSocketClient> {
  const client: WebSocketClient = {
    ws: new WebSocket(`${wsURL}?sessionId=${sessionId}`), // ✅ Correct parameter
    receivedEvents: [],
    sessionId
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`WebSocket connection timeout`))
    }, 5000)

    client.ws.on('open', () => {
      clearTimeout(timeout)
      resolve(client)
    })

    client.ws.on('message', (data: WebSocket.Data) => {
      const message: ServerMessage = JSON.parse(data.toString())
      client.receivedEvents.push(message)
    })

    client.ws.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
  })
}
```

**Acceptance Criteria:**
- [ ] Test uses `STATE_UPDATE` instead of fake event types
- [ ] WebSocket connection uses `sessionId` (correct parameter)
- [ ] State transitions detected by comparing state
- [ ] Broadcast latency <100ms validated
- [ ] Test passes against actual implementation

---

#### 2. Remove Invalid Tests (30 minutes)

**Delete or fix:**
- [ ] Remove `time_updated` event test (STATE_UPDATE includes time)
- [ ] Remove `participant_switched` event expectations
- [ ] Remove `session_paused/resumed/completed` event expectations

**Replace with:**
- [ ] State transition detection tests
- [ ] Full state validation tests

---

#### 3. Test Reconnection with STATE_SYNC (1 hour)

```typescript
test('WebSocket reconnection receives STATE_SYNC @websocket', async ({ request }) => {
  const env = getEnvironment()
  const sessionId = `e2e-ws-reconnect-${Date.now()}`
  let client: WebSocketClient | null = null

  try {
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

    client = await createWebSocketClient(sessionId, env.wsURL)
    await waitForEvent(client, 'CONNECTED')

    await request.post(`${env.baseURL}/v1/sessions/${sessionId}/start`)
    await waitForStateUpdate(client, s => s.status === 'running')

    // Disconnect
    await closeWebSocketClient(client)

    // Perform switchCycle while disconnected
    await request.post(`${env.baseURL}/v1/sessions/${sessionId}/switch`)

    // Reconnect
    client = await createWebSocketClient(sessionId, env.wsURL)
    await waitForEvent(client, 'CONNECTED')

    // Send RECONNECT message
    client.ws.send(JSON.stringify({ type: 'RECONNECT' }))

    // Should receive STATE_SYNC with current state
    const sync = await waitForEvent(client, 'STATE_SYNC')
    expect(sync.type).toBe('STATE_SYNC')
    expect(sync.state.active_participant_id).toBe('p2') // Switched while disconnected
    expect(sync.state.status).toBe('running')

    console.log(`✅ STATE_SYNC received after reconnection`)
  } finally {
    if (client) await closeWebSocketClient(client)
    try {
      await request.delete(`${env.baseURL}/v1/sessions/${sessionId}`)
    } catch (error) {
      // Cleanup failed
    }
  }
})
```

---

### Afternoon: Zod Schemas & Documentation (4 hours)

#### 4. Create Zod Schemas for ACTUAL API (1.5 hours)

**File:** `src/types/api-contracts.ts`

```typescript
import { z } from 'zod'
import { SyncStateSchema } from './session' // Assuming this exists

// ============================================================================
// WebSocket Connection
// ============================================================================

export const WebSocketConnectionParamsSchema = z.object({
  sessionId: z.string().uuid() // ✅ camelCase, not snake_case
})

export type WebSocketConnectionParams = z.infer<typeof WebSocketConnectionParamsSchema>

// ============================================================================
// Server → Client Messages
// ============================================================================

export const WSConnectedMessageSchema = z.object({
  type: z.literal('CONNECTED'),
  sessionId: z.string().uuid(),
  timestamp: z.number().int().positive()
})

export const WSStateUpdateMessageSchema = z.object({
  type: z.literal('STATE_UPDATE'),
  sessionId: z.string().uuid(),
  timestamp: z.number().int().positive(),
  state: SyncStateSchema // Full session state
})

export const WSStateSyncMessageSchema = z.object({
  type: z.literal('STATE_SYNC'),
  sessionId: z.string().uuid(),
  timestamp: z.number().int().positive(),
  state: SyncStateSchema
})

export const WSSessionDeletedMessageSchema = z.object({
  type: z.literal('SESSION_DELETED'),
  sessionId: z.string().uuid(),
  timestamp: z.number().int().positive()
})

export const WSPongMessageSchema = z.object({
  type: z.literal('PONG'),
  timestamp: z.number().int().positive()
})

export const WSErrorMessageSchema = z.object({
  type: z.literal('ERROR'),
  code: z.string(),
  message: z.string()
})

export const ServerMessageSchema = z.discriminatedUnion('type', [
  WSConnectedMessageSchema,
  WSStateUpdateMessageSchema,
  WSStateSyncMessageSchema,
  WSSessionDeletedMessageSchema,
  WSPongMessageSchema,
  WSErrorMessageSchema
])

export type ServerMessage = z.infer<typeof ServerMessageSchema>

// ============================================================================
// Client → Server Messages
// ============================================================================

export const WSPingMessageSchema = z.object({
  type: z.literal('PING')
})

export const WSReconnectMessageSchema = z.object({
  type: z.literal('RECONNECT')
})

export const ClientMessageSchema = z.discriminatedUnion('type', [
  WSPingMessageSchema,
  WSReconnectMessageSchema
])

export type ClientMessage = z.infer<typeof ClientMessageSchema>
```

**Acceptance Criteria:**
- [ ] Schemas match `src/types/websocket.ts` exactly
- [ ] All message types have schemas
- [ ] Connection params use `sessionId` (camelCase)
- [ ] No fake event types (`session_started`, etc.)

---

#### 5. Create WebSocket Documentation (1.5 hours)

**File:** `docs/api/WEBSOCKET.md`

Use the specification from [WEBSOCKET_API_ANALYSIS.md](../../design/WEBSOCKET_API_ANALYSIS.md) sections "Revised WebSocket API Specification".

**Key sections:**
- Connection (ws://localhost:3000/ws?sessionId=<uuid>)
- Server → Client events (CONNECTED, STATE_UPDATE, STATE_SYNC, SESSION_DELETED, PONG, ERROR)
- Client → Server messages (PING, RECONNECT)
- State transition detection patterns
- Client usage examples

**Acceptance Criteria:**
- [ ] Complete protocol specification
- [ ] STATE_UPDATE design explained
- [ ] State transition patterns documented
- [ ] React/Vue usage examples included
- [ ] Explains why not event-driven (references WEBSOCKET_API_ANALYSIS.md)

---

#### 6. Create Contract Tests (1 hour)

**File:** `tests/contract/websocket-schemas.test.ts`

```typescript
import { describe, test, expect } from 'vitest'
import {
  WebSocketConnectionParamsSchema,
  WSStateUpdateMessageSchema,
  WSConnectedMessageSchema,
  ServerMessageSchema
} from '../../src/types/api-contracts'

describe('WebSocket API Contracts', () => {
  test('connection params require sessionId (camelCase)', () => {
    const valid = { sessionId: '550e8400-e29b-41d4-a716-446655440000' }
    expect(() => WebSocketConnectionParamsSchema.parse(valid)).not.toThrow()
  })

  test('connection params reject session_id (snake_case)', () => {
    const invalid = { session_id: '550e8400-e29b-41d4-a716-446655440000' }
    expect(() => WebSocketConnectionParamsSchema.parse(invalid)).toThrow()
  })

  test('connection params reject participant_id', () => {
    const invalid = {
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      participant_id: 'p1'
    }
    expect(() => WebSocketConnectionParamsSchema.parse(invalid)).toThrow()
  })

  test('STATE_UPDATE message validates correctly', () => {
    const message = {
      type: 'STATE_UPDATE',
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      timestamp: Date.now(),
      state: {
        status: 'running',
        active_participant_id: 'p1',
        time_remaining_ms: 300000,
        // ... full state
      }
    }
    expect(() => WSStateUpdateMessageSchema.parse(message)).not.toThrow()
  })

  test('fake event types are not valid', () => {
    const fakeEvent = {
      event_type: 'session_started', // ❌ Wrong!
      data: {}
    }
    expect(() => ServerMessageSchema.parse(fakeEvent)).toThrow()
  })

  test('CONNECTED message validates correctly', () => {
    const message = {
      type: 'CONNECTED',
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      timestamp: Date.now()
    }
    expect(() => WSConnectedMessageSchema.parse(message)).not.toThrow()
  })
})
```

---

### Evening: Update Documentation & Issues (2 hours)

#### 7. Update API_REFERENCE.md (30 minutes)

**File:** `docs/design/API_REFERENCE.md`

Update WebSocket section (around line 325) to match the correct STATE_UPDATE protocol.

---

#### 8. Update ISSUES.md (30 minutes)

**File:** `docs/testing/e2e/ISSUES.md`

Move WebSocket Parameter Mismatch from Open → Resolved:

```markdown
### ✅ Issue #R8: WebSocket API Design Mismatch

**Resolved:** 2025-10-24
**Resolution:** Fixed E2E tests to match correct STATE_UPDATE architecture

**Problem:** E2E tests expected granular events (`session_started`, `participant_switched`) but implementation correctly uses STATE_UPDATE with full state.

**Root Cause:** Tests based on incorrect event-driven assumption without architecture validation.

**Architecture Decision:** After first principles analysis, STATE_UPDATE design is CORRECT because:
- Aligns with "Calculate, Don't Count" principle
- Distributed-first resilient (clients always have complete state)
- Simpler implementation (2 events vs 6+)
- Follows proven patterns (Firebase, Supabase, multiplayer games)
- Better for reconnection (no event replay needed)

**Resolution:**
- Updated E2E tests to listen for STATE_UPDATE events
- Removed fake event types from tests
- Fixed WebSocket connection to use sessionId (correct parameter)
- Created comprehensive documentation explaining design decision
- Added contract tests to prevent future drift

**Files Changed:**
- `tests/e2e/multi-client-websocket.e2e.test.ts` - Fixed to use STATE_UPDATE
- `src/types/api-contracts.ts` - Zod schemas for actual API
- `docs/api/WEBSOCKET.md` - Correct specification
- `docs/design/WEBSOCKET_API_ANALYSIS.md` - Architecture analysis
- `tests/contract/websocket-schemas.test.ts` - Contract validation

**Key Lesson:** Always validate test assumptions against architecture principles!
```

---

#### 9. Create Client Integration Guide (1 hour)

**File:** `docs/api/CLIENT_INTEGRATION.md`

```markdown
# Client Integration Guide - WebSocket State Synchronization

## Overview

SyncKairos uses **state synchronization** (not event-driven) WebSocket protocol. This means:
- Server sends full state on every change
- Clients don't need to maintain state from events
- Resilient to missed messages
- Aligns with "Calculate, Don't Count" principle

## Connection

```typescript
const ws = new WebSocket(`ws://localhost:3000/ws?sessionId=${sessionId}`)
```

**Important:** Use `sessionId` (camelCase), not `session_id` or `participant_id`.

## Handling STATE_UPDATE

```typescript
ws.onmessage = (event) => {
  const message = JSON.parse(event.data)

  if (message.type === 'STATE_UPDATE') {
    // Full state available
    const state = message.state

    // Update UI
    setStatus(state.status)
    setActiveParticipant(state.active_participant_id)
    setTimeRemaining(state.time_remaining_ms)

    // Calculate actual time remaining (following "Calculate, Don't Count")
    const now = Date.now()
    const cycleStarted = new Date(state.cycle_started_at).getTime()
    const elapsed = now - cycleStarted
    const actualTimeRemaining = state.time_remaining_ms - elapsed

    // Detect state transitions
    if (prevState.status === 'pending' && state.status === 'running') {
      onSessionStarted()
    }
    if (prevState.active_participant_id !== state.active_participant_id) {
      onParticipantSwitched(state.active_participant_id)
    }
    if (prevState.status === 'running' && state.status === 'paused') {
      onSessionPaused()
    }
  }
}
```

## React Hook Example

```typescript
function useSyncKairosSession(sessionId: string) {
  const [state, setState] = useState<SyncState | null>(null)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    const ws = new WebSocket(`ws://localhost:3000/ws?sessionId=${sessionId}`)

    ws.onopen = () => setConnected(true)

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data)

      switch (message.type) {
        case 'CONNECTED':
          console.log('WebSocket connected')
          break

        case 'STATE_UPDATE':
        case 'STATE_SYNC':
          setState(message.state)
          break

        case 'SESSION_DELETED':
          setState(null)
          ws.close()
          break
      }
    }

    ws.onclose = () => setConnected(false)

    return () => ws.close()
  }, [sessionId])

  return { state, connected }
}
```

## Reconnection Handling

```typescript
ws.onopen = () => {
  // Request full state sync after reconnection
  ws.send(JSON.stringify({ type: 'RECONNECT' }))
}

ws.onmessage = (event) => {
  const message = JSON.parse(event.data)

  if (message.type === 'STATE_SYNC') {
    // Received full state after reconnection
    setState(message.state)
    console.log('State synchronized after reconnection')
  }
}
```

## Why STATE_UPDATE Instead of Events?

See [WEBSOCKET_API_ANALYSIS.md](../design/WEBSOCKET_API_ANALYSIS.md) for detailed architecture analysis.

**TLDR:** State synchronization is more resilient, simpler, and aligns with SyncKairos distributed-first architecture.
```

---

## Deliverables

### Code Artifacts
- [ ] `src/types/api-contracts.ts` - Zod schemas for ACTUAL API
- [ ] Updated `tests/e2e/multi-client-websocket.e2e.test.ts` - Fixed to use STATE_UPDATE
- [ ] `tests/contract/websocket-schemas.test.ts` - Contract validation

### Documentation
- [ ] `docs/api/WEBSOCKET.md` - Correct STATE_UPDATE specification
- [ ] `docs/api/CLIENT_INTEGRATION.md` - Client usage guide
- [ ] `docs/design/WEBSOCKET_API_ANALYSIS.md` - Architecture decision (created ✅)
- [ ] Updated `docs/design/API_REFERENCE.md` - Fixed WebSocket section
- [ ] Updated `docs/testing/e2e/ISSUES.md` - Issue resolved

### Quality Assurance
- [ ] All E2E tests pass
- [ ] All contract tests pass
- [ ] TypeScript compiles without errors
- [ ] No breaking changes to existing functionality
- [ ] Architecture validated and documented

---

## Testing Checklist

### E2E Tests
- [ ] Multi-client STATE_UPDATE synchronization test passes
- [ ] WebSocket reconnection with STATE_SYNC test passes
- [ ] No fake event types in tests
- [ ] WebSocket connection uses `sessionId` parameter
- [ ] Broadcast latency <100ms validated

### Contract Tests
- [ ] Schema tests pass for all message types
- [ ] Connection params validate correctly
- [ ] Fake event types rejected
- [ ] CI/CD runs contract tests

### Manual Testing
- [ ] Start local server
- [ ] Connect WebSocket client
- [ ] Verify CONNECTED message received
- [ ] Create and start session
- [ ] Verify STATE_UPDATE received
- [ ] Perform switchCycle
- [ ] Verify STATE_UPDATE with new active participant
- [ ] Pause/resume/complete
- [ ] Verify STATE_UPDATEs for each transition

---

## Success Metrics

- ✅ **Zero** documentation-implementation mismatches
- ✅ **100%** E2E tests test actual API (not fake events)
- ✅ **100%** API contracts defined in Zod schemas
- ✅ Contract tests run in CI/CD pipeline
- ✅ Architecture decision documented with first principles analysis

---

## Time Breakdown

| Task | Time | Notes |
|------|------|-------|
| Fix E2E tests (STATE_UPDATE) | 2h | Core test updates |
| Remove invalid tests | 0.5h | Delete fake event tests |
| Test reconnection (STATE_SYNC) | 1h | New test |
| Create Zod schemas | 1.5h | Match existing types |
| Create WEBSOCKET.md | 1.5h | Complete spec |
| Create contract tests | 1h | Schema validation |
| Update API_REFERENCE.md | 0.5h | Fix WebSocket section |
| Update ISSUES.md | 0.5h | Document resolution |
| Create CLIENT_INTEGRATION.md | 1h | Usage guide |
| Testing & validation | 2h | End-to-end verification |
| **Total** | **11.5h** | ~1.5 days |

---

## Status Tracking

**Overall Progress:** 0% ⚪ Pending

**Phase Breakdown:**
- [ ] Morning: Fix E2E Tests (0/3 tasks)
- [ ] Afternoon: Schemas & Docs (0/3 tasks)
- [ ] Evening: Documentation (0/3 tasks)

**Last Updated:** 2025-10-24
**Assigned To:** Tester + Developer Collaboration
**Blocked By:** None - Ready to start!

---

## Notes

**Critical Insight:** This task fixes E2E tests that were testing a **non-existent API**. The tests assumed an event-driven WebSocket protocol when the correct design is state synchronization.

**Architecture Decision:** After first principles analysis ([WEBSOCKET_API_ANALYSIS.md](../../design/WEBSOCKET_API_ANALYSIS.md)), the STATE_UPDATE design is confirmed as CORRECT.

**Key Lesson:** Tests revealed a design assumption that was never validated against architecture principles. This is exactly what good testing should do!
