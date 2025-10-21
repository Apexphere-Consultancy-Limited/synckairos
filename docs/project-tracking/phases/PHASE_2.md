# Phase 2: Business Logic & API (Week 2) - UPDATED

**Goal:** Implement SyncEngine and REST API endpoints
**Duration:** 6-8 days (updated from 5-7 days)
**Status:** ⚪ Pending
**Progress:** 0%
**Dependencies:** Phase 1 (RedisStateManager must be complete)
**Target Completion:** End of Week 2

---

## Overview

Phase 2 builds the business logic layer (SyncEngine) and exposes it via REST API and WebSocket. The **SyncEngine** contains all the time calculation logic and session management. The **REST API** provides HTTP endpoints for session control. The **WebSocket Server** enables real-time updates to all clients.

**Key Focus:** Hot path optimization - switchCycle() must be <50ms (target: 3-5ms).

**Updates in this version:**
- ✅ Fixed SyncEngine constructor (dependency injection)
- ✅ Enhanced error handling with custom error mapping
- ✅ Added Prometheus metrics
- ✅ Detailed multi-instance testing
- ✅ Enhanced graceful shutdown
- ✅ Improved rate limiting configuration
- ✅ Added state schema validation

---

## Component 2.1: SyncEngine Implementation

**Estimated Time:** 2-3 days
**Status:** ⚪ Pending
**Priority:** ⭐ **CRITICAL PATH**
**Dependencies:** RedisStateManager (Phase 1)

### Tasks

#### Pre-Implementation: Verify State Schema (Day 0 - 1 hour)

- [ ] Verify `src/types/session.ts` has required fields
  - [ ] Check `SyncParticipant` interface includes:
    - [ ] `time_remaining_ms?: number` (optional, for calculations)
  - [ ] Check `SyncState` interface includes:
    - [ ] `session_started_at?: Date` (when session moved to 'running')
    - [ ] `session_completed_at?: Date` (when session finished)
  - [ ] If missing, add these fields to the type definitions
  - [ ] **Reason:** DBWriteQueue expects these fields (see DBWriteQueue.ts:161-187)

#### Core Session Methods (Day 1)

- [ ] Create `src/engine/SyncEngine.ts`

- [ ] Setup constructor **[CRITICAL FIX]**
  - [ ] Accept `RedisStateManager` instance as parameter (NOT redisUrl)
  - [ ] Store as private property `stateManager`
  - [ ] **IMPORTANT:** Do NOT create RedisStateManager inside SyncEngine
  - [ ] **Reasoning:** Allows dependency injection, makes testing easier, enables shared Redis instance
  ```typescript
  // ✅ CORRECT
  constructor(stateManager: RedisStateManager) {
    this.stateManager = stateManager
  }

  // ❌ WRONG (from old IMPLEMENTATION.md)
  constructor(redisUrl: string) {
    this.stateManager = new RedisStateManager(redisUrl)
  }
  ```

- [ ] Implement `createSession(config): Promise<SyncState>`
  - [ ] Validate config (session_id, sync_mode, participants)
  - [ ] Initialize SyncState object:
    - [ ] Set `status: 'pending'`
    - [ ] Set `version: 1` (will be set by RedisStateManager)
    - [ ] Set `created_at: new Date()`
    - [ ] Set `session_started_at: undefined` (not started yet)
  - [ ] Create participants array with initial state:
    - [ ] `time_used_ms: 0`
    - [ ] `cycle_count: 0`
    - [ ] `is_active: false`
    - [ ] `has_expired: false`
  - [ ] Call `stateManager.createSession(state)`
  - [ ] Return created state

- [ ] Implement `startSession(sessionId): Promise<SyncState>`
  - [ ] Get session from RedisStateManager
  - [ ] Validate status is 'pending'
  - [ ] Update state:
    - [ ] Set `status: 'running'`
    - [ ] Set `active_participant_id` to first participant
    - [ ] Set `cycle_started_at: new Date()` (current server time)
    - [ ] Set `session_started_at: new Date()` (track when session started)
    - [ ] Mark first participant `is_active: true`
    - [ ] Increment version (handled by RedisStateManager)
  - [ ] Update via `stateManager.updateSession()`
  - [ ] Return updated state

#### Hot Path: Switch Cycle (Day 1-2) ⭐

- [ ] Implement `switchCycle(sessionId, currentParticipantId?, nextParticipantId?): Promise<SwitchCycleResult>`
  - [ ] Get session from RedisStateManager
  - [ ] Validate session exists (throw SessionNotFoundError if not)
  - [ ] Validate status is 'running' (throw error if not)
  - [ ] **Capture expectedVersion for optimistic locking** (critical for concurrency)
  - [ ] Calculate elapsed time: `now.getTime() - cycle_started_at.getTime()`
  - [ ] Update current participant:
    - [ ] Add elapsed to `time_used_ms`
    - [ ] Subtract elapsed from `total_time_ms`
    - [ ] Calculate `time_remaining_ms = Math.max(0, total_time_ms)` (for audit)
    - [ ] Increment `cycle_count`
    - [ ] Set `is_active = false`
    - [ ] Check if expired: `has_expired = total_time_ms <= 0`
    - [ ] Add increment time if configured: `total_time_ms += increment_ms`
  - [ ] Determine next participant:
    - [ ] If `nextParticipantId` provided, use it
    - [ ] Otherwise, auto-advance to next in rotation: `(currentIndex + 1) % participants.length`
    - [ ] Validate next participant exists
  - [ ] Update state:
    - [ ] Set `active_participant_id` to next participant
    - [ ] Set `cycle_started_at = new Date()` (reset cycle timer)
    - [ ] Set next participant `is_active = true`
    - [ ] Increment version (handled by updateSession)
  - [ ] Update via `stateManager.updateSession(sessionId, state, expectedVersion)`
    - [ ] **Pass expectedVersion for optimistic locking**
    - [ ] Catch ConcurrencyError and handle gracefully
  - [ ] Return `SwitchCycleResult`:
    - [ ] `session_id`
    - [ ] `active_participant_id`
    - [ ] `cycle_started_at`
    - [ ] `participants` (full array with updated times)
    - [ ] `status`
    - [ ] `expired_participant_id` (if someone expired)
  - [ ] **Target latency:** <50ms (expected: 3-5ms)

#### Other Session Methods (Day 2)

- [ ] Implement `getCurrentState(sessionId): Promise<SyncState>`
  - [ ] Get from `stateManager.getSession(sessionId)`
  - [ ] Throw `SessionNotFoundError` if not found
  - [ ] Return state as-is (client calculates remaining time on their end)
  - [ ] No time calculations needed here

- [ ] Implement `pauseSession(sessionId): Promise<SyncState>`
  - [ ] Get session, validate status is 'running'
  - [ ] Calculate time used before pausing:
    - [ ] `elapsed = now - cycle_started_at`
    - [ ] Add to active participant's `time_used_ms`
    - [ ] Subtract from active participant's `total_time_ms`
  - [ ] Update state:
    - [ ] Set `status: 'paused'`
    - [ ] Set `cycle_started_at: undefined` (no active cycle)
    - [ ] Increment version
  - [ ] Update via RedisStateManager
  - [ ] Return updated state

- [ ] Implement `resumeSession(sessionId): Promise<SyncState>`
  - [ ] Get session, validate status is 'paused'
  - [ ] Update state:
    - [ ] Set `status: 'running'`
    - [ ] Set `cycle_started_at: new Date()` (restart cycle timer)
    - [ ] Increment version
  - [ ] Update via RedisStateManager
  - [ ] Return updated state

- [ ] Implement `completeSession(sessionId): Promise<SyncState>`
  - [ ] Get session
  - [ ] Update state:
    - [ ] Set `status: 'completed'`
    - [ ] Set `session_completed_at: new Date()`
    - [ ] Set `cycle_started_at: undefined` (no active cycle)
    - [ ] Set all participants `is_active = false`
    - [ ] Increment version
  - [ ] Update via RedisStateManager
  - [ ] Return updated state

- [ ] Implement `deleteSession(sessionId): Promise<void>`
  - [ ] Call `stateManager.deleteSession(sessionId)`
  - [ ] This triggers Redis deletion + Pub/Sub broadcast

#### Unit Tests (Day 3)

- [ ] Create `tests/unit/SyncEngine.test.ts`

- [ ] Test session lifecycle
  - [ ] createSession() initializes state correctly
    - [ ] Status is 'pending'
    - [ ] Version is 1
    - [ ] All participants have initial values
  - [ ] startSession() activates first participant
    - [ ] Status changes to 'running'
    - [ ] First participant is active
    - [ ] `cycle_started_at` is set
    - [ ] `session_started_at` is set
  - [ ] completeSession() marks session done
    - [ ] Status changes to 'completed'
    - [ ] `session_completed_at` is set
    - [ ] All participants inactive

- [ ] Test switchCycle() - **CRITICAL**
  - [ ] Time calculations are accurate (±5ms)
    - [ ] Elapsed time calculated correctly
    - [ ] `time_used_ms` increases
    - [ ] `total_time_ms` decreases
  - [ ] Participant rotation works
    - [ ] Auto-advances to next participant
    - [ ] Wraps around to first after last
    - [ ] Respects explicit `nextParticipantId`
  - [ ] Increment time added correctly (Fischer mode)
    - [ ] `increment_ms` added after cycle
    - [ ] Only for non-expired participants
  - [ ] Expiration detected
    - [ ] `has_expired` set when time runs out
    - [ ] `expired_participant_id` returned in result
  - [ ] Optimistic locking prevents concurrent updates
    - [ ] ConcurrencyError thrown when version mismatch
    - [ ] State remains consistent

- [ ] Test pause/resume
  - [ ] Pause saves time correctly
    - [ ] Active participant time updated before pause
    - [ ] `cycle_started_at` cleared
  - [ ] Resume continues from saved state
    - [ ] `cycle_started_at` set to now
    - [ ] Time continues from paused value

- [ ] Test error handling
  - [ ] SessionNotFoundError when session doesn't exist
  - [ ] Error when invalid state transition (e.g., pause a pending session)
  - [ ] Error when participant not found

- [ ] Test all sync modes (basic validation)
  - [ ] per_participant mode
  - [ ] per_cycle mode
  - [ ] per_group mode
  - [ ] global mode
  - [ ] count_up mode
  - [ ] **Note:** Full sync mode logic is Phase 3, just validate basic flow

### Acceptance Criteria
- [ ] All session methods implemented
- [ ] Constructor uses dependency injection (accepts RedisStateManager)
- [ ] switchCycle() latency <50ms (target: 3-5ms)
- [ ] Time calculations accurate (±5ms)
- [ ] Unit tests >85% coverage
- [ ] Edge cases handled (expiration, invalid transitions, concurrency)
- [ ] Custom errors thrown appropriately

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
    - [ ] Configure allowed origins
    - [ ] Allow credentials for WebSocket upgrade
  - [ ] Add JSON body parser
  - [ ] Add Pino request logging (pino-http)
    - [ ] Log request ID, method, URL, duration
    - [ ] Exclude `/health` and `/metrics` from logs (reduce noise)
  - [ ] Mount route modules
  - [ ] Add error handling middleware (last middleware)

- [ ] Create `src/index.ts`
  - [ ] Import app, RedisStateManager, DBWriteQueue
  - [ ] Create shared instances:
    ```typescript
    const redis = createRedisClient()
    const pubSub = createRedisPubSubClient()
    const dbQueue = new DBWriteQueue(process.env.REDIS_URL!)
    const stateManager = new RedisStateManager(redis, pubSub, dbQueue)
    const syncEngine = new SyncEngine(stateManager)
    ```
  - [ ] Pass stateManager and syncEngine to app
  - [ ] Start HTTP server
  - [ ] Setup graceful shutdown **[ENHANCED]**:
    - [ ] Listen to SIGTERM, SIGINT signals
    - [ ] On shutdown:
      - [ ] Stop accepting new requests (`server.close()`)
      - [ ] Close WebSocket connections gracefully (send CLOSE frame)
      - [ ] Close Redis connections (`redis.quit()`, `pubSub.quit()`)
      - [ ] Close PostgreSQL pool (`pool.end()`)
      - [ ] Close DBWriteQueue (`dbQueue.close()`)
      - [ ] Exit after 15s timeout max
    - [ ] Log shutdown progress

#### Endpoints (Day 1-2)

- [ ] Create `src/api/routes/sessions.ts`

- [ ] POST `/v1/sessions` - Create session
  - [ ] Validate request body (Zod schema in Component 2.3)
  - [ ] Call `syncEngine.createSession(req.body)`
  - [ ] Return 201 with session data
  - [ ] Handle errors appropriately

- [ ] POST `/v1/sessions/:id/start` - Start session
  - [ ] Get session_id from `req.params.id`
  - [ ] Call `syncEngine.startSession(sessionId)`
  - [ ] Return 200 with updated state
  - [ ] Handle SessionNotFoundError → 404

- [ ] POST `/v1/sessions/:id/switch` - Switch cycle ⭐ **HOT PATH**
  - [ ] Get session_id from `req.params.id`
  - [ ] Get optional `next_participant_id` from `req.body`
  - [ ] Call `syncEngine.switchCycle(sessionId, undefined, next_participant_id)`
  - [ ] Return 200 with SwitchCycleResult
  - [ ] Handle ConcurrencyError → 409 Conflict
  - [ ] **Target total latency:** <50ms

- [ ] GET `/v1/sessions/:id` - Get session state
  - [ ] Get session_id from `req.params.id`
  - [ ] Call `syncEngine.getCurrentState(sessionId)`
  - [ ] Return 200 with state
  - [ ] Handle SessionNotFoundError → 404

- [ ] POST `/v1/sessions/:id/pause` - Pause session
  - [ ] Call `syncEngine.pauseSession(req.params.id)`
  - [ ] Return 200 with updated state

- [ ] POST `/v1/sessions/:id/resume` - Resume session
  - [ ] Call `syncEngine.resumeSession(req.params.id)`
  - [ ] Return 200 with updated state

- [ ] POST `/v1/sessions/:id/complete` - Complete session
  - [ ] Call `syncEngine.completeSession(req.params.id)`
  - [ ] Return 200 with updated state

- [ ] DELETE `/v1/sessions/:id` - Delete session
  - [ ] Call `syncEngine.deleteSession(req.params.id)`
  - [ ] Return 204 No Content

#### Server Time Endpoint

- [ ] Create `src/api/routes/time.ts`

- [ ] GET `/v1/time` - Server time sync **[ENHANCED]**
  - [ ] Return extended response:
    ```json
    {
      "timestamp_ms": Date.now(),
      "server_version": "2.0.0",
      "drift_tolerance_ms": 50
    }
    ```
  - [ ] Add CORS headers for cross-origin requests
  - [ ] Use for client time synchronization (NTP-style)

#### Health & Metrics Endpoints

- [ ] Create `src/api/routes/health.ts`
  - [ ] GET `/health` - Basic health check
    - [ ] Return 200 `{ status: 'ok' }`
  - [ ] GET `/ready` - Readiness check
    - [ ] Check Redis connection
    - [ ] Check PostgreSQL connection
    - [ ] Return 200 if all healthy, 503 otherwise

#### Middlewares (Day 2)

- [ ] Create `src/api/middlewares/errorHandler.ts` **[ENHANCED]**
  - [ ] Map custom errors to HTTP status codes:
    - [ ] `SessionNotFoundError` → 404
    - [ ] `ConcurrencyError` → 409 Conflict
    - [ ] `StateDeserializationError` → 500 Internal Server Error
    - [ ] `ZodError` (validation) → 400 Bad Request
    - [ ] Unknown errors → 500
  - [ ] Format error responses consistently:
    ```json
    {
      "error": {
        "code": "SESSION_NOT_FOUND",
        "message": "Session with ID abc123 not found",
        "details": { ... }
      }
    }
    ```
  - [ ] Log errors with Pino (include request ID, stack trace)
  - [ ] Hide internal details in production (no stack traces)

- [ ] Create `src/api/middlewares/rateLimit.ts` **[ENHANCED]**
  - [ ] Setup express-rate-limit with rate-limit-redis store
  - [ ] General limiter: 100 req/min per IP
    - [ ] `keyGenerator: (req) => req.ip`
    - [ ] Apply to all routes except `/health`, `/metrics`
  - [ ] Hot path limiter for `/switch`: 10 req/sec per session **[CLARIFIED]**
    - [ ] `keyGenerator: (req) => req.params.id` (sessionId)
    - [ ] Prevents abuse of specific sessions
    - [ ] Return 429 with Retry-After header
  - [ ] Store limits in Redis (shared across instances)

- [ ] Create `src/api/middlewares/auth.ts` (basic stub)
  - [ ] JWT verification (optional for Phase 2)
  - [ ] Attach user to request
  - [ ] Skip for now if no auth required
  - [ ] **Note:** Full implementation in Phase 3

#### Monitoring (Day 2-3) **[NEW]**

- [ ] Create `src/api/middlewares/metrics.ts`
  - [ ] Setup prom-client
  - [ ] Define metrics:
    - [ ] `synckairos_http_requests_total` (Counter)
      - [ ] Labels: method, route, status_code
    - [ ] `synckairos_http_request_duration_ms` (Histogram)
      - [ ] Labels: method, route
      - [ ] Buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000]
    - [ ] `synckairos_switch_cycle_duration_ms` (Histogram)
      - [ ] Special metric for hot path
      - [ ] Buckets: [1, 2, 3, 5, 10, 25, 50]
  - [ ] Middleware to record metrics on each request

- [ ] Create `src/api/routes/metrics.ts`
  - [ ] GET `/metrics` - Prometheus metrics endpoint
    - [ ] Return metrics in Prometheus text format
    - [ ] Set Content-Type: text/plain; version=0.0.4

#### Integration Tests (Day 3)

- [ ] Create `tests/integration/api.test.ts`

- [ ] Test full session lifecycle via API
  - [ ] POST `/v1/sessions` → 201 Created
    - [ ] Verify session created in Redis
  - [ ] POST `/v1/sessions/:id/start` → 200 OK
    - [ ] Verify status changed to 'running'
  - [ ] POST `/v1/sessions/:id/switch` → 200 OK
    - [ ] Verify active participant changed
    - [ ] Verify times updated correctly
  - [ ] GET `/v1/sessions/:id` → 200 OK
    - [ ] Verify state matches
  - [ ] POST `/v1/sessions/:id/pause` → 200 OK
  - [ ] POST `/v1/sessions/:id/resume` → 200 OK
  - [ ] POST `/v1/sessions/:id/complete` → 200 OK
  - [ ] DELETE `/v1/sessions/:id` → 204 No Content
    - [ ] Verify session deleted from Redis

- [ ] Test error responses **[ENHANCED]**
  - [ ] 404 for session not found
    - [ ] GET `/v1/sessions/nonexistent` → 404
  - [ ] 400 for invalid input
    - [ ] POST `/v1/sessions` with missing fields → 400
  - [ ] 409 for concurrent modification
    - [ ] Simulate concurrent switchCycle() calls
    - [ ] Verify one succeeds, one gets 409
  - [ ] 429 for rate limiting
    - [ ] Make 11 rapid requests to `/switch`
    - [ ] Verify 11th gets 429

- [ ] Test rate limiting
  - [ ] Hit rate limit, get 429 with Retry-After header
  - [ ] Wait, then succeed

- [ ] Test metrics endpoint
  - [ ] GET `/metrics` returns Prometheus format
  - [ ] Verify metrics include request counts
  - [ ] Verify histograms have percentiles

### Acceptance Criteria
- [ ] All 8 session endpoints functional
- [ ] Health and metrics endpoints working
- [ ] switchCycle endpoint <50ms latency
- [ ] Error handling maps custom errors correctly
- [ ] Rate limiting prevents abuse (per-IP and per-session)
- [ ] Prometheus metrics exposed
- [ ] Graceful shutdown works (no connection drops)
- [ ] Integration tests passing (>95% coverage)

### Files Created
- `src/api/app.ts`
- `src/api/routes/sessions.ts`
- `src/api/routes/time.ts`
- `src/api/routes/health.ts`
- `src/api/routes/metrics.ts`
- `src/api/middlewares/errorHandler.ts`
- `src/api/middlewares/rateLimit.ts`
- `src/api/middlewares/metrics.ts`
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
    ```typescript
    z.object({
      session_id: z.string().uuid(),
      sync_mode: z.enum(['per_participant', 'per_cycle', 'per_group', 'global', 'count_up']),
      participants: z.array(ParticipantSchema).min(1).max(1000),
      time_per_cycle_ms: z.number().min(1000).max(86400000).optional(),
      increment_ms: z.number().min(0).max(60000).optional(),
      max_time_ms: z.number().min(1000).max(86400000).optional(),
      auto_advance: z.boolean().optional(),
      metadata: z.record(z.any()).optional()
    })
    ```
  - [ ] `ParticipantSchema`
    ```typescript
    z.object({
      participant_id: z.string().uuid(),
      participant_index: z.number().min(0),
      total_time_ms: z.number().min(1000).max(86400000),
      group_id: z.string().uuid().optional()
    })
    ```
  - [ ] `SwitchCycleSchema`
    ```typescript
    z.object({
      next_participant_id: z.string().uuid().optional()
    })
    ```

- [ ] Create validation middleware
  - [ ] `src/api/middlewares/validate.ts`
  - [ ] Accept schema, validate req.body
  - [ ] Return 400 with formatted Zod errors if invalid:
    ```json
    {
      "error": {
        "code": "VALIDATION_ERROR",
        "message": "Request validation failed",
        "details": [
          { "field": "participants", "message": "Array must contain at least 1 element" }
        ]
      }
    }
    ```

- [ ] Apply to routes
  - [ ] Add validation middleware to each endpoint
  - [ ] POST `/v1/sessions` - validate with CreateSessionSchema
  - [ ] POST `/v1/sessions/:id/switch` - validate with SwitchCycleSchema
  - [ ] Other endpoints as needed

- [ ] Unit tests
  - [ ] Test valid inputs pass validation
  - [ ] Test invalid inputs rejected with 400
    - [ ] Missing required fields
    - [ ] Invalid types
    - [ ] Out-of-range values
  - [ ] Test error message format

### Acceptance Criteria
- [ ] All endpoints validated with Zod schemas
- [ ] Invalid requests return 400 with clear, structured errors
- [ ] Type inference working (TypeScript types inferred from Zod schemas)
- [ ] Validation errors include field names and helpful messages

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
  - [ ] Accept constructor parameters:
    - [ ] `port: number`
    - [ ] `stateManager: RedisStateManager`
  - [ ] Store client connections: `Map<sessionId, Set<WebSocket>>`

- [ ] Handle connections
  - [ ] Parse `sessionId` from query params: `?sessionId=abc123`
  - [ ] Validate sessionId format (UUID)
  - [ ] Optionally validate session exists in Redis
  - [ ] Add client to session group
  - [ ] Send connection acknowledgment:
    ```json
    {
      "type": "CONNECTED",
      "sessionId": "abc123",
      "timestamp": Date.now()
    }
    ```

- [ ] Handle disconnections
  - [ ] Remove client from session group
  - [ ] Clean up empty session groups (delete from Map)
  - [ ] Log disconnection

#### Redis Pub/Sub Integration (Day 1) **[ENHANCED]**

- [ ] Subscribe to Redis Pub/Sub (TWO channels)

  - [ ] **Channel 1: State Updates**
    - [ ] Call `stateManager.subscribeToUpdates(callback)`
    - [ ] Callback receives: `(sessionId, state | null)`
    - [ ] On state update:
      - [ ] Format as WebSocket message:
        ```json
        {
          "type": "STATE_UPDATE",
          "sessionId": "abc123",
          "timestamp": Date.now(),
          "state": { ... }
        }
        ```
      - [ ] Broadcast to all clients in that session
    - [ ] On state deletion (state is null):
      - [ ] Send `SESSION_DELETED` message
      - [ ] Close WebSocket connections for that session

  - [ ] **Channel 2: WebSocket Messages**
    - [ ] Call `stateManager.subscribeToWebSocket(callback)`
    - [ ] Callback receives: `(sessionId, message)`
    - [ ] Forward message to all clients in that session
    - [ ] This enables cross-instance broadcasting

- [ ] Implement `broadcastToSession(sessionId, message): void`
  - [ ] Get all clients for sessionId from Map
  - [ ] For each client:
    - [ ] Check if connection state is OPEN
    - [ ] Send JSON.stringify(message)
    - [ ] Handle send errors gracefully

#### Heartbeat Mechanism (Day 1-2)

- [ ] Implement heartbeat
  - [ ] Start interval on server start: `setInterval(..., 5000)` (5 seconds)
  - [ ] For each connected client:
    - [ ] Check `isAlive` flag
    - [ ] If `false`, terminate connection
    - [ ] If `true`, set to `false` and send PING
  - [ ] On client PONG received:
    - [ ] Set `isAlive = true`

- [ ] Handle client messages
  - [ ] PING message:
    - [ ] Respond with PONG + server timestamp
  - [ ] RECONNECT message:
    - [ ] Get current session state from Redis
    - [ ] Send full STATE_SYNC message:
      ```json
      {
        "type": "STATE_SYNC",
        "sessionId": "abc123",
        "timestamp": Date.now(),
        "state": { ... }
      }
      ```

#### Testing (Day 2) **[ENHANCED]**

- [ ] Create `tests/integration/websocket.test.ts`

- [ ] Test connection/disconnection
  - [ ] Client connects with valid sessionId
  - [ ] Receives CONNECTED acknowledgment
  - [ ] Client added to session group
  - [ ] Client disconnects
  - [ ] Client removed from session group

- [ ] Test message broadcasting
  - [ ] Connect 2 clients to same session
  - [ ] Trigger state update via `stateManager.updateSession()`
  - [ ] Both clients receive STATE_UPDATE message
  - [ ] Verify message content matches state

- [ ] **Test cross-instance broadcasting** **[CRITICAL - ENHANCED]**
  - [ ] Setup:
    - [ ] Create shared Redis instance (or use Redis mock)
    - [ ] Create 2 RedisStateManager instances (same Redis URL)
    - [ ] Create 2 WebSocket servers (different ports)
    - [ ] Create SyncEngine instance with stateManager1
  - [ ] Test scenario:
    - [ ] Connect client A to WebSocket server 1
    - [ ] Connect client B to WebSocket server 2 (same sessionId)
    - [ ] Trigger `syncEngine.switchCycle()` via client A
    - [ ] Verify:
      - [ ] Client A receives STATE_UPDATE (same instance)
      - [ ] Client B receives STATE_UPDATE (via Redis Pub/Sub)
      - [ ] Both messages have same state version
      - [ ] Update latency <100ms
  - [ ] **This test validates the distributed-first architecture**

- [ ] Test heartbeat
  - [ ] Connect client
  - [ ] Verify PING received within 5 seconds
  - [ ] Send PONG
  - [ ] Verify connection stays alive
  - [ ] Don't send PONG (simulate stale connection)
  - [ ] Verify connection terminated after next PING cycle

- [ ] Test reconnection
  - [ ] Connect client
  - [ ] Disconnect
  - [ ] Reconnect with same sessionId
  - [ ] Send RECONNECT message
  - [ ] Verify STATE_SYNC received

### Acceptance Criteria
- [ ] WebSocket connections work reliably
- [ ] Real-time updates delivered <100ms
- [ ] Cross-instance broadcasting via Redis Pub/Sub validated **[CRITICAL]**
- [ ] Heartbeat keeps connections alive, terminates stale ones
- [ ] Reconnection logic works (STATE_SYNC sent)
- [ ] Integration tests passing, including multi-instance test

### Files Created
- `src/websocket/WebSocketServer.ts`
- `tests/integration/websocket.test.ts`

---

## Phase 2 Success Criteria

### Must Complete Before Phase 3

- [ ] ✅ SyncEngine fully implemented and tested
  - [ ] Constructor uses dependency injection
  - [ ] switchCycle() <50ms validated (target: 3-5ms)
  - [ ] All session methods working correctly
  - [ ] Time calculations accurate (±5ms)
  - [ ] Unit tests >85% coverage

- [ ] ✅ REST API functional and robust
  - [ ] All 8 session endpoints working
  - [ ] Error handling maps custom errors correctly
  - [ ] Rate limiting active (per-IP and per-session)
  - [ ] Prometheus metrics exposed
  - [ ] Graceful shutdown implemented

- [ ] ✅ WebSocket real-time updates
  - [ ] Connections stable with heartbeat
  - [ ] Messages delivered <100ms
  - [ ] Cross-instance broadcasting confirmed **[CRITICAL]**
  - [ ] Both Pub/Sub channels working (state updates + WebSocket messages)

- [ ] ✅ Request validation with Zod
  - [ ] All endpoints validated
  - [ ] Clear error messages

- [ ] ✅ Integration tests comprehensive
  - [ ] Full session lifecycle works end-to-end
  - [ ] WebSocket updates received
  - [ ] Multi-instance test passes **[CRITICAL]**
  - [ ] Error scenarios covered

### Performance Validation

| Operation | Target | Achieved | Status |
|-----------|--------|----------|--------|
| switchCycle() total | <50ms | ___ ms | ⚪ |
| WebSocket delivery (same instance) | <50ms | ___ ms | ⚪ |
| WebSocket delivery (cross-instance) | <100ms | ___ ms | ⚪ |
| API response time (avg) | <100ms | ___ ms | ⚪ |

### Test Coverage Validation

| Component | Target | Achieved | Status |
|-----------|--------|----------|--------|
| SyncEngine | >85% | ___% | ⚪ |
| REST API | >80% | ___% | ⚪ |
| WebSocket | >75% | ___% | ⚪ |
| Overall | >80% | ___% | ⚪ |

---

## Progress Tracking

**Last Updated:** Not started

| Component | Status | Progress | Notes |
|-----------|--------|----------|-------|
| 2.1 SyncEngine | ⚪ | 0% | Constructor fix applied |
| 2.2 REST API | ⚪ | 0% | Enhanced error handling + metrics |
| 2.3 Request Validation | ⚪ | 0% | - |
| 2.4 WebSocket Server | ⚪ | 0% | Enhanced multi-instance test |

**Overall Phase 2 Progress:** 0%

---

## Key Updates from Original Plan

### Critical Fixes
1. ✅ **SyncEngine constructor** - Now uses dependency injection (accepts RedisStateManager)
2. ✅ **State schema validation** - Added pre-implementation check for required fields
3. ✅ **WebSocket Pub/Sub** - Clarified TWO channel subscriptions needed

### Enhancements
4. ✅ **Error handling** - Maps custom errors to HTTP status codes
5. ✅ **Rate limiting** - Clarified per-session keyGenerator
6. ✅ **Prometheus metrics** - Added monitoring middleware
7. ✅ **Graceful shutdown** - Detailed shutdown steps
8. ✅ **Multi-instance test** - Enhanced with explicit test scenario
9. ✅ **Time endpoint** - Added server version and drift tolerance

### Timeline Adjustment
- **Original:** 5-7 days
- **Updated:** 6-8 days
- **Reason:** Added metrics, enhanced testing, more detailed error handling

---

## Notes for Implementation

### Important Architectural Points

1. **Dependency Injection Pattern**
   - Create shared instances in `src/index.ts`
   - Pass instances to components (don't create inside)
   - Benefits: testability, shared resources, control

2. **Error Handling Strategy**
   - Use custom error classes from `src/errors/StateErrors.ts`
   - Map to appropriate HTTP status codes
   - Consistent error response format

3. **Multi-Instance Architecture**
   - The cross-instance WebSocket test is THE test that validates distributed-first
   - Both Pub/Sub channels must work: `session-updates` + `ws:*`
   - No instance-local state allowed

4. **Performance Monitoring**
   - Prometheus metrics from day 1
   - Track switchCycle() separately (hot path)
   - Monitor cross-instance latency

### Testing Strategy

- **Unit tests:** SyncEngine business logic (>85% coverage)
- **Integration tests:** API endpoints end-to-end
- **Multi-instance test:** Validates distributed architecture
- **Performance tests:** Validate <50ms switchCycle(), <100ms WebSocket delivery

### Common Pitfalls to Avoid

❌ Don't create RedisStateManager inside SyncEngine
❌ Don't forget to subscribe to BOTH Pub/Sub channels
❌ Don't skip the multi-instance test (it's critical)
❌ Don't hardcode error messages (use consistent format)
❌ Don't forget graceful shutdown (important for production)
