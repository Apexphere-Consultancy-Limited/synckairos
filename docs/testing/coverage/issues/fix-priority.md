# Fix Priority Roadmap

**Last Updated:** 2025-10-25

---

## Overview

This document outlines the recommended priority and sequence for fixing test coverage issues to unblock the CI/CD pipeline.

**Total Remaining Effort:** 6.5-12.5 hours
**Expected Outcome:** All tests passing, CI/CD unblocked, clean test architecture

---

## Phase 1: SessionNotFoundError Investigation 🔴 CRITICAL

**Issue:** [#U2 - SessionNotFoundError Cascade](U2-session-not-found-error.md)
**Priority:** 🔴 CRITICAL - Blocking CI/CD
**Status:** NOT STARTED
**Effort:** 4-8 hours

### Why This First?
- Blocks entire CI/CD pipeline
- 58 tests failing (24% of test suite)
- Prevents SonarQube analysis
- Blocks PR merges

### What to Do
1. **Investigation** (2-3 hours)
   - Add logging to track session lifecycle
   - Verify Redis connection stability
   - Check for async timing issues
   - Review test isolation

2. **Fix Implementation** (2-5 hours)
   - Add proper `beforeEach`/`afterEach` cleanup
   - Add `await` to all async operations
   - Add appropriate delays or polling
   - Consider serial execution if needed

### Expected Results
- ✅ +58 passing tests
- ✅ CI/CD pipeline passes
- ✅ SonarQube scan runs
- ✅ Coverage report generated
- ✅ Test suite at 100% passing

### Success Criteria
- [ ] All 58 failing tests pass consistently
- [ ] No SessionNotFoundError in test runs
- [ ] Tests pass in both serial and parallel execution
- [ ] Clean Redis state between tests verified
- [ ] CI/CD workflow completes successfully

---

## Phase 2: Test Reclassification 🟡 MEDIUM

**Issue:** [#U5 - Unit Test Misclassification](U5-unit-test-misclassification.md)
**Priority:** 🟡 MEDIUM - Test Performance & Architecture
**Status:** IN PROGRESS (2/6 completed)
**Effort:** 2-4 hours

### Why This Second?
- Improves test performance (~9x faster)
- Better test architecture
- Easier maintenance
- Not blocking CI/CD (but helps)

### What to Do

#### Task 1: Split DBWriteQueue.test.ts (1 hour)
- [ ] Create `tests/unit/DBWriteQueue.api.test.ts` (6 unit tests)
- [ ] Create `tests/integration/DBWriteQueue.database.test.ts` (6 integration tests)
- [ ] Delete original file
- [ ] Verify both test files pass

**Expected:** 11s → <5s total

#### Task 2: Move DBWriteQueue.edgecases.test.ts (30 minutes)
- [ ] Move to `tests/integration/DBWriteQueue.edgecases.test.ts`
- [ ] Update imports if needed
- [ ] Verify tests still pass

**Expected:** 18s → 3-5s (with potential parallel execution)

#### Task 3: Move DBWriteQueue.transactions.test.ts (30 minutes)
- [ ] Move to `tests/integration/DBWriteQueue.transactions.test.ts`
- [ ] Update imports if needed
- [ ] Verify tests still pass

**Expected:** 33s → 3-5s

#### Task 4: Create Performance Test Directory (1 hour)
- [ ] Create `tests/performance/` directory
- [ ] Move `DBWriteQueue.performance.test.ts`
- [ ] Update package.json scripts
  ```json
  {
    "test:performance": "vitest tests/performance",
    "test:coverage": "vitest run tests/unit tests/integration --coverage"
  }
  ```
- [ ] Update CI/CD to skip performance tests
- [ ] Document performance test usage

**Expected:** 70s → skip in CI (run on-demand)

### Expected Results
- ✅ Faster CI/CD runs (~130s faster)
- ✅ Better test organization
- ✅ Clearer architecture
- ✅ Easier to maintain

### Success Criteria
- [ ] All tests properly classified
- [ ] Unit tests <100ms each, <5s total
- [ ] Integration tests <10s each
- [ ] Performance tests skipped in CI
- [ ] Updated test scripts in package.json
- [ ] Updated CI/CD workflow

---

## Phase 3: Redis Configuration 🟡 LOW

**Issue:** [#U4 - Redis Eviction Policy Warning](U4-redis-eviction-policy.md)
**Priority:** 🟡 LOW - Configuration Warning
**Status:** NOT STARTED
**Effort:** 30 minutes

### Why This Last?
- Not blocking tests
- Warning only (tests still pass)
- Quick fix but low impact
- Good "polish" item

### What to Do
1. **Update Docker Compose** (10 minutes)
   - [ ] Edit `docker-compose.yml`
   - [ ] Add `--maxmemory-policy noeviction` to redis command
   - [ ] Restart Redis: `docker-compose restart redis`

2. **Update Documentation** (15 minutes)
   - [ ] Document in DEVELOPMENT.md
   - [ ] Update DEPLOYMENT.md
   - [ ] Add to CI/CD Redis service config

3. **Verify** (5 minutes)
   - [ ] Run tests - no warnings
   - [ ] Check Redis config: `redis-cli CONFIG GET maxmemory-policy`

### Expected Results
- ✅ Clean test output
- ✅ Production-like test environment
- ✅ Documented configuration

---

## Completion Timeline

### Optimistic (6.5 hours)
- Phase 1: 4 hours
- Phase 2: 2 hours
- Phase 3: 30 minutes

### Realistic (9.5 hours)
- Phase 1: 6 hours
- Phase 2: 3 hours
- Phase 3: 30 minutes

### Pessimistic (12.5 hours)
- Phase 1: 8 hours
- Phase 2: 4 hours
- Phase 3: 30 minutes

---

## Progress Tracking

### Completed ✅
- [x] Issue #U1 - Database test UUIDs (1 hour)
- [x] Issue #U3 - Validation assertions (30 minutes)
- [x] Issue #U5 (partial) - Alerting tests (1.5 hours)
- [x] Issue #U5 (partial) - Retry tests optimization (2 hours)

**Total Time Invested:** ~5 hours
**Tests Fixed:** +52 tests
**Performance Improvement:** 220s → 26ms (unit tests), 150s → 12s (retry integration tests)

### In Progress 🟡
- [ ] Issue #U5 - Remaining test reclassification (4 files)

### Blocked 🔴
- [ ] Issue #U2 - SessionNotFoundError (waiting to start)
- [ ] Issue #U4 - Redis configuration (waiting for Phase 3)

---

## Decision Points

### After Phase 1
**Decision:** Proceed with Phase 2 or Phase 3?

**Recommendation:** Proceed with Phase 2
- Phase 2 has higher value (performance + architecture)
- Phase 3 is purely cosmetic (warnings only)
- Can skip Phase 3 if time is limited

### If Phase 1 Takes Too Long
**Decision:** Continue investigation or workaround?

**Options:**
1. **Continue:** Keep investigating (recommended if <8 hours spent)
2. **Workaround:** Run tests serially to avoid race conditions
3. **Skip:** Disable failing tests temporarily (NOT recommended)

**Recommendation:** Continue investigation
- Root cause fix is better than workaround
- Tests are critical for CI/CD quality
- Likely an easy fix once root cause found

---

## Success Metrics

### After Phase 1
- Tests Passing: 200/200 (100%)
- CI/CD: ✅ Passing
- SonarQube: ✅ Running

### After Phase 2
- Unit Test Suite: <5s total
- Integration Test Suite: <20s total
- CI/CD Time: <30s total

### After Phase 3
- Test Output: Clean (no warnings)
- Redis Config: Production-like

---

## Related Documentation

- [Test Statistics](test-statistics.md) - Current test metrics
- [CI/CD Impact](cicd-impact.md) - Pipeline analysis
- [Issue #U2](U2-session-not-found-error.md) - Critical blocker
- [Issue #U5](U5-unit-test-misclassification.md) - Performance issue
- [Issue #U4](U4-redis-eviction-policy.md) - Configuration warning

---

## Change Log

| Date | Change | Author |
|------|--------|--------|
| 2025-10-24 | Initial roadmap created | Claude Agent |
| 2025-10-25 | Updated with completed work | Claude Agent |
| 2025-10-25 | Added detailed task breakdown | Claude Agent |
