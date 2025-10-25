# Issue #U4: Redis Eviction Policy Warning

**Priority:** 🟡 MEDIUM
**Status:** 🟡 **ACTIVE** - Warning in all test runs (non-blocking)
**Discovered:** 2025-10-24
**Effort Estimate:** 30 minutes

---

## Description

All tests that connect to Redis show this warning in stderr:

```
IMPORTANT! Eviction policy is allkeys-lru. It should be "noeviction"
```

---

## Root Cause

- Local Redis instance configured with `allkeys-lru` eviction policy
- Production requires `noeviction` to prevent data loss
- Tests running against incorrectly configured Redis
- Warning comes from [src/config/RedisConfig.ts](../../../../src/config/RedisConfig.ts) validation

---

## Impact

- ⚠️ **Not blocking tests** - Tests still pass
- ⚠️ **Configuration mismatch** - Test environment ≠ production
- ⚠️ **Potential data loss in tests** - Keys may be evicted during testing
- ⚠️ **Reduced test reliability** - Unpredictable key eviction

---

## Required Fix

### Option 1: Update docker-compose.yml (Recommended)

```yaml
services:
  redis:
    image: redis:7-alpine
    command: redis-server --maxmemory-policy noeviction
    ports:
      - "6379:6379"
```

### Option 2: Update redis.conf

```conf
maxmemory-policy noeviction
```

---

## Implementation Steps

1. **Update Docker Compose Configuration**
   - [ ] Edit [docker-compose.yml](../../../../docker-compose.yml)
   - [ ] Add `--maxmemory-policy noeviction` to redis command
   - [ ] Restart Redis container: `docker-compose restart redis`

2. **Verify Configuration**
   - [ ] Connect to Redis: `redis-cli`
   - [ ] Check policy: `CONFIG GET maxmemory-policy`
   - [ ] Should return: `noeviction`

3. **Update Documentation**
   - [ ] Document Redis configuration in [DEVELOPMENT.md](../../guides/DEVELOPMENT.md)
   - [ ] Add production requirements to [DEPLOYMENT.md](../../guides/DEPLOYMENT.md)
   - [ ] Update CI/CD Redis service configuration

4. **Validation**
   - [ ] Run tests and verify warning is gone
   - [ ] Verify CI/CD Redis services use correct config
   - [ ] Add Redis config validation to startup script

---

## Verification

After fix, run tests and confirm:
- No eviction policy warnings in test output
- Redis config shows `maxmemory-policy: noeviction`
- Tests still pass

```bash
# Check Redis configuration
redis-cli CONFIG GET maxmemory-policy

# Expected output:
# 1) "maxmemory-policy"
# 2) "noeviction"

# Run tests to verify no warnings
pnpm test:integration
```

---

## Related Issues

- [U2 - SessionNotFoundError](U2-session-not-found-error.md) - May be related to Redis eviction
- [U5 - Unit Test Misclassification](U5-unit-test-misclassification.md) - Test performance issues

---

## Change Log

| Date | Change | Author |
|------|--------|--------|
| 2025-10-24 | Issue identified and documented | Claude Agent |
| 2025-10-25 | Added detailed implementation steps | Claude Agent |
