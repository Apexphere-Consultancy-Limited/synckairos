# Design Decisions - Phase 1

## Core Decisions

### 1. Redis as PRIMARY Store
**Decision**: Redis is source of truth, not PostgreSQL

**Rationale**:
- Need <5ms operations (PostgreSQL is 10-30ms)
- Built-in Pub/Sub for multi-instance
- TTL for auto-cleanup
- Horizontal scaling built-in

**Trade-off**: Data loss on Redis failure → mitigated by PostgreSQL audit

---

### 2. PostgreSQL as AUDIT Only
**Decision**: Async writes only, never read on hot path

**Rationale**:
- Can't block <5ms operations
- Provides durability + recovery
- Analytics/reporting separate from real-time

**Trade-off**: Eventual consistency → acceptable for audit trail

---

### 3. BullMQ for Async Writes
**Decision**: Use BullMQ queue instead of direct PostgreSQL writes

**Rationale**:
- Built-in retry logic (5 attempts)
- Redis-backed (consistent with architecture)
- Handles PostgreSQL downtime gracefully
- Non-blocking hot path

**Alternatives Considered**:
- Direct writes: Blocks hot path
- In-memory queue: Lost on restart
- RabbitMQ: Extra infrastructure

---

### 4. Optimistic Locking (Version Field)
**Decision**: Use version field for concurrent modification detection

**Rationale**:
- Multi-instance environment needs conflict detection
- Simple to implement
- Fails fast on conflicts

**Alternative**: Pessimistic locks → would require distributed lock manager

---

### 5. 1-Hour TTL
**Decision**: All sessions expire after 1 hour of inactivity

**Rationale**:
- Prevents Redis memory growth
- Matches typical session timeout
- Can recover from PostgreSQL if needed

**Trade-off**: Active monitoring needed for long sessions

---

### 6. Separate Pub/Sub Client
**Decision**: Dedicated Redis connection for Pub/Sub

**Rationale**:
- ioredis requirement
- Prevents command blocking
- Clear separation of concerns

---

### 7. Zero Instance-Local State
**Decision**: No in-memory caches, Maps, or Sets

**Rationale**:
- Any instance can serve any request
- No warm-up period needed
- No cache invalidation complexity
- True horizontal scaling

**Trade-off**: Every read hits Redis → acceptable at <1ms latency

---

## Performance Targets Achieved

| Operation | Target | Actual | Multiplier |
|-----------|--------|--------|------------|
| getSession | <3ms | 0.25ms | 12x better |
| updateSession | <5ms | 0.46ms | 10x better |
| Pub/Sub | <2ms | 0.19ms | 10x better |

---

## What We're NOT Doing (and why)

❌ **No in-memory caching** - breaks multi-instance
❌ **No sticky sessions** - limits scaling
❌ **No local timers** - drift and sync issues
❌ **No synchronous PostgreSQL** - breaks latency
❌ **No eventual consistency on reads** - Redis is immediate
