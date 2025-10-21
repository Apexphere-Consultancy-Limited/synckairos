# Phase 2: Business Logic & API (Week 2)

**Goal:** Implement SyncEngine and REST API endpoints
**Duration:** 5-7 days
**Status:** ⚪ Pending
**Progress:** 0%
**Dependencies:** Phase 1 (RedisStateManager must be complete)
**Target Completion:** End of Week 2

---

## Overview

Phase 2 builds the business logic layer (SyncEngine) and exposes it via REST API and WebSocket. The **SyncEngine** contains all the time calculation logic and session management. The **REST API** provides HTTP endpoints for session control. The **WebSocket Server** enables real-time updates to all clients.

**Key Focus:** Hot path optimization - switchCycle() must be <50ms (target: 3-5ms).

---

## Component 2.1: SyncEngine Implementation

**Estimated Time:** 2-3 days
**Status:** ⚪ Pending
**Priority:** ⭐ **CRITICAL PATH**
**Dependencies:** RedisStateManager (Phase 1)

### Tasks

#### Core Session Methods (Day 1)

- [ ] Create `src/engine/SyncEngine.ts`

- [ ] Setup constructor
  - [ ] Accept `RedisStateManager` instance
  - [ ] Store as private property

- [ ] Implement `createSession(config): Promise<SyncState>`
  - [ ] Validate config (session_id, sync_mode, participants)
  - [ ] Initialize SyncState object (status: 'pending', version: 1)
  - [ ] Create participants array with initial state
  - [ ] Call `stateManager.createSession(state)`
  - [ ] Return created state

- [ ] Implement `startSession(sessionId): Promise<SyncState>`
  - [ ] Get session from RedisStateManager
  - [ ] Validate status is 'pending'
  - [ ] Set status to 'running'
  - [ ] Set active_participant_id to first participant
  - [ ] Set cycle_started_at to current server time
  - [ ] Mark first participant as active
  - [ ] Increment version
  - [ ] Update via RedisStateManager
  - [ ] Return updated state

#### Hot Path: Switch Cycle (Day 1-2) ⭐

- [ ] Implement `switchCycle(sessionId, currentParticipantId?, nextParticipantId?): Promise<SwitchCycleResult>`
  - [ ] Get session from RedisStateManager
  - [ ] Validate status is 'running'
  - [ ] **Capture expectedVersion for optimistic locking**
  - [ ] Calculate elapsed time: `now - cycle_started_at`
  - [ ] Update current participant:
    - [ ] Add elapsed to `time_used_ms`
    - [ ] Subtract elapsed from `total_time_ms`
    - [ ] Increment `cycle_count`
    - [ ] Set `is_active = false`
    - [ ] Check if expired (`total_time_ms <= 0`)
    - [ ] Add increment time if configured
  - [ ] Determine next participant (provided or auto-advance)
  - [ ] Update state:
    - [ ] Set `active_participant_id`
    - [ ] Set `cycle_started_at = now`
    - [ ] Set next participant `is_active = true`
    - [ ] Increment version
  - [ ] Update via RedisStateManager with optimistic locking
  - [ ] Return result with expired participant info
  - [ ] **Target latency:** <50ms (achieve: 3-5ms)

#### Other Session Methods (Day 2)

- [ ] Implement `getCurrentState(sessionId): Promise<SyncState>`
  - [ ] Get from RedisStateManager
  - [ ] Throw error if not found
  - [ ] Return state (client will calculate remaining time)

- [ ] Implement `pauseSession(sessionId): Promise<SyncState>`
  - [ ] Get session, validate status is 'running'
  - [ ] Calculate time used before pausing
  - [ ] Update active participant time
  - [ ] Set status to 'paused'
  - [ ] Clear cycle_started_at
  - [ ] Increment version
  - [ ] Update and return

- [ ] Implement `resumeSession(sessionId): Promise<SyncState>`
  - [ ] Get session, validate status is 'paused'
  - [ ] Set status to 'running'
  - [ ] Set cycle_started_at to now
  - [ ] Increment version
  - [ ] Update and return

- [ ] Implement `completeSession(sessionId): Promise<SyncState>`
  - [ ] Get session
  - [ ] Set status to 'completed'
  - [ ] Clear cycle_started_at
  - [ ] Set all participants is_active = false
  - [ ] Increment version
  - [ ] Update and return

- [ ] Implement `deleteSession(sessionId): Promise<void>`
  - [ ] Call `stateManager.deleteSession(sessionId)`

#### Unit Tests (Day 3)

- [ ] Create `tests/unit/SyncEngine.test.ts`

- [ ] Test session lifecycle
  - [ ] createSession() initializes correctly
  - [ ] startSession() activates first participant
  - [ ] completeSession() marks session done

- [ ] Test switchCycle() - **CRITICAL**
  - [ ] Time calculations accurate
  - [ ] Participant rotation works
  - [ ] Increment time added correctly
  - [ ] Expiration detected
  - [ ] Optimistic locking prevents concurrent updates

- [ ] Test pause/resume
  - [ ] Pause saves time correctly
  - [ ] Resume continues from saved state

- [ ] Test all sync modes
  - [ ] per_participant mode
  - [ ] per_cycle mode
  - [ ] per_group mode
  - [ ] global mode
  - [ ] count_up mode

### Acceptance Criteria
- [ ] All session methods implemented
- [ ] switchCycle() latency <50ms (target: 3-5ms)
- [ ] Time calculations accurate (±5ms)
- [ ] Unit tests >85% coverage
- [ ] Edge cases handled (expiration, invalid transitions)

### Files Created
- `src/engine/SyncEngine.ts`
- `src/types/switch-result.ts`
- `tests/unit/SyncEngine.test.ts`

---

## Component 2.2: REST API Implementation

**Estimated Time:** 2-3 days
**Status:** ⚪ Pending
**Priority:** ⭐ **CRITICAL PATH**
**Dependencies:** SyncEngine

### Tasks

#### Express Setup (Day 1 Morning)

- [ ] Create `src/api/app.ts`
  - [ ] Initialize Express app
  - [ ] Add CORS middleware
  - [ ] Add JSON body parser
  - [ ] Add Pino request logging (pino-http)
  - [ ] Add error handling middleware

- [ ] Create `src/index.ts`
  - [ ] Import app
  - [ ] Start HTTP server
  - [ ] Setup graceful shutdown

#### Endpoints (Day 1-2)

- [ ] Create `src/api/routes/sessions.ts`

- [ ] POST `/v1/sessions` - Create session
  - [ ] Validate request body
  - [ ] Call `syncEngine.createSession()`
  - [ ] Return 201 with session data

- [ ] POST `/v1/sessions/:id/start` - Start session
  - [ ] Get session_id from params
  - [ ] Call `syncEngine.startSession()`
  - [ ] Return 200 with updated state

- [ ] POST `/v1/sessions/:id/switch` - Switch cycle ⭐ **HOT PATH**
  - [ ] Get session_id from params
  - [ ] Get optional next_participant_id from body
  - [ ] Call `syncEngine.switchCycle()`
  - [ ] Return 200 with switch result
  - [ ] **Target total latency:** <50ms

- [ ] GET `/v1/sessions/:id` - Get session state
  - [ ] Get session_id from params
  - [ ] Call `syncEngine.getCurrentState()`
  - [ ] Return 200 with state

- [ ] POST `/v1/sessions/:id/pause` - Pause session
  - [ ] Call `syncEngine.pauseSession()`
  - [ ] Return 200

- [ ] POST `/v1/sessions/:id/resume` - Resume session
  - [ ] Call `syncEngine.resumeSession()`
  - [ ] Return 200

- [ ] POST `/v1/sessions/:id/complete` - Complete session
  - [ ] Call `syncEngine.completeSession()`
  - [ ] Return 200

- [ ] DELETE `/v1/sessions/:id` - Delete session
  - [ ] Call `syncEngine.deleteSession()`
  - [ ] Return 204

#### Server Time Endpoint

- [ ] Create `src/api/routes/time.ts`

- [ ] GET `/v1/time` - Server time sync
  - [ ] Return `{ timestamp_ms: Date.now() }`
  - [ ] Use for client time synchronization

#### Middlewares (Day 2)

- [ ] Create `src/api/middlewares/errorHandler.ts`
  - [ ] Catch all errors
  - [ ] Format error responses
  - [ ] Log errors with Pino
  - [ ] Return appropriate status codes

- [ ] Create `src/api/middlewares/rateLimit.ts`
  - [ ] Setup express-rate-limit with Redis store
  - [ ] General limiter: 100 req/min per IP
  - [ ] Hot path limiter: 10 req/sec per session for `/switch`

- [ ] Create `src/api/middlewares/auth.ts` (basic version)
  - [ ] JWT verification
  - [ ] Attach user to request
  - [ ] Skip for now if no auth required (add in Phase 3)

#### Integration Tests (Day 3)

- [ ] Create `tests/integration/api.test.ts`

- [ ] Test full session lifecycle via API
  - [ ] POST /sessions → 201
  - [ ] POST /sessions/:id/start → 200
  - [ ] POST /sessions/:id/switch → 200
  - [ ] GET /sessions/:id → 200
  - [ ] POST /sessions/:id/pause → 200
  - [ ] POST /sessions/:id/resume → 200
  - [ ] POST /sessions/:id/complete → 200
  - [ ] DELETE /sessions/:id → 204

- [ ] Test error responses
  - [ ] 404 for not found
  - [ ] 400 for invalid input
  - [ ] 409 for invalid state transitions
  - [ ] 429 for rate limiting

- [ ] Test rate limiting
  - [ ] Hit rate limit, get 429
  - [ ] Wait, then succeed

### Acceptance Criteria
- [ ] All 8 endpoints functional
- [ ] switchCycle endpoint <50ms latency
- [ ] Error handling works
- [ ] Rate limiting prevents abuse
- [ ] Integration tests passing

### Files Created
- `src/api/app.ts`
- `src/api/routes/sessions.ts`
- `src/api/routes/time.ts`
- `src/api/middlewares/errorHandler.ts`
- `src/api/middlewares/rateLimit.ts`
- `src/index.ts`
- `tests/integration/api.test.ts`

---

## Component 2.3: Request Validation (Zod)

**Estimated Time:** 1 day
**Status:** ⚪ Pending
**Priority:** Medium
**Dependencies:** REST API

### Tasks

- [ ] Create `src/api/schemas/session.ts`

- [ ] Define Zod schemas
  - [ ] `CreateSessionSchema`
  - [ ] `ParticipantSchema`
  - [ ] `SwitchCycleSchema`
  - [ ] `PauseResumeSchema`

- [ ] Create validation middleware
  - [ ] `src/api/middlewares/validate.ts`
  - [ ] Accept schema, validate req.body
  - [ ] Return 400 with Zod errors if invalid

- [ ] Apply to routes
  - [ ] Add validation middleware to each endpoint
  - [ ] POST /sessions
  - [ ] POST /sessions/:id/switch
  - [ ] Other endpoints as needed

- [ ] Unit tests
  - [ ] Test valid inputs pass
  - [ ] Test invalid inputs rejected with 400

### Acceptance Criteria
- [ ] All endpoints validated
- [ ] Invalid requests return 400 with clear errors
- [ ] Type inference working (TypeScript types from Zod)

### Files Created
- `src/api/schemas/session.ts`
- `src/api/middlewares/validate.ts`

---

## Component 2.4: WebSocket Server Implementation

**Estimated Time:** 2 days
**Status:** ⚪ Pending
**Priority:** ⭐ **CRITICAL PATH**
**Dependencies:** RedisStateManager, SyncEngine

### Tasks

#### WebSocket Setup (Day 1)

- [ ] Create `src/websocket/WebSocketServer.ts`

- [ ] Initialize WebSocket server
  - [ ] Import `ws` library
  - [ ] Create `WebSocket.Server` instance
  - [ ] Accept port parameter

- [ ] Handle connections
  - [ ] Parse `sessionId` from query params
  - [ ] Validate sessionId exists
  - [ ] Add client to session group: `Map<sessionId, Set<WebSocket>>`
  - [ ] Send connection acknowledgment

- [ ] Handle disconnections
  - [ ] Remove client from session group
  - [ ] Clean up empty groups

#### Redis Pub/Sub Integration (Day 1)

- [ ] Subscribe to Redis Pub/Sub
  - [ ] Call `stateManager.subscribeToWebSocket(callback)`
  - [ ] Callback receives (sessionId, message)
  - [ ] Forward message to all clients in that session

- [ ] Implement `broadcastToSession(sessionId, message): void`
  - [ ] Get all clients for sessionId
  - [ ] Send message to each if connection OPEN
  - [ ] JSON.stringify message

#### Heartbeat Mechanism (Day 1-2)

- [ ] Implement heartbeat
  - [ ] Send PING every 5 seconds
  - [ ] Mark connection `isAlive = true` on PONG
  - [ ] Terminate stale connections (`isAlive = false`)

- [ ] Handle client messages
  - [ ] PING → respond with PONG
  - [ ] RECONNECT → send full state sync

#### Testing (Day 2)

- [ ] Create `tests/integration/websocket.test.ts`

- [ ] Test connection/disconnection
  - [ ] Client connects successfully
  - [ ] Client added to session group
  - [ ] Client removed on disconnect

- [ ] Test message broadcasting
  - [ ] State update triggers WebSocket message
  - [ ] All clients in session receive update

- [ ] Test cross-instance broadcasting
  - [ ] Simulate 2 instances
  - [ ] Update on instance 1
  - [ ] Clients on instance 2 receive message via Redis Pub/Sub

- [ ] Test heartbeat
  - [ ] PING/PONG messages work
  - [ ] Stale connections terminated

### Acceptance Criteria
- [ ] WebSocket connections work
- [ ] Real-time updates delivered <100ms
- [ ] Cross-instance broadcasting via Redis Pub/Sub works
- [ ] Heartbeat keeps connections alive
- [ ] Integration tests passing

### Files Created
- `src/websocket/WebSocketServer.ts`
- `tests/integration/websocket.test.ts`

---

## Phase 2 Success Criteria

### Must Complete Before Phase 3

- [ ] ✅ SyncEngine fully implemented and tested
  - [ ] switchCycle() <50ms validated
  - [ ] All session methods working
  - [ ] Unit tests >85% coverage

- [ ] ✅ REST API functional
  - [ ] All 8 endpoints working
  - [ ] Error handling robust
  - [ ] Rate limiting active

- [ ] ✅ WebSocket real-time updates
  - [ ] Connections stable
  - [ ] Messages delivered <100ms
  - [ ] Cross-instance broadcasting confirmed

- [ ] ✅ Integration tests passing
  - [ ] Full session lifecycle works end-to-end
  - [ ] WebSocket updates received

### Performance Validation

| Operation | Target | Achieved | Status |
|-----------|--------|----------|--------|
| switchCycle() total | <50ms | ___ ms | ⚪ |
| WebSocket delivery | <100ms | ___ ms | ⚪ |
| API response time | <100ms | ___ ms | ⚪ |

---

## Progress Tracking

**Last Updated:** Not started

| Component | Status | Progress |
|-----------|--------|----------|
| 2.1 SyncEngine | ⚪ | 0% |
| 2.2 REST API | ⚪ | 0% |
| 2.3 Request Validation | ⚪ | 0% |
| 2.4 WebSocket Server | ⚪ | 0% |

**Overall Phase 2 Progress:** 0%
