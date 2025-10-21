# Configuration Reference

## Environment Variables

```bash
# Redis (PRIMARY - Required)
REDIS_URL=redis://localhost:6379

# PostgreSQL (AUDIT - Required)
DATABASE_URL=postgresql://user:pass@localhost:5432/synckairos
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=20
DATABASE_SSL=false

# Application
NODE_ENV=development|production|test
PORT=3000

# Logging
LOG_LEVEL=info|debug|warn|error
```

## Redis Configuration

**File**: `src/config/redis.ts`

```typescript
createRedisClient()
// - Max retries: 3
// - Retry delay: 100ms, 200ms, 300ms
// - Reconnect on: READONLY, ECONNRESET errors
```

## PostgreSQL Configuration

**File**: `src/config/database.ts`

```typescript
// Pool settings
min: 2 connections
max: 20 connections
idleTimeoutMillis: 30000
connectionTimeoutMillis: 5000
```

## RedisStateManager Constants

```typescript
SESSION_PREFIX = 'session:'
SESSION_TTL = 3600  // 1 hour
```

## BullMQ Settings

```typescript
Queue: 'db-writes'
Retries: 5
Backoff: exponential (2s base)
Concurrency: 10 workers
Cleanup: Last 100 jobs, 1 hour retention
```

## .env.example

```bash
REDIS_URL=redis://localhost:6379
DATABASE_URL=postgresql://localhost:5432/synckairos
NODE_ENV=development
PORT=3000
LOG_LEVEL=info
```
