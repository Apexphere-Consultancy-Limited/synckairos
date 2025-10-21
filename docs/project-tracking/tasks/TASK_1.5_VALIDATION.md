# Task 1.5: Phase 1 Validation

**Component:** Validation & Quality Assurance
**Phase:** 1 - Core Architecture
**Estimated Time:** 0.5 days (4 hours)
**Priority:** High

> **Note:** Track progress in [TASK_TRACKING.md](../TASK_TRACKING.md)

---

## Objective

Validate that Phase 1 core architecture meets all requirements before proceeding to Phase 2. Ensure no instance-local state, confirm distributed-first design, and verify performance targets.

**Critical Validation:** Confirm ZERO instance-local state exists anywhere in the codebase.

---

## Task 1: Code Review - Stateless Verification (2 hours)

### Checklist: RedisStateManager Review

- [ ] Review `src/state/RedisStateManager.ts`
  - [ ] ✅ NO instance-local caching of session state
  - [ ] ✅ NO in-memory Map/Set storing sessions
  - [ ] ✅ ALL state reads go through `redis.get()`
  - [ ] ✅ ALL state writes go through `redis.setex()`
  - [ ] ✅ TTL set on EVERY write (1 hour)
  - [ ] ✅ No memoization of getSession() results
  - [ ] ✅ No static class variables storing state

**Anti-patterns to watch for:**
```typescript
// ❌ WRONG: Instance-local cache
class RedisStateManager {
  private sessionCache = new Map<string, SyncState>()  // NEVER DO THIS

  async getSession(id: string) {
    if (this.sessionCache.has(id)) {
      return this.sessionCache.get(id)  // BREAKS DISTRIBUTED-FIRST
    }
    // ...
  }
}

// ✅ CORRECT: Always read from Redis
class RedisStateManager {
  async getSession(id: string) {
    const data = await this.redis.get(`session:${id}`)  // ALWAYS READ FROM PRIMARY
    return data ? JSON.parse(data) : null
  }
}
```

---

### Checklist: DBWriteQueue Review

- [ ] Review `src/state/DBWriteQueue.ts`
  - [ ] ✅ Queue is Redis-backed (BullMQ)
  - [ ] ✅ No in-memory job queue
  - [ ] ✅ Jobs persist across instance restarts
  - [ ] ✅ Worker processes jobs from shared Redis queue

---

### Checklist: Global Project Review

- [ ] Review entire `src/` directory
  - [ ] ✅ No global state variables (e.g., `let sessions = {}`)
  - [ ] ✅ No singleton patterns storing state
  - [ ] ✅ No static class variables with mutable state
  - [ ] ✅ All components are stateless or store state in Redis

- [ ] Check for accidental state leaks
  ```bash
  # Search for potential instance-local state patterns
  grep -r "private.*Map" src/
  grep -r "private.*Set" src/
  grep -r "private.*cache" src/
  grep -r "static.*=" src/
  ```

**Document findings:**
- [ ] Create `docs/project-tracking/PHASE_1_VALIDATION.md`
- [ ] List all files reviewed
- [ ] Confirm no instance-local state found
- [ ] Note any issues discovered and how they were fixed

---

## Task 2: Multi-Instance Simulation Test (1.5 hours)

### Setup: Run Two Instances Locally

- [ ] Start local Redis
  ```bash
  docker run -d -p 6379:6379 redis:7-alpine
  ```

- [ ] Create test script `scripts/multi-instance-test.ts`
  ```typescript
  import { RedisStateManager } from '@/state/RedisStateManager'
  import { DBWriteQueue } from '@/state/DBWriteQueue'
  import { createRedisClient, createRedisPubSubClient } from '@/config/redis'
  import { SyncMode, SyncStatus } from '@/types/session'

  const testMultiInstance = async () => {
    console.log('🧪 Multi-Instance Simulation Test')
    console.log('==================================\n')

    // Instance 1
    const redis1 = createRedisClient()
    const pubSub1 = createRedisPubSubClient()
    const queue1 = new DBWriteQueue(process.env.REDIS_URL!)
    const instance1 = new RedisStateManager(redis1, pubSub1, queue1)

    // Instance 2
    const redis2 = createRedisClient()
    const pubSub2 = createRedisPubSubClient()
    const queue2 = new DBWriteQueue(process.env.REDIS_URL!)
    const instance2 = new RedisStateManager(redis2, pubSub2, queue2)

    console.log('✅ Two instances created\n')

    // Test 1: Create on Instance 1, Read on Instance 2
    console.log('Test 1: Cross-instance state sharing')
    const sessionId = 'multi-instance-test-1'
    const state = {
      session_id: sessionId,
      sync_mode: SyncMode.PER_PARTICIPANT,
      status: SyncStatus.PENDING,
      version: 1,
      participants: [
        {
          participant_id: 'p1',
          total_time_ms: 300000,
          time_remaining_ms: 300000,
          has_gone: false,
          is_active: true,
        },
      ],
      active_participant_id: 'p1',
      total_time_ms: 300000,
      time_per_cycle_ms: null,
      cycle_started_at: null,
      session_started_at: null,
      session_completed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    }

    await instance1.createSession(state)
    console.log('  Instance 1: Created session')

    const retrieved = await instance2.getSession(sessionId)
    console.log('  Instance 2: Retrieved session')

    if (retrieved && retrieved.session_id === sessionId) {
      console.log('  ✅ PASS: Instance 2 can read session created by Instance 1\n')
    } else {
      console.log('  ❌ FAIL: Instance 2 could not read session\n')
      process.exit(1)
    }

    // Test 2: Update on Instance 2, Read on Instance 1
    console.log('Test 2: Cross-instance state updates')
    const updated = { ...retrieved!, status: SyncStatus.RUNNING }
    await instance2.updateSession(sessionId, updated)
    console.log('  Instance 2: Updated session to RUNNING')

    const readBack = await instance1.getSession(sessionId)
    console.log('  Instance 1: Read session')

    if (readBack && readBack.status === SyncStatus.RUNNING) {
      console.log('  ✅ PASS: Instance 1 sees update from Instance 2\n')
    } else {
      console.log('  ❌ FAIL: Instance 1 did not see update\n')
      process.exit(1)
    }

    // Test 3: Pub/Sub cross-instance communication
    console.log('Test 3: Pub/Sub cross-instance communication')

    const updates: string[] = []
    instance2.subscribeToUpdates((sessionId) => {
      updates.push(sessionId)
      console.log(`  Instance 2: Received update for ${sessionId}`)
    })

    await new Promise((resolve) => setTimeout(resolve, 100)) // Wait for subscription

    const current = await instance1.getSession(sessionId)
    await instance1.updateSession(sessionId, { ...current!, status: SyncStatus.PAUSED })
    console.log('  Instance 1: Updated session to PAUSED')

    await new Promise((resolve) => setTimeout(resolve, 500)) // Wait for Pub/Sub

    if (updates.includes(sessionId)) {
      console.log('  ✅ PASS: Instance 2 received Pub/Sub update from Instance 1\n')
    } else {
      console.log('  ❌ FAIL: Instance 2 did not receive Pub/Sub update\n')
      process.exit(1)
    }

    // Test 4: Version conflict detection
    console.log('Test 4: Optimistic locking across instances')
    const current1 = await instance1.getSession(sessionId)
    const current2 = await instance2.getSession(sessionId)

    // Instance 1 updates first
    await instance1.updateSession(sessionId, current1!, current1!.version)
    console.log('  Instance 1: Updated session (version incremented)')

    // Instance 2 tries to update with stale version
    try {
      await instance2.updateSession(sessionId, current2!, current2!.version)
      console.log('  ❌ FAIL: Instance 2 should have thrown version conflict\n')
      process.exit(1)
    } catch (err) {
      if (err instanceof Error && err.message.includes('Concurrent modification')) {
        console.log('  ✅ PASS: Version conflict detected correctly\n')
      } else {
        console.log('  ❌ FAIL: Wrong error thrown\n')
        throw err
      }
    }

    // Cleanup
    await instance1.deleteSession(sessionId)
    await instance1.close()
    await instance2.close()
    await queue1.close()
    await queue2.close()

    console.log('\n🎉 All multi-instance tests PASSED!')
  }

  testMultiInstance().catch((err) => {
    console.error('Test failed:', err)
    process.exit(1)
  })
  ```

- [ ] Add test script to `package.json`
  ```json
  "scripts": {
    "test:multi-instance": "tsx scripts/multi-instance-test.ts"
  }
  ```

- [ ] Run multi-instance test
  ```bash
  pnpm run test:multi-instance
  ```

**Expected Results:**
- [ ] ✅ Test 1: Cross-instance state sharing works
- [ ] ✅ Test 2: Cross-instance state updates work
- [ ] ✅ Test 3: Pub/Sub cross-instance communication works
- [ ] ✅ Test 4: Optimistic locking works across instances

**Document Results:**
- [ ] Add test results to `PHASE_1_VALIDATION.md`
- [ ] Include screenshots or logs
- [ ] Note any failures and how they were resolved

---

## Task 3: Performance Validation (30 min)

### Run Performance Tests

- [ ] Run RedisStateManager performance tests
  ```bash
  pnpm run test tests/performance/RedisStateManager.perf.test.ts
  ```

- [ ] Record performance results

**Performance Targets:**

| Operation | Target | Achieved | Status |
|-----------|--------|----------|--------|
| getSession() avg | <3ms | ___ ms | ⚪ |
| getSession() p95 | <5ms | ___ ms | ⚪ |
| updateSession() avg | <5ms | ___ ms | ⚪ |
| updateSession() p95 | <10ms | ___ ms | ⚪ |
| Redis Pub/Sub | <2ms | ___ ms | ⚪ |

- [ ] Update `PHASE_1_VALIDATION.md` with performance results
- [ ] Mark status as ✅ if target met, ⚠️ if close, ❌ if failed

---

## Task 4: Test Coverage Validation (30 min)

### Run Coverage Reports

- [ ] Run unit test coverage
  ```bash
  pnpm run test:coverage
  ```

- [ ] Review coverage report
  - [ ] RedisStateManager: >90% coverage
  - [ ] DBWriteQueue: >85% coverage
  - [ ] Overall project: >80% coverage

**Coverage Requirements:**

| Component | Target | Achieved | Status |
|-----------|--------|----------|--------|
| RedisStateManager | >90% | ___% | ⚪ |
| DBWriteQueue | >85% | ___% | ⚪ |
| Database config | >70% | ___% | ⚪ |
| Overall | >80% | ___% | ⚪ |

- [ ] Identify uncovered code paths
- [ ] Add tests for critical uncovered areas
- [ ] Re-run coverage to confirm improvement

**Document Coverage:**
- [ ] Add coverage report to `PHASE_1_VALIDATION.md`
- [ ] List any uncovered critical paths
- [ ] Note why certain code is intentionally untested (if applicable)

---

## Task 5: Final Checklist & Documentation (30 min)

### Phase 1 Completion Checklist

- [ ] **Core Architecture**
  - [ ] ✅ RedisStateManager fully implemented
  - [ ] ✅ PostgreSQL schema deployed
  - [ ] ✅ DBWriteQueue processing jobs
  - [ ] ✅ All unit tests passing
  - [ ] ✅ All integration tests passing

- [ ] **Distributed-First Design**
  - [ ] ✅ Zero instance-local state confirmed
  - [ ] ✅ Multi-instance test passed
  - [ ] ✅ Redis Pub/Sub cross-instance communication works
  - [ ] ✅ Optimistic locking works across instances

- [ ] **Performance Targets**
  - [ ] ✅ getSession() <5ms (p95)
  - [ ] ✅ updateSession() <5ms (p95)
  - [ ] ✅ Redis Pub/Sub <5ms

- [ ] **Testing Requirements**
  - [ ] ✅ RedisStateManager >90% coverage
  - [ ] ✅ DBWriteQueue >85% coverage
  - [ ] ✅ Overall >80% coverage

- [ ] **Code Quality**
  - [ ] ✅ TypeScript strict mode, no `any` types
  - [ ] ✅ ESLint passing
  - [ ] ✅ Prettier formatting consistent
  - [ ] ✅ No linting errors

### Update Documentation

- [ ] Complete `docs/project-tracking/PHASE_1_VALIDATION.md`
  - [ ] Code review findings
  - [ ] Multi-instance test results
  - [ ] Performance validation results
  - [ ] Test coverage results
  - [ ] Final checklist status

- [ ] Update `docs/project-tracking/phases/PHASE_1.md`
  - [ ] Set status to 🟢 Complete
  - [ ] Update progress to 100%
  - [ ] Fill in performance results table
  - [ ] Note completion date

- [ ] Update `docs/project-tracking/PROJECT_PHASES.md`
  - [ ] Mark Phase 1 as 🟢 Complete
  - [ ] Update overall project progress

---

## Acceptance Criteria

### Must Complete Before Phase 2

- [ ] ✅ RedisStateManager fully tested
  - [ ] <5ms operations validated
  - [ ] >90% test coverage
  - [ ] Pub/Sub working across instances

- [ ] ✅ PostgreSQL schema deployed
  - [ ] Migrations run successfully
  - [ ] Can connect and query
  - [ ] Indexes created

- [ ] ✅ Async audit writes working
  - [ ] BullMQ queue processing jobs
  - [ ] Writes to PostgreSQL succeed
  - [ ] Retry logic tested (5 attempts)

- [ ] ✅ Zero instance-local state
  - [ ] Code review passed
  - [ ] Multi-instance test passed
  - [ ] No stateful singletons

- [ ] ✅ Redis Pub/Sub cross-instance communication
  - [ ] Tested with 2+ instances
  - [ ] Messages received reliably
  - [ ] Latency <5ms

---

## Files Created

- [ ] `docs/project-tracking/PHASE_1_VALIDATION.md`
- [ ] `scripts/multi-instance-test.ts`

---

## Files Updated

- [ ] `docs/project-tracking/phases/PHASE_1.md` (mark complete)
- [ ] `docs/project-tracking/PROJECT_PHASES.md` (update progress)

---

## Dependencies

**Blocks:**
- Phase 2 - Cannot start until Phase 1 is validated

**Blocked By:**
- Task 1.1 (Project Setup)
- Task 1.2 (RedisStateManager)
- Task 1.3 (PostgreSQL Schema)
- Task 1.4 (DBWriteQueue)

---

## Validation Results (To be filled)

### Code Review
- **Files Reviewed:** _______
- **Instance-Local State Found:** Yes / No
- **Issues Found:** _______
- **Issues Resolved:** _______

### Multi-Instance Test
- **Test 1 (State Sharing):** Pass / Fail
- **Test 2 (State Updates):** Pass / Fail
- **Test 3 (Pub/Sub):** Pass / Fail
- **Test 4 (Optimistic Locking):** Pass / Fail

### Performance
- **getSession() avg:** ___ ms (target: <3ms)
- **updateSession() avg:** ___ ms (target: <5ms)
- **Redis Pub/Sub:** ___ ms (target: <2ms)

### Test Coverage
- **RedisStateManager:** ___% (target: >90%)
- **DBWriteQueue:** ___% (target: >85%)
- **Overall:** ___% (target: >80%)

---

## Next Steps After Completion

1. Mark PHASE_1.md as 🟢 Complete
2. Update PROJECT_PHASES.md progress
3. Begin Phase 2 planning
