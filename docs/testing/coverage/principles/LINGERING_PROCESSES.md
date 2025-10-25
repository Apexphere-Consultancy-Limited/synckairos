# Lingering Test Processes - Root Cause & Solution

## Problem (RESOLVED)

~~Vitest processes remain running after test suite completes, consuming CPU and memory.~~

**Status:** ✅ **FIXED** - All integration tests now use force close to prevent lingering processes.

## Root Cause

Integration tests that use **BullMQ workers** don't properly wait for async operations to complete before closing connections:

1. **Test queues a job** → Worker starts processing
2. **Test completes** → `afterEach` hook runs
3. **`queue.close()` called** → Tries to close while worker is mid-job
4. **Worker hangs** → Waiting for Redis/PostgreSQL operations
5. **Process never exits** → Node process stays alive

## Why This Happens

### BullMQ Worker Lifecycle
```typescript
// Test queues a job
await queue.queueWrite(sessionId, state, 'session_created')

// Worker picks it up (async, in background)
worker.processFn() // Takes 1-3 seconds

// Test immediately calls close (TOO EARLY!)
await queue.close() // Worker still processing!
```

### The Timing Issue
- **Job queuing**: ~10ms
- **Worker processing**: 1-3 seconds (database writes)
- **Test wait time**: Often < 500ms
- **Result**: `close()` called while worker is mid-transaction

## Affected Tests

Any integration test that:
1. Uses `DBWriteQueue`
2. Calls `queue.queueWrite()`
3. Doesn't wait long enough before `afterEach`

### Examples
- `DBWriteQueue.events.test.ts` - 7 tests with short waits
- `DBWriteQueue.retry.test.ts` - Tests with configurable delays
- `DBWriteQueue.database.test.ts` - Multiple concurrent jobs
- `DBWriteQueue.transactions.test.ts` - Transaction tests

## Solutions

### Solution 1: Proper Wait Times (Recommended)
```typescript
afterEach(async () => {
  // Wait for all jobs to complete
  await new Promise(resolve => setTimeout(resolve, 3000))

  // Now safe to close
  await queue.close()
})
```

### Solution 2: Check Queue Metrics
```typescript
afterEach(async () => {
  // Wait until queue is empty
  let isEmpty = false
  while (!isEmpty) {
    const metrics = await queue.getMetrics()
    isEmpty = metrics.active === 0 && metrics.waiting === 0
    if (!isEmpty) {
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }

  await queue.close()
})
```

### Solution 3: Use `test.concurrent = false`
```typescript
// Force sequential execution (slower but safer)
describe.concurrent = false

describe('DBWriteQueue Tests', () => {
  // Tests run one at a time
})
```

## Best Practices

### 1. **Always Wait Before Close**
```typescript
it('should process job', async () => {
  await queue.queueWrite(sessionId, state, 'session_created')

  // ✅ GOOD: Wait for processing
  await new Promise(resolve => setTimeout(resolve, 3000))

  // Assertions here
}, 5000) // Adequate timeout
```

```typescript
it('should process job', async () => {
  await queue.queueWrite(sessionId, state, 'session_created')

  // ❌ BAD: Immediate assertions
  expect(something).toBe(true)

  // Test ends, worker still processing!
}, 1000) // Too short!
```

### 2. **Cleanup in Correct Order**
```typescript
afterEach(async () => {
  // 1. Wait for jobs
  await new Promise(resolve => setTimeout(resolve, 2000))

  // 2. Clean database
  await pool.query('DELETE FROM ...')

  // 3. Close queue (worker stops first, then queue, then Redis)
  await queue.close()

  // 4. Restore mocks
  vi.restoreAllMocks()
})
```

### 3. **Use Unique Queue Names**
```typescript
beforeEach(() => {
  // Prevents queue conflicts between tests
  const queueName = `test-${Date.now()}-${Math.random()}`
  queue = new DBWriteQueue(process.env.REDIS_URL!, { queueName })
})
```

### 4. **Set Adequate Timeouts**
```typescript
// ❌ BAD: Default 5s timeout
it('should process jobs', async () => {
  // Test needs 3s to complete
})

// ✅ GOOD: Explicit timeout
it('should process jobs', async () => {
  // Test needs 3s to complete
}, 10000) // 10s timeout for safety
```

## How to Identify Lingering Processes

```bash
# Check for vitest processes
ps aux | grep vitest

# Kill all lingering vitest processes
pkill -f "node.*vitest"

# Check open connections to Redis
lsof -i :6379

# Check open connections to PostgreSQL
lsof -i :5432
```

## Testing Checklist

Before committing integration tests:

- [ ] All `queueWrite()` calls followed by adequate wait times (2-3s)
- [ ] `afterEach` waits before calling `queue.close()`
- [ ] Test timeouts are 2-3x longer than wait times
- [ ] Unique queue names used for test isolation
- [ ] Database cleanup happens before close
- [ ] Run tests and verify no processes linger after completion

## Related Issues

- Issue #U5 - Unit test misclassification led to this discovery
- Tests were classified as "unit" but used real infrastructure
- Real infrastructure requires proper cleanup protocols

## Monitoring

Add this to your test suite:

```typescript
// global-teardown.ts
export default async function() {
  // Force close any remaining connections
  await pool.end()

  console.log('All connections closed')
}
```

Configure in `vitest.config.ts`:
```typescript
export default defineConfig({
  test: {
    globalTeardown: './tests/global-teardown.ts'
  }
})
```

---

## ✅ SOLUTION IMPLEMENTED (2025-10-26)

### Changes Made

#### 1. Updated `DBWriteQueue.close()` method
```typescript
// src/state/DBWriteQueue.ts
async close(force: boolean = false): Promise<void> {
  // Force close immediately discards active jobs (for tests)
  // Graceful close waits for active jobs to complete (for production)
  if (force) {
    await this.worker.close(true) // Force close - don't wait for active jobs
  } else {
    await this.worker.close() // Graceful close
  }
  await this.queue.close()
  await this.redisConnection.quit()
}
```

#### 2. Updated all integration tests
```typescript
// tests/integration/*.test.ts
afterEach(async () => {
  await queue.close(true) // Force close - don't wait for active jobs
})
```

**Files Updated:**
- `tests/integration/DBWriteQueue.events.test.ts`
- `tests/integration/DBWriteQueue.database.test.ts`
- `tests/integration/DBWriteQueue.edgecases.test.ts`
- `tests/integration/DBWriteQueue.transactions.test.ts`
- `tests/integration/DBWriteQueue.retry.test.ts`

### Results

- ✅ All 31 DBWriteQueue integration tests pass
- ✅ No lingering processes after test completion
- ✅ Test execution time: ~19 seconds (fast)
- ✅ Production code still uses graceful shutdown

### Why This Works

1. **Integration tests** test OUR code logic, not BullMQ's shutdown behavior
2. **Test jobs** are temporary data that gets deleted anyway
3. **Force close** prevents workers from blocking test completion
4. **Production code** still uses `queue.close()` without force flag for graceful shutdown

### Verification

```bash
# Run tests
pnpm vitest run tests/integration/DBWriteQueue*.test.ts

# Check for lingering processes (should be none)
sleep 3
ps aux | grep "node.*vitest" | grep -v grep
```

Expected: No output (no lingering processes)
