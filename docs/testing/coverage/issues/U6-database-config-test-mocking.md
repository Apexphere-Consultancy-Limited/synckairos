# Issue #U6: DatabaseConfig Tests Need Proper Mocking

**Priority:** 🟢 LOW
**Status:** 🟡 **ACTIVE** - 2 tests failing due to missing test database
**Discovered:** 2025-10-26
**Effort Estimate:** 30 minutes

---

## Description

Two tests in [DatabaseConfig.test.ts](../../../../tests/unit/DatabaseConfig.test.ts) are trying to connect to a real PostgreSQL database that doesn't exist in the test environment, causing test failures:

1. "should return true when database is healthy" (line 104)
2. "should log on successful connection" (line 149)

**Error Messages:**
```
Error: SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string
```

---

## Root Cause

These tests use `vi.resetModules()` to reload the database config module with different environment variables, but then try to make real database connections:

```typescript
it('should return true when database is healthy', async () => {
  process.env.DATABASE_URL = 'postgresql://localhost:5432/synckairos'
  const { healthCheck, pool } = await import('@/config/database')
  const isHealthy = await healthCheck()  // ❌ Tries to connect to real DB
  expect(isHealthy).toBe(true)
  await pool.end()
})
```

The database URL points to a database that doesn't exist or lacks proper credentials in the test environment.

---

## Impact

- ⚠️ **2/18 tests failing** (11% failure rate)
- ⚠️ **Non-blocking** - Other 16 tests pass
- ⚠️ **Minor issue** - These are configuration tests that should be mocked

---

## Analysis

### Current Test Status
- **Total Tests:** 18
- **Passing:** 16 (88.9%)
- **Failing:** 2 (11.1%)
- **Runtime:** ~141ms

### Test Categories
1. **Configuration Tests** (14 tests) - ✅ Passing
   - Pool size configuration
   - SSL configuration
   - Environment variable parsing
   - Connection timeouts

2. **Health Check Tests** (3 tests)
   - ✅ "should return false when database connection fails" - Passing (expects failure)
   - ❌ "should return true when database is healthy" - Failing (needs mock)
   - ✅ "should return false when query fails" - Passing (mocked)

3. **Connection Event Tests** (2 tests)
   - ❌ "should log on successful connection" - Failing (needs mock)
   - ✅ "should log on connection error" - Passing (just checks event listener)

4. **Pool Lifecycle Tests** (2 tests) - ✅ Both Passing

---

## Required Fix

### Option 1: Mock pool.query and pool.connect (Recommended)

Update the failing tests to mock the database operations instead of making real connections:

```typescript
it('should return true when database is healthy', async () => {
  process.env.DATABASE_URL = 'postgresql://localhost:5432/synckairos'

  // Mock pg module before importing database config
  vi.mock('@/config/database', async () => {
    const actual = await vi.importActual('@/config/database')
    return {
      ...actual,
      pool: {
        query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
        end: vi.fn().mockResolvedValue(undefined),
      }
    }
  })

  const { healthCheck, pool } = await import('@/config/database')
  const isHealthy = await healthCheck()

  expect(isHealthy).toBe(true)
  await pool.end()
})
```

### Option 2: Move to Integration Tests

Move these 2 tests to a new file `tests/integration/DatabaseConfig.integration.test.ts` that requires a real test database.

---

## Implementation Steps

### Recommended: Option 1 (Mock the database operations)

1. **Update "should return true when database is healthy" test**
   - [ ] Add mock for pool.query to return successful result
   - [ ] Update test to verify healthCheck returns true
   - [ ] Ensure pool.end() is properly mocked

2. **Update "should log on successful connection" test**
   - [ ] Add mock for pool.connect to return mock client
   - [ ] Mock client.release() method
   - [ ] Verify event listener is attached without real connection

3. **Verify All Tests Pass**
   - [ ] Run: `pnpm vitest run tests/unit/DatabaseConfig.test.ts`
   - [ ] Confirm 18/18 tests passing
   - [ ] Verify no real database connections attempted

---

## Alternative: Option 2 (Move to integration tests)

1. **Create integration test file**
   - [ ] Create `tests/integration/DatabaseConfig.integration.test.ts`
   - [ ] Move the 2 failing tests to new file
   - [ ] Update imports and test setup

2. **Setup test database**
   - [ ] Document test database requirements
   - [ ] Update CI/CD to provision test database
   - [ ] Add database seeding/cleanup

---

## Verification

After fix, run tests and confirm:

```bash
# Run unit tests
pnpm vitest run tests/unit/DatabaseConfig.test.ts

# Expected: 18/18 tests passing
# ✓ DatabaseConfig > Health Check > should return true when database is healthy
# ✓ DatabaseConfig > Connection Events > should log on successful connection
```

---

## Code Quality Improvements Already Made

As part of the unit test audit, the following fixes were already applied to [src/config/database.ts](../../../../src/config/database.ts):

### 1. Improved parseInt handling (Lines 18-19)
```typescript
// Before:
min: parseInt(process.env.DATABASE_POOL_MIN || '2', 10),
max: parseInt(process.env.DATABASE_POOL_MAX || '20', 10),

// After:
min: parseInt(process.env.DATABASE_POOL_MIN || '2', 10) || 2,
max: parseInt(process.env.DATABASE_POOL_MAX || '20', 10) || 20,
```
**Impact:** Handles NaN from invalid input gracefully (fixes test: "should handle invalid pool size values")

### 2. Safe pool closing (Line 59)
```typescript
// Before:
export const closePool = async (): Promise<void> => {
  await pool.end()
  logger.info('PostgreSQL pool closed')
}

// After:
export const closePool = async (): Promise<void> => {
  if (!pool.ended) {
    await pool.end()
    logger.info('PostgreSQL pool closed')
  }
}
```
**Impact:** Prevents "Called end on pool more than once" errors (fixes test: "should handle multiple close calls")

These fixes resolved 2 other test failures, bringing the pass rate from 14/18 to 16/18.

---

## Related Issues

- [U5 - Unit Test Misclassification](resolved/U5-unit-test-misclassification.md) - Test classification work
- [Unit Test Audit Final Report](../../UNIT_TEST_AUDIT_FINAL.md) - Comprehensive audit results

---

## Priority Justification

**Why LOW priority:**
- Only 2/255 total unit tests failing (0.8% failure rate)
- 16/18 tests in this file passing (88.9% pass rate)
- Non-blocking - doesn't prevent development or CI/CD
- Tests are for configuration validation, not critical functionality
- Easy fix - simple mocking required

**Context:**
- Overall unit test suite: 253/255 passing (99.2%)
- These are the ONLY 2 failing tests in entire unit test suite
- Can be fixed in ~30 minutes with proper mocking

---

## Change Log

| Date | Change | Author |
|------|--------|--------|
| 2025-10-26 | Issue identified during unit test audit | Claude Agent |
| 2025-10-26 | Fixed config parsing (parseInt NaN handling) | Claude Agent |
| 2025-10-26 | Fixed pool lifecycle (multiple close handling) | Claude Agent |
| 2025-10-26 | Issue documented with solution options | Claude Agent |
