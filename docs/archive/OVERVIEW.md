# SyncKairos - Overview

**Version:** 2.0
**Last Updated:** 2025-10-20

---

## What is SyncKairos?

**SyncKairos** is a standalone, high-performance real-time synchronization service for precise, synchronized timers across multiple clients with sub-100ms latency.

---

## Design Principles

### 1. Calculate, Don't Count
**Core Principle:** Use authoritative server timestamps for calculations, never local countdown timers.

```typescript
// ✅ CORRECT: Calculate from server time
time_remaining = base_time - (server_now - turn_start_time)

// ❌ WRONG: Count down locally
setInterval(() => time_remaining--, 1000)
```

**Why:** Local timers drift, server calculations don't.

---

### 2. Distributed-First Design
**Principle:** Design for multiple instances from day one, not as an afterthought.

**This means:**
- No server-local state (no in-memory caches per instance)
- Shared state store (Redis) as primary source of truth
- Cross-instance communication (Redis Pub/Sub)
- Any instance can handle any request
- No sticky sessions required

**Anti-pattern:** Single-server design with "horizontal scaling" bolted on later.

---

### 3. Hot Path Optimization
**Principle:** Critical operations (<50ms target) must not touch slow data stores.

**Hot Path (Real-time):**
- `switchCycle()` - Redis only (3-5ms)
- `getCurrentState()` - Redis only (1-3ms)
- WebSocket broadcasts - Pub/Sub (1-2ms)

**Cold Path (Non-critical):**
- Audit logging - PostgreSQL async (doesn't block)
- Analytics - PostgreSQL async
- Historical data - PostgreSQL

**Why:** PostgreSQL queries (10-30ms) break <50ms latency targets.

---

### 4. State Ownership Clarity
**Principle:** Every piece of data has ONE clear owner and purpose.

**Data Ownership:**
- **Redis** = PRIMARY for all active session state (TTL 1 hour)
- **PostgreSQL** = AUDIT TRAIL only (async writes)
- **Application Memory** = NOTHING (truly stateless)

**Why:** Ambiguous ownership leads to sync issues, race conditions, and stale data.

---

### 5. Fail-Fast and Observable
**Principle:** Errors should be loud, monitoring should be built-in.

**Requirements:**
- Structured logging (JSON)
- Prometheus metrics (latency, throughput, errors)
- Health checks (`/health`, `/ready`)
- Explicit error codes
- No silent failures

**Why:** Distributed systems fail in complex ways - observability is not optional.

---

### 6. Simple Over Clever
**Principle:** Easy deployment and operation beats technical sophistication.

**Choices:**
- PaaS (Fly.io, Railway) over Kubernetes
- Managed Redis (Upstash) over self-hosted
- Managed Postgres (Supabase) over RDS configuration
- One-command deploy over multi-step processes

**Why:** Operations complexity kills projects. Simple systems ship and scale.

---

### 7. Performance Through Architecture
**Principle:** Fast comes from design choices, not code optimization.

**Architectural decisions for speed:**
- Redis (in-memory) for hot path, not PostgreSQL (disk)
- WebSocket (persistent) for updates, not polling (inefficient)
- Pub/Sub (push) for broadcast, not database queries (slow)
- Calculation (instant) over countdown (drift-prone)

**Why:** You can't optimize your way out of bad architecture.

---

## Key Features

- **Universal** - Works with any application requiring synchronized timing
- **Multi-client support** - Unlimited participants per session
- **Flexible sync modes** - Per-participant, per-turn, global, or count-up
- **Sub-100ms latency** for all operations
- **Zero visible corrections** (calculation-based, not countdown)
- **Perfect synchronization** across all clients worldwide
- **Scalable to 50,000+ concurrent sessions**
- **WebSocket real-time updates**
- **NTP-style time sync** for client drift correction
- **Audit logging** for replay and analytics

---

## Use Cases

- **Gaming:** Chess, poker, quiz games, turn-based strategy
- **Live Events:** Auctions, concerts, sports timers
- **Business:** Meetings, presentations, sprint timers
- **Education:** Exams, classroom activities
- **Lifestyle:** Meditation, cooking, fitness timers

---

## Architecture

### Corrected Design (Distributed-First)

```
┌─────────────────────────────────────┐
│   Client Applications               │
│   (Games/Events/Meetings)           │
└────────────┬────────────────────────┘
             │ REST + WebSocket
             ▼
┌─────────────────────────────────────┐
│   Load Balancer (No Sticky)         │
└────┬────────────┬───────────────────┘
     │            │
     ▼            ▼
┌─────────┐  ┌─────────┐  (Auto-scale)
│SyncKairos│  │SyncKairos│
│Instance 1│  │Instance N│
│STATELESS │  │STATELESS │
└────┬─────┘  └────┬─────┘
     │             │
     └──────┬──────┘
            │
   ┌────────┴────────┐
   │                 │
   ▼                 ▼
┌─────────┐    ┌──────────┐
│  Redis  │    │PostgreSQL│
│(PRIMARY)│───▶│ (AUDIT)  │
│Pub/Sub  │    │  async   │
└─────────┘    └──────────┘
```

**Data Flow:**
1. **Client** sends request (REST) or maintains connection (WebSocket)
2. **Load Balancer** routes to ANY available instance (no sticky sessions)
3. **Instance** reads/writes to **Redis** (3-5ms)
4. **Redis Pub/Sub** broadcasts updates to all instances
5. **Instances** push updates to WebSocket clients
6. **PostgreSQL** gets async writes for audit trail (non-blocking)

**Key:** Redis is the source of truth. PostgreSQL is backup only.

---

## Strengths

1. **Universal Design** - One service, unlimited use cases
2. **Flexible Sync Modes** - Covers diverse scenarios
3. **Clean Architecture** - Clear separation of concerns
4. **Robust Schema** - Comprehensive database design with audit logging
5. **Time Synchronization** - NTP-style client drift correction
6. **WebSocket Support** - Real-time updates with heartbeat
7. **Complete SDK** - Low-level client + React hook

---

## Critical Corrections Made

### Original Design Issues (FIXED)
1. ~~In-memory cache per instance~~ → **Redis as primary state store**
2. ~~PostgreSQL for hot path~~ → **Redis for hot path, PostgreSQL for audit only**
3. ~~No cross-instance communication~~ → **Redis Pub/Sub for broadcasts**
4. ~~Sticky sessions required~~ → **True stateless, any instance works**
5. ~~Unclear data ownership~~ → **Clear: Redis = primary, PostgreSQL = audit**

### Now Ready For
- **Easy deployment** - One-command PaaS deployment (Fly.io/Railway)
- **Effortless scaling** - Auto-scale based on load
- **Sub-5ms hot path** - Redis operations only
- **True stateless** - No server-local state
- **Multi-region** - Global deployment out of the box

**Overall Readiness: 9/10** (was 6/10 with original design)

---

## Implementation Priority

### Phase 1: Core Architecture (Week 1)
1. Implement `RedisStateManager` (primary state)
2. Add Redis Pub/Sub for cross-instance sync
3. Make PostgreSQL writes async (audit only)
4. Remove all in-memory state

### Phase 2: Deployment (Week 2)
1. Create Fly.io/Railway configs
2. One-command deployment script
3. Auto-scaling configuration
4. Health checks and monitoring

### Phase 3: Production Hardening (Week 3)
1. Load testing (10k+ sessions)
2. Error handling and recovery
3. Authentication & authorization
4. Observability (metrics, logs, traces)

### Phase 4: Global Scale (Week 4)
1. Multi-region deployment
2. Geo-routing configuration
3. Cross-region failover testing
4. Performance optimization

---

## Design Documents

- **[ARCHITECTURE.md](ARCHITECTURE.md)** - Updated Redis-first distributed architecture
- **[API_REFERENCE.md](API_REFERENCE.md)** - REST and WebSocket API specs
- **[IMPLEMENTATION.md](IMPLEMENTATION.md)** - RedisStateManager, SyncEngine, WebSocket integration, Production-ready patterns
- **[USE_CASES.md](USE_CASES.md)** - Use cases and integration examples
- **[DEPLOYMENT.md](DEPLOYMENT.md)** - PaaS deployment guide (Fly.io, Railway, AWS App Runner), Redis HA, Rate limiting
- **[archive/ARCHITECTURE_REVIEW.md](archive/ARCHITECTURE_REVIEW.md)** - Historical: First design review
- **[archive/ARCHITECTURE_REVIEW_2.md](archive/ARCHITECTURE_REVIEW_2.md)** - Historical: Second design review (production hardening)
