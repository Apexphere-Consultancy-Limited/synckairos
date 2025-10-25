# Performance Tests

This directory contains performance benchmarks and load tests that measure actual throughput, latency, and system behavior under load.

## Purpose

Performance tests are **intentionally slow** because they:
- Measure real-world performance characteristics
- Test system behavior under realistic load
- Validate performance targets (latency, throughput, concurrency)
- Require multiple iterations for statistical significance

These tests are **NOT failures** - they are benchmarks that take time by design.

## Running Performance Tests

```bash
# Run all performance tests
pnpm test:performance

# Run specific performance test
pnpm test:performance tests/performance/DBWriteQueue.performance.test.ts
```

## Excluding from CI/CD

Performance tests are excluded from:
- Default test runs (`pnpm test`)
- Coverage reports (`pnpm test:coverage`)
- CI/CD pipelines (unless explicitly configured)

This is configured in:
- `vitest.config.ts` - `exclude` array
- `package.json` - `test:coverage` script with `--exclude` flag

## Test Files

- **DBWriteQueue.performance.test.ts** - Database write queue throughput and concurrency benchmarks
- **RedisStateManager.perf.test.ts** - Redis state manager performance tests

## Adding New Performance Tests

When creating new performance tests:

1. **Use descriptive names**: `ComponentName.performance.test.ts` or `ComponentName.perf.test.ts`
2. **Use realistic loads**: Test with production-like data volumes
3. **Set appropriate timeouts**: Use large timeout values (20s+) in test configuration
4. **Use real UUIDs**: Always use `uuidv4()` for proper database constraints
5. **Clean up data**: Always clean up test data after runs
6. **Document expectations**: Add comments explaining expected performance targets

## Example Structure

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { v4 as uuidv4 } from 'uuid'

describe('Component - Performance Benchmarks', () => {
  beforeEach(() => {
    // Setup with unique identifiers for test isolation
    const uniqueId = `perf-${Date.now()}-${Math.random()}`
  })

  afterEach(async () => {
    // Cleanup resources
  })

  it('should handle high throughput', async () => {
    // Test with realistic load
    // Measure and assert performance metrics
  }, 30000) // Large timeout for slow operations
})
```

## Best Practices

- **Test isolation**: Use unique queue names/identifiers to avoid conflicts
- **Parallel execution**: Design tests to run independently
- **Realistic scenarios**: Model after production workloads
- **Statistical significance**: Run multiple iterations when needed
- **Clear assertions**: Assert against defined performance targets

## Performance Targets

Current targets for SyncKairos:

- **Queue latency**: <1s for 100 jobs
- **Sequential queuing**: <2s for 50 jobs
- **Concurrent processing**: 10 workers should process 20 jobs in <10s
- **Metrics calls**: 100 getMetrics() calls in <500ms
- **Large state objects**: Handle 100+ participants without degradation

These targets are validated in the test files and should be updated as system requirements evolve.
