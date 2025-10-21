# Troubleshooting Guide

## Common Issues

### Redis Connection Failed

**Error**: `ECONNREFUSED` or `Redis client error`

**Solutions**:
```bash
# Check Redis is running
redis-cli ping  # Should return PONG

# Start Redis
docker run -d -p 6379:6379 redis:7-alpine

# Check REDIS_URL
echo $REDIS_URL  # Should be redis://localhost:6379
```

---

### PostgreSQL Connection Failed

**Error**: `SASL: SCRAM-SERVER-FIRST-MESSAGE` or `password must be a string`

**Solutions**:
```bash
# Check DATABASE_URL format
# Correct: postgresql://user:pass@localhost:5432/dbname
# Check password has no special characters or escape them

# Test connection
psql $DATABASE_URL -c "SELECT 1"
```

---

### Session Not Found (TTL Expired)

**Error**: `getSession()` returns `null`

**Cause**: Session exceeded 1-hour TTL

**Solutions**:
- Expected behavior for inactive sessions
- Recovery from PostgreSQL (Phase 2 feature)
- Increase TTL if needed (edit `SESSION_TTL` in RedisStateManager)

---

### Concurrent Modification Error

**Error**: `ConcurrencyError: Concurrent modification detected`

**Cause**: Another instance updated session between read and write

**Solution**:
```typescript
// Implement retry logic
for (let i = 0; i < 3; i++) {
  try {
    const state = await manager.getSession(id)
    await manager.updateSession(id, newState, state.version)
    break
  } catch (error) {
    if (error instanceof ConcurrencyError && i < 2) continue
    throw error
  }
}
```

---

### BullMQ Jobs Failing

**Error**: `[Worker] Job failed for session`

**Check**:
```typescript
// View failed jobs
const metrics = await queue.getMetrics()
console.log(`Failed: ${metrics.failed}`)

// Check logs for error details
// Will show:
// - Connection errors → will retry
// - Constraint violations → skipped
// - Unknown errors → will retry
```

**Solutions**:
- Connection errors: Check PostgreSQL
- Constraint violations: Expected, check data integrity
- Persistent failures: Check logs for root cause

---

### Performance Issues

**Symptom**: Operations taking >5ms

**Diagnosis**:
```bash
# Run performance tests
pnpm test tests/performance/RedisStateManager.perf.test.ts

# Check Redis latency
redis-cli --latency
redis-cli --latency-history

# Check network latency
ping <redis-host>
```

**Solutions**:
- High Redis latency → Use Redis Cluster or closer instance
- High network latency → Co-locate app and Redis
- Too many connections → Adjust pool settings

---

### Memory Issues

**Symptom**: Redis running out of memory

**Diagnosis**:
```bash
redis-cli info memory
redis-cli dbsize  # Number of keys
```

**Solutions**:
- TTL working correctly? (check with `redis-cli TTL session:xxx`)
- Too many sessions? Increase Redis memory or use Redis Cluster
- Memory leak? Monitor over time

---

### Multi-Instance Not Syncing

**Symptom**: Updates from one instance not reaching others

**Check**:
```bash
# Monitor Pub/Sub
redis-cli MONITOR

# Subscribe to updates
redis-cli SUBSCRIBE session-updates
```

**Solutions**:
- Verify separate Pub/Sub client created
- Check subscribeToUpdates() called once at startup
- Verify all instances using same Redis

---

## Debugging Tips

### Enable Debug Logging

```bash
LOG_LEVEL=debug pnpm dev
```

### Monitor Redis Operations

```bash
redis-cli MONITOR
```

### Check PostgreSQL Writes

```sql
-- Recent events
SELECT * FROM sync_events ORDER BY timestamp DESC LIMIT 10;

-- Session history
SELECT * FROM sync_sessions WHERE session_id = 'xxx';
```

### Inspect BullMQ Queue

```typescript
const metrics = await queue.getMetrics()
console.log(metrics)
// { waiting: 0, active: 2, completed: 1000, failed: 0, delayed: 0 }
```

---

## Health Checks

```bash
# Redis
redis-cli ping

# PostgreSQL
psql $DATABASE_URL -c "SELECT 1"

# Application
curl http://localhost:3000/health

# All systems
pnpm run health-check  # (TODO: Create this script)
```

---

## Getting Help

1. Check logs: `tail -f logs/app.log`
2. Run diagnostics: `pnpm run diagnose` (TODO)
3. Search issues: GitHub Issues
4. Ask: GitHub Discussions
