# Task 2.1: SyncEngine Implementation

**Phase:** 2 - Business Logic & API
**Component:** SyncEngine (Core Business Logic)
**Priority:** ⭐ **CRITICAL PATH**
**Estimated Time:** 2-3 days
**Status:** 🔴 Not Started
**Dependencies:** Task 1.2 (RedisStateManager)

---

## Objective

Implement the SyncEngine class that contains all time calculation logic and session management. This is the core business logic layer that orchestrates session state transitions, time tracking, and participant rotation.

**Key Focus:** Hot path optimization - `switchCycle()` must be <50ms (target: 3-5ms).

---

## Success Criteria

- [ ] All session methods implemented (createSession, startSession, switchCycle, etc.)
- [ ] switchCycle() latency <50ms validated (target: 3-5ms)
- [ ] Time calculations accurate (±5ms tolerance)
- [ ] Unit tests >85% coverage
- [ ] Edge cases handled (expiration, invalid transitions, concurrency)
- [ ] Custom errors thrown appropriately (SessionNotFoundError, etc.)

---

## Prerequisites (Day 0 - 1 hour)

### Schema Verification

- [ ] Verify `src/types/session.ts` has all required fields
  ```typescript
  // SyncParticipant must have:
  participant_id: string
  participant_index: number      // ✅ Added in Phase 1 update
  total_time_ms: number
  time_used_ms: number           // ✅ Added in Phase 1 update
  time_remaining_ms: number
  cycle_count: number            // ✅ Added in Phase 1 update
  is_active: boolean
  has_expired: boolean           // ✅ Added in Phase 1 update
  group_id?: string

  // SyncState must have:
  session_started_at: Date | null       // ✅ Already present
  session_completed_at: Date | null     // ✅ Already present
  cycle_started_at: Date | null         // ✅ Already present
  ```

- [ ] Run TypeScript compiler to verify no type errors
  ```bash
  pnpm tsc --noEmit
  ```

### Test Fixtures

- [ ] Create `tests/fixtures/sampleSessions.ts`
  ```typescript
  // Sample session data for tests
  export const createMockSession = (overrides?: Partial<SyncState>): SyncState
  export const createMockParticipant = (overrides?: Partial<SyncParticipant>): SyncParticipant
  ```

**⚠️ IMPORTANT:** Create test fixtures FIRST before starting Day 1 implementation. This ensures tests can be written alongside code and enables test-driven development.

---

## Day 1: Core Session Methods (8 hours)

### Morning (4 hours): Setup & Basic Methods

#### 1. Create SyncEngine Class (30 min)

- [ ] Create `src/engine/SyncEngine.ts`
- [ ] Setup class structure
  ```typescript
  import { RedisStateManager } from '@/state/RedisStateManager'
  import { SyncState, SyncParticipant } from '@/types/session'

  export class SyncEngine {
    private stateManager: RedisStateManager

    constructor(stateManager: RedisStateManager) {
      this.stateManager = stateManager
    }
  }
  ```

**CRITICAL:** Accept RedisStateManager instance (dependency injection), do NOT create it inside SyncEngine!

#### 2. Create SwitchCycleResult Type (15 min)

- [ ] Create `src/types/switch-result.ts`
  ```typescript
  export interface SwitchCycleResult {
    session_id: string
    active_participant_id: string | null
    cycle_started_at: Date
    participants: SyncParticipant[]
    status: string
    expired_participant_id?: string
  }
  ```

#### 3. Implement createSession() (1.5 hours)

- [ ] Method signature
  ```typescript
  async createSession(config: CreateSessionConfig): Promise<SyncState>
  ```

- [ ] Input validation
  - [ ] Validate `session_id` is UUID format
  - [ ] Validate `sync_mode` is valid enum value
  - [ ] Validate participants array (min: 1, max: 1000)
  - [ ] Validate time values are positive

- [ ] Initialize SyncState
  ```typescript
  const state: SyncState = {
    session_id: config.session_id,
    sync_mode: config.sync_mode,
    status: SyncStatus.PENDING,
    version: 1, // Will be set by RedisStateManager

    // Participants
    participants: config.participants.map((p, index) => ({
      participant_id: p.participant_id,
      participant_index: p.participant_index ?? index,
      total_time_ms: p.total_time_ms,
      time_used_ms: 0,
      time_remaining_ms: p.total_time_ms,
      cycle_count: 0,
      is_active: false,
      has_expired: false,
      group_id: p.group_id
    })),
    active_participant_id: null,

    // Timing
    total_time_ms: config.total_time_ms,
    time_per_cycle_ms: config.time_per_cycle_ms ?? null,
    cycle_started_at: null,
    session_started_at: null,
    session_completed_at: null,

    // Configuration
    increment_ms: config.increment_ms ?? 0,
    max_time_ms: config.max_time_ms,

    // Metadata
    created_at: new Date(),
    updated_at: new Date()
  }
  ```

- [ ] Call `stateManager.createSession(state)`
- [ ] Return created state
- [ ] Add error handling

#### 4. Implement startSession() (1 hour)

- [ ] Method signature
  ```typescript
  async startSession(sessionId: string): Promise<SyncState>
  ```

- [ ] Get session from Redis
  ```typescript
  const state = await this.stateManager.getSession(sessionId)
  if (!state) throw new SessionNotFoundError(sessionId)
  ```

- [ ] Validate status is 'pending'
  ```typescript
  if (state.status !== SyncStatus.PENDING) {
    throw new Error(`Session ${sessionId} cannot be started (status: ${state.status})`)
  }
  ```

- [ ] Update state
  ```typescript
  state.status = SyncStatus.RUNNING
  state.active_participant_id = state.participants[0].participant_id
  state.cycle_started_at = new Date()
  state.session_started_at = new Date()
  state.participants[0].is_active = true
  state.updated_at = new Date()
  ```

- [ ] Update via RedisStateManager
  ```typescript
  await this.stateManager.updateSession(sessionId, state)
  ```

- [ ] Return updated state

#### 5. Implement getCurrentState() (30 min)

- [ ] Simple passthrough to RedisStateManager
  ```typescript
  async getCurrentState(sessionId: string): Promise<SyncState> {
    const state = await this.stateManager.getSession(sessionId)
    if (!state) throw new SessionNotFoundError(sessionId)
    return state
  }
  ```

- [ ] No time calculations (client-side responsibility)

### Afternoon (4 hours): Hot Path Implementation

#### 6. Implement switchCycle() ⭐ CRITICAL (4 hours)

**This is THE most critical method - optimize for <50ms (target: 3-5ms)**

- [ ] Method signature
  ```typescript
  async switchCycle(
    sessionId: string,
    currentParticipantId?: string,
    nextParticipantId?: string
  ): Promise<SwitchCycleResult>
  ```

- [ ] Get session and validate
  ```typescript
  const state = await this.stateManager.getSession(sessionId)
  if (!state) throw new SessionNotFoundError(sessionId)
  if (state.status !== SyncStatus.RUNNING) {
    throw new Error(`Session ${sessionId} not running (status: ${state.status})`)
  }
  ```

- [ ] **Capture version for optimistic locking**
  ```typescript
  const expectedVersion = state.version
  ```

- [ ] Calculate elapsed time
  ```typescript
  const now = new Date()
  const currentParticipant = state.participants.find(
    p => p.participant_id === state.active_participant_id
  )

  if (currentParticipant && state.cycle_started_at) {
    const elapsed = now.getTime() - state.cycle_started_at.getTime()

    // Update current participant time
    currentParticipant.time_used_ms += elapsed
    currentParticipant.total_time_ms = Math.max(0, currentParticipant.total_time_ms - elapsed)
    currentParticipant.time_remaining_ms = currentParticipant.total_time_ms
    currentParticipant.cycle_count++
    currentParticipant.is_active = false

    // Check expiration
    if (currentParticipant.total_time_ms <= 0) {
      currentParticipant.has_expired = true
    }

    // Add increment (Fischer mode)
    if (state.increment_ms && state.increment_ms > 0) {
      currentParticipant.total_time_ms += state.increment_ms
      currentParticipant.time_remaining_ms = currentParticipant.total_time_ms
    }
  }
  ```

- [ ] Determine next participant
  ```typescript
  let nextParticipant: SyncParticipant | undefined

  if (nextParticipantId) {
    // Explicit next participant
    nextParticipant = state.participants.find(p => p.participant_id === nextParticipantId)
    if (!nextParticipant) {
      throw new Error(`Participant ${nextParticipantId} not found`)
    }
  } else {
    // Auto-advance to next in rotation
    const currentIndex = state.participants.findIndex(
      p => p.participant_id === state.active_participant_id
    )
    const nextIndex = (currentIndex + 1) % state.participants.length
    nextParticipant = state.participants[nextIndex]
  }
  ```

- [ ] Update state for next participant
  ```typescript
  state.active_participant_id = nextParticipant.participant_id
  state.cycle_started_at = now
  nextParticipant.is_active = true
  state.updated_at = now
  ```

- [ ] Update via RedisStateManager with optimistic locking
  ```typescript
  try {
    await this.stateManager.updateSession(sessionId, state, expectedVersion)
  } catch (err) {
    if (err instanceof ConcurrencyError) {
      // Handle concurrent modification
      throw err // or retry logic
    }
    throw err
  }
  ```

- [ ] Return result
  ```typescript
  return {
    session_id: sessionId,
    active_participant_id: state.active_participant_id,
    cycle_started_at: now,
    participants: state.participants,
    status: state.status,
    expired_participant_id: currentParticipant?.has_expired
      ? currentParticipant.participant_id
      : undefined
  }
  ```

---

## Day 2: Other Session Methods (6 hours)

### Morning (3 hours)

#### 7. Implement pauseSession() (1 hour)

- [ ] Get session, validate status is 'running'
- [ ] Calculate time used before pausing
  ```typescript
  const now = new Date()
  const activeParticipant = state.participants.find(p => p.is_active)

  if (activeParticipant && state.cycle_started_at) {
    const elapsed = now.getTime() - state.cycle_started_at.getTime()
    activeParticipant.time_used_ms += elapsed
    activeParticipant.total_time_ms = Math.max(0, activeParticipant.total_time_ms - elapsed)
    activeParticipant.time_remaining_ms = activeParticipant.total_time_ms
  }
  ```
- [ ] Update state
  ```typescript
  state.status = SyncStatus.PAUSED
  state.cycle_started_at = null
  state.updated_at = new Date()
  ```
- [ ] Update and return

#### 8. Implement resumeSession() (45 min)

- [ ] Get session, validate status is 'paused'
- [ ] Update state
  ```typescript
  state.status = SyncStatus.RUNNING
  state.cycle_started_at = new Date()
  state.updated_at = new Date()
  ```
- [ ] Update and return

#### 9. Implement completeSession() (1 hour)

- [ ] Get session
- [ ] Update state
  ```typescript
  state.status = SyncStatus.COMPLETED
  state.session_completed_at = new Date()
  state.cycle_started_at = null
  state.participants.forEach(p => p.is_active = false)
  state.updated_at = new Date()
  ```
- [ ] Update and return

#### 10. Implement deleteSession() (15 min)

- [ ] Simple passthrough to RedisStateManager
  ```typescript
  async deleteSession(sessionId: string): Promise<void> {
    await this.stateManager.deleteSession(sessionId)
  }
  ```

### Afternoon (3 hours): Error Handling & Validation

#### 11. Add Input Validation Helpers (1 hour)

- [ ] Create validation utilities
  ```typescript
  private validateSessionId(sessionId: string): void {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(sessionId)) {
      throw new Error(`Invalid session_id format: ${sessionId}`)
    }
  }

  private validateTimeValue(value: number, name: string): void {
    if (value < 0) {
      throw new Error(`${name} must be non-negative, got: ${value}`)
    }
  }
  ```

#### 12. Add Error Handling (1 hour)

- [ ] Wrap all methods with try-catch
- [ ] Map errors to custom error types
- [ ] Add logging for errors
  ```typescript
  import { createComponentLogger } from '@/utils/logger'
  const logger = createComponentLogger('SyncEngine')
  ```

#### 13. Add JSDoc Comments (1 hour)

- [ ] Document all public methods
  ```typescript
  /**
   * Switch the active participant to the next in rotation
   *
   * HOT PATH: Target <50ms total latency (expected: 3-5ms)
   *
   * @param sessionId - Session UUID
   * @param currentParticipantId - Optional current participant (validation)
   * @param nextParticipantId - Optional explicit next participant
   * @returns Switch result with updated state
   * @throws SessionNotFoundError if session doesn't exist
   * @throws ConcurrencyError if concurrent modification detected
   */
  async switchCycle(
    sessionId: string,
    currentParticipantId?: string,
    nextParticipantId?: string
  ): Promise<SwitchCycleResult>
  ```

---

## Day 3: Unit Tests (8 hours)

### Test Setup (1 hour)

- [ ] Create `tests/unit/SyncEngine.test.ts`
- [ ] Setup test fixtures
  ```typescript
  import { describe, it, expect, beforeEach } from 'vitest'
  import { SyncEngine } from '@/engine/SyncEngine'
  import { RedisStateManager } from '@/state/RedisStateManager'
  import { createMockSession, createMockParticipant } from '@/tests/fixtures/sampleSessions'

  describe('SyncEngine', () => {
    let syncEngine: SyncEngine
    let stateManager: RedisStateManager

    beforeEach(async () => {
      // Setup test Redis connection
      // Create SyncEngine instance
    })
  })
  ```

### Test Session Lifecycle (2 hours)

- [ ] Test createSession()
  ```typescript
  it('should create session with correct initial state', async () => {
    const config = { ... }
    const state = await syncEngine.createSession(config)

    expect(state.status).toBe(SyncStatus.PENDING)
    expect(state.version).toBe(1)
    expect(state.participants).toHaveLength(2)
    expect(state.participants[0].time_used_ms).toBe(0)
    expect(state.participants[0].is_active).toBe(false)
  })
  ```

- [ ] Test startSession()
  ```typescript
  it('should start session and activate first participant', async () => {
    // Create session
    const created = await syncEngine.createSession(config)

    // Start session
    const started = await syncEngine.startSession(created.session_id)

    expect(started.status).toBe(SyncStatus.RUNNING)
    expect(started.active_participant_id).toBe(participants[0].participant_id)
    expect(started.cycle_started_at).toBeInstanceOf(Date)
    expect(started.session_started_at).toBeInstanceOf(Date)
    expect(started.participants[0].is_active).toBe(true)
  })
  ```

- [ ] Test completeSession()
  ```typescript
  it('should complete session and deactivate all participants', async () => {
    const completed = await syncEngine.completeSession(sessionId)

    expect(completed.status).toBe(SyncStatus.COMPLETED)
    expect(completed.session_completed_at).toBeInstanceOf(Date)
    expect(completed.cycle_started_at).toBeNull()
    expect(completed.participants.every(p => !p.is_active)).toBe(true)
  })
  ```

### Test switchCycle() - CRITICAL (3 hours)

- [ ] Test time calculations
  ```typescript
  it('should calculate elapsed time accurately', async () => {
    // Start session
    const started = await syncEngine.startSession(sessionId)

    // Wait 100ms
    await new Promise(resolve => setTimeout(resolve, 100))

    // Switch cycle
    const result = await syncEngine.switchCycle(sessionId)

    // Verify time calculations (±5ms tolerance)
    const prevParticipant = result.participants[0]
    expect(prevParticipant.time_used_ms).toBeGreaterThanOrEqual(95)
    expect(prevParticipant.time_used_ms).toBeLessThanOrEqual(110)
  })
  ```

- [ ] Test participant rotation
  ```typescript
  it('should rotate to next participant', async () => {
    const result = await syncEngine.switchCycle(sessionId)

    expect(result.active_participant_id).toBe(participants[1].participant_id)
    expect(result.participants[0].is_active).toBe(false)
    expect(result.participants[1].is_active).toBe(true)
  })

  it('should wrap around to first participant after last', async () => {
    // Switch to last participant
    await syncEngine.switchCycle(sessionId, undefined, participants[2].participant_id)

    // Switch again - should wrap to first
    const result = await syncEngine.switchCycle(sessionId)
    expect(result.active_participant_id).toBe(participants[0].participant_id)
  })
  ```

- [ ] Test increment time (Fischer mode)
  ```typescript
  it('should add increment time after cycle', async () => {
    // Create session with increment_ms = 1000
    const config = { ..., increment_ms: 1000 }
    // ...

    const result = await syncEngine.switchCycle(sessionId)
    const prevParticipant = result.participants[0]

    // Time should decrease by elapsed, then increase by increment
    expect(prevParticipant.total_time_ms).toBeGreaterThan(initialTime - elapsed)
  })
  ```

- [ ] Test expiration detection
  ```typescript
  it('should detect when participant time expires', async () => {
    // Create participant with 100ms total time
    // Wait 150ms, then switch

    const result = await syncEngine.switchCycle(sessionId)

    expect(result.expired_participant_id).toBe(participants[0].participant_id)
    expect(result.participants[0].has_expired).toBe(true)
    expect(result.participants[0].total_time_ms).toBe(0)
  })
  ```

- [ ] Test optimistic locking
  ```typescript
  it('should prevent concurrent modifications with optimistic locking', async () => {
    // Get state twice
    const state1 = await stateManager.getSession(sessionId)
    const state2 = await stateManager.getSession(sessionId)

    // Update via first state (succeeds)
    await syncEngine.switchCycle(sessionId)

    // Update via second state with old version (fails)
    await expect(
      stateManager.updateSession(sessionId, state2, state2.version)
    ).rejects.toThrow(ConcurrencyError)
  })
  ```

### Test Pause/Resume (1 hour)

- [ ] Test pause saves time correctly
- [ ] Test resume continues from saved state
- [ ] Test cannot pause non-running session

### Test Error Handling (1 hour)

- [ ] Test SessionNotFoundError
- [ ] Test invalid state transitions
- [ ] Test invalid participant IDs
- [ ] Test validation errors

---

## Deliverables

### Code Files
- [ ] `src/engine/SyncEngine.ts` (main implementation)
- [ ] `src/types/switch-result.ts` (result interface)
- [ ] `tests/unit/SyncEngine.test.ts` (comprehensive tests)
- [ ] `tests/fixtures/sampleSessions.ts` (test data)

### Documentation
- [ ] JSDoc comments for all public methods
- [ ] Inline comments for complex logic (especially switchCycle)

### Validation
- [ ] All unit tests passing
- [ ] Test coverage >85%
- [ ] No TypeScript errors (`pnpm tsc --noEmit`)
- [ ] No linting errors (`pnpm lint`)

---

## Performance Targets

| Operation | Target | Expected | Validation |
|-----------|--------|----------|------------|
| createSession() | <10ms | ~5ms | Unit test with timer |
| startSession() | <10ms | ~5ms | Unit test with timer |
| switchCycle() | <50ms | 3-5ms | **Critical - unit test + perf test** |
| getCurrentState() | <5ms | ~1ms | Unit test with timer |
| pauseSession() | <10ms | ~5ms | Unit test with timer |

**switchCycle() is THE hot path - add specific performance test**

---

## Testing Strategy

### Unit Tests (Day 3)
- All methods tested in isolation
- Mock RedisStateManager for deterministic tests
- Edge cases covered (expiration, concurrency, validation)

### Integration Tests (Task 2.2)
- Test with real RedisStateManager
- Multi-instance scenarios
- End-to-end session lifecycle

### Performance Tests (Task 2.2)
- switchCycle() latency under load
- 100 concurrent sessions
- Validate <50ms target

---

## Common Pitfalls to Avoid

❌ **DON'T:**
- Create RedisStateManager inside SyncEngine constructor
- Skip optimistic locking in switchCycle()
- Forget to update `time_remaining_ms`
- Miss increment time in Fischer mode
- Skip validation for participant IDs

✅ **DO:**
- Accept RedisStateManager via dependency injection
- Capture expectedVersion before modifications
- Update all time fields consistently
- Test edge cases (expiration, wrap-around, concurrency)
- Add comprehensive error handling

---

## Blocked By

- Task 1.2 (RedisStateManager) - ✅ Complete

## Blocks

- Task 2.2 (REST API) - Needs SyncEngine
- Task 2.4 (WebSocket Server) - Needs SyncEngine

---

## Notes

### Time Calculation Logic

The core time calculation in `switchCycle()`:

1. **Capture current time:** `now = new Date()`
2. **Calculate elapsed:** `elapsed = now - cycle_started_at`
3. **Update consumed:** `time_used_ms += elapsed`
4. **Update remaining:** `total_time_ms -= elapsed`
5. **Add increment:** `total_time_ms += increment_ms` (if configured)
6. **Check expiration:** `has_expired = total_time_ms <= 0`
7. **Reset cycle:** `cycle_started_at = now` for next participant

### Optimistic Locking Pattern

```typescript
// 1. Get state
const state = await getSession(sessionId)

// 2. Capture version
const expectedVersion = state.version

// 3. Modify state locally
state.active_participant_id = nextParticipant.participant_id

// 4. Update with version check
await updateSession(sessionId, state, expectedVersion)
// Throws ConcurrencyError if version mismatch
```

This prevents lost updates in multi-instance deployments.

---

**Status:** 🔴 Not Started
**Next Task:** Task 2.2 - REST API Implementation
