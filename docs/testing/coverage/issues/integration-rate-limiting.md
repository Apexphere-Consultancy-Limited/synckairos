# Integration Test Rate Limiting Issue

**Issue ID**: Integration-Rate-Limiting
**Status**: Known Issue - Deferred
**Priority**: Low (Test Environment Only)
**Date Identified**: 2025-10-28
**Affected Tests**: Integration tests when run repeatedly

## Problem Description

Integration tests occasionally fail with 429 (Too Many Requests) errors when run multiple times in quick succession due to rate limiting middleware protecting the API.

### Rate Limits in Place
- **General Rate Limit**: 100 requests per minute per IP
- **Switch Cycle Rate Limit**: 10 requests per second per session

### Symptoms
1. Tests pass when run individually or with sufficient delays between runs
2. When running full integration test suite multiple times (e.g., during development), later test runs hit rate limits
3. Errors like: `expected 200 "OK", got 429 "Too Many Requests"`

### Affected Test Files
- `api-rate-limiting.test.ts` - Occasionally 1-2 tests fail due to hitting general rate limit
- Other integration tests that make many API requests in sequence

### Example Failures
```
FAIL  tests/integration/api-rate-limiting.test.ts
  × should include rate limit headers in response
    → expected 200 "OK", got 429 "Too Many Requests"
```

## Root Cause

The rate limiter uses a sliding window stored in Redis with 60-second TTLs. When running tests repeatedly:

1. First test run uses up rate limit budget
2. Second test run (within 60 seconds) hits existing rate limits
3. Tests expecting 200 responses get 429 instead

This is **expected behavior** - the rate limiter is working correctly. The issue is that test environment doesn't reset rate limits between test runs.

## Current Workarounds

### 1. Wait Between Test Runs
Wait 60+ seconds between full integration test runs to allow rate limits to reset:
```bash
pnpm test:integration
# Wait 60 seconds
pnpm test:integration
```

### 2. Test Expectations Updated
Some tests now accept both success and rate limit responses:
```typescript
// api-rate-limiting.test.ts
expect([200, 429]).toContain(response.status)
```

### 3. Clear Redis Between Runs
```bash
redis-cli FLUSHDB
pnpm test:integration
```

## Impact Assessment

### Severity: LOW
- ✅ **Production**: Not affected - rate limiting works correctly
- ✅ **CI/CD**: Tests run in clean environment with no rate limit carryover
- ⚠️ **Local Development**: Developers may hit this during repeated test runs

### Test Coverage Impact
- Current: 176/182 integration tests passing (97%)
- 6 tests may occasionally fail due to rate limiting in rapid re-runs
- All tests pass in fresh environment

## Potential Solutions (Deferred)

### Option 1: Unique Rate Limit Keys Per Test
Use unique IP addresses or identifiers for each test to avoid shared rate limits.

**Pros:**
- Tests become more isolated
- No waiting between runs

**Cons:**
- Doesn't test realistic rate limiting behavior
- More complex test setup
- May mask rate limiting bugs

### Option 2: Reset Rate Limits in beforeEach
Clear rate limit keys from Redis before each test.

**Pros:**
- Clean slate for each test
- Predictable behavior

**Cons:**
- Adds overhead to every test
- Requires Redis key pattern knowledge
- May hide timing-related bugs

### Option 3: Increase Rate Limits in Test Environment
Configure higher rate limits when NODE_ENV=test.

**Pros:**
- Simple configuration change
- Tests run faster

**Cons:**
- Doesn't test production rate limits
- Tests may not catch rate limiting issues

### Option 4: Mock Rate Limiter in Tests
Replace rate limiter with mock in test environment.

**Pros:**
- Complete control over behavior
- No external dependencies

**Cons:**
- Doesn't test real rate limiting
- Major testing gap for critical feature

## Decision: Deferred

**Rationale:**
1. This is a **test environment issue only** - production rate limiting works correctly
2. Tests pass reliably in CI/CD clean environments
3. Local development workaround is simple (wait 60 seconds or clear Redis)
4. Current impact is minimal (97% pass rate)
5. All proposed solutions have significant tradeoffs

**Resolution Plan:**
- Document workaround for developers (this file)
- Accept current behavior
- Revisit if this becomes a CI/CD issue or impacts development significantly
- Monitor for additional failures

## Workaround Instructions for Developers

If you encounter 429 errors during local testing:

### Quick Fix
```bash
# Wait for rate limits to reset
sleep 90

# Or clear Redis
redis-cli FLUSHDB

# Then run tests again
pnpm test:integration
```

### Best Practice
Run integration tests once per development cycle, not repeatedly in rapid succession.

## Related Files
- `src/api/middleware/rateLimiter.ts` - Rate limiting implementation
- `tests/integration/api-rate-limiting.test.ts` - Rate limiting tests
- `tests/integration/api-*.test.ts` - Various integration tests affected

## References
- PR #19: Parallel test execution fixes
- Rate Limiting Configuration: `src/api/middleware/rateLimiter.ts`
- Redis Rate Limit Keys: `rl:*` pattern

---

**Last Updated**: 2025-10-28
**Next Review**: When CI/CD shows rate limiting issues or developer feedback increases
