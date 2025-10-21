# Testing Guide

## Quick Start

```bash
# All tests
pnpm test

# With coverage
pnpm test:coverage

# Unit tests only
pnpm test:unit

# Integration tests
pnpm test:integration

# Multi-instance test
pnpm test:multi-instance

# Performance tests
pnpm test tests/performance/RedisStateManager.perf.test.ts
```

## Test Structure

```
tests/
├── unit/
│   ├── RedisStateManager.test.ts       # 17 tests
│   ├── RedisStateManager.edgecases.ts  # 18 tests
│   ├── DBWriteQueue.test.ts            # Main tests
│   └── DBWriteQueue.*.test.ts          # 38 total
├── integration/
│   ├── database.test.ts                # PostgreSQL schema
│   └── RedisStateManager-DBWriteQueue.test.ts
└── performance/
    └── RedisStateManager.perf.test.ts
```

## Coverage Targets

| Component | Target | Achieved |
|-----------|--------|----------|
| RedisStateManager | >90% | >95% |
| DBWriteQueue | >85% | >92% |
| Overall | >80% | >90% |

## Multi-Instance Validation

Tests cross-instance communication:
```bash
pnpm test:multi-instance
```

Validates:
- State sharing across instances
- Pub/Sub messaging
- Optimistic locking
- Version conflicts

## Performance Benchmarks

Run performance tests:
```bash
pnpm test tests/performance/RedisStateManager.perf.test.ts
```

Expected results:
- getSession: <1ms avg
- updateSession: <1ms avg
- Pub/Sub: <1ms

## Writing Tests

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { RedisStateManager } from '@/state/RedisStateManager'
import { createRedisClient, createRedisPubSubClient } from '@/config/redis'

describe('My Feature', () => {
  let manager: RedisStateManager

  beforeEach(() => {
    const redis = createRedisClient()
    const pubSub = createRedisPubSubClient()
    manager = new RedisStateManager(redis, pubSub)
  })

  afterEach(async () => {
    await manager.close()
  })

  it('should work', async () => {
    // Test here
  })
})
```

## CI/CD

Tests run automatically on:
- Pull requests
- Push to main
- Pre-commit hooks

Requirements:
- All tests must pass
- Coverage must meet targets
- No linting errors
