# SyncKairos v2.0 - Component Dependencies

**Purpose:** Visual representation of component dependencies and critical path
**Last Updated:** 2025-10-21

---

## Critical Path Overview

The **critical path** is the sequence of tasks that must be completed in order - any delay blocks subsequent work.

```
Week 1: Project Setup
   ↓
Week 1: RedisStateManager ⭐ CRITICAL
   ↓
Week 1: SyncEngine ⭐ CRITICAL
   ↓
Week 2: REST API ⭐ CRITICAL
   ↓
Week 2: WebSocket Server ⭐ CRITICAL
   ↓
Week 3: Load Testing ⭐ CRITICAL (validates performance)
   ↓
Week 4: Production Deployment ⭐ CRITICAL
   ↓
🚀 LAUNCH!
```

**Total Critical Path Time:** ~18-22 days (across 4 weeks)

---

## Full Dependency Graph

```
Phase 1: Core Architecture (Week 1)
│
├─ 1.1 Project Setup
│    ↓
├─ 1.2 RedisStateManager ⭐ CRITICAL PATH
│    │
│    ├─→ 1.4 DBWriteQueue (parallel after structure exists)
│    │
│    ├─→ 2.1 SyncEngine ⭐ (Week 2)
│    │    │
│    │    ├─→ 2.2 REST API ⭐ (Week 2)
│    │    │    │
│    │    │    └─→ 2.3 Request Validation (Week 2)
│    │    │
│    │    └─→ 2.4 WebSocket Server ⭐ (Week 2)
│    │         │
│    │         └─→ 3.5 Load Testing ⭐ (Week 3)
│    │              │
│    │              └─→ 4.x Deployment ⭐ (Week 4)
│    │
│    └─→ 3.1-3.4 Logging, Metrics, Health, Tests (Week 3, parallel)
│
└─ 1.3 PostgreSQL Schema (parallel, no dependencies)


Legend:
⭐ = Critical Path (blocks other work)
→ = Depends on
(parallel) = Can work simultaneously
```

---

## Component Dependency Matrix

| Component | Depends On | Blocks | Can Parallelize With |
|-----------|-----------|--------|---------------------|
| **1.1 Project Setup** | None | Everything | None |
| **1.2 RedisStateManager** ⭐ | Project Setup | SyncEngine, DBWriteQueue | PostgreSQL Schema |
| **1.3 PostgreSQL Schema** | None | DBWriteQueue | RedisStateManager, SyncEngine |
| **1.4 DBWriteQueue** | RedisStateManager (structure) | Nothing | SyncEngine |
| **2.1 SyncEngine** ⭐ | RedisStateManager | REST API, WebSocket | DBWriteQueue, PostgreSQL Schema |
| **2.2 REST API** ⭐ | SyncEngine | Request Validation | WebSocket Server |
| **2.3 Request Validation** | REST API | Nothing | WebSocket Server |
| **2.4 WebSocket Server** ⭐ | SyncEngine, RedisStateManager | Load Testing | REST API, Request Validation |
| **3.1 Logging** | None | Nothing | Everything in Week 3 |
| **3.2 Metrics** | None | Nothing | Everything in Week 3 |
| **3.3 Health Checks** | RedisStateManager, PostgreSQL | Nothing | Logging, Metrics |
| **3.4 Unit Tests** | Components to test | Nothing | Logging, Metrics, Health |
| **3.5 Load Testing** ⭐ | REST API, WebSocket, All Phase 1-2 | Deployment | Logging, Metrics (helps with validation) |
| **4.1 Docker** | All Phase 1-2 | PaaS Deployment | Logging, Metrics, Tests |
| **4.2 PaaS Config** ⭐ | Docker | Infrastructure, Production | Monitoring setup |
| **4.3 Infrastructure** ⭐ | PaaS Config | Production Validation | Monitoring dashboards |
| **4.4 Production** ⭐ | All previous phases | Launch! | Nothing |

---

## Parallelization Opportunities

### Week 1
**While building RedisStateManager (Day 1-3):**
- ✅ Can setup PostgreSQL schema (1.3)
- ✅ Can work on project documentation
- ✅ Can prepare test infrastructure

**After RedisStateManager structure exists (Day 2+):**
- ✅ Can implement DBWriteQueue (1.4)
- ⚠️ Don't start SyncEngine yet (wait for RedisStateManager to be fully tested)

### Week 2
**While building SyncEngine (Day 1-3):**
- ✅ Can work on Zod validation schemas (2.3) in advance
- ✅ Can write integration test scaffolding

**After SyncEngine complete (Day 3+):**
- ✅ REST API and WebSocket Server can be built in parallel
- ✅ Request validation can be added alongside API development

### Week 3
**Fully parallel work:**
- ✅ Logging (3.1)
- ✅ Metrics (3.2)
- ✅ Health Checks (3.3)
- ✅ Unit Tests (3.4)
- ⚠️ Load Testing (3.5) should be done after other monitoring is in place

### Week 4
**While deploying:**
- ✅ Docker (4.1) → PaaS Config (4.2) is sequential
- ✅ Infrastructure (4.3) can overlap with PaaS deployment
- ✅ Monitoring dashboards can be set up while infrastructure provisions

---

## Critical Path Breakdown

### Must Complete In Order (No Parallelization)

1. **Project Setup** (0.5 days)
   - Blocks: Everything
   - Why: Need tooling and structure before coding

2. **RedisStateManager** (2-3 days)
   - Blocks: SyncEngine, DBWriteQueue
   - Why: Foundation for all state management

3. **SyncEngine** (2-3 days)
   - Blocks: REST API, WebSocket Server
   - Why: Contains all business logic

4. **REST API** (2-3 days)
   - Blocks: Load Testing
   - Why: Need endpoints to test

5. **WebSocket Server** (2 days)
   - Blocks: Load Testing
   - Why: Need real-time updates to test

6. **Load Testing** (2 days)
   - Blocks: Production Deployment
   - Why: Must validate performance before launch

7. **Production Deployment** (2-3 days)
   - Blocks: Launch
   - Why: Final milestone

**Total:** 13-18 days of sequential work

**Actual calendar time:** 4 weeks (28 days) due to parallel work

---

## Bottleneck Analysis

### Primary Bottleneck: RedisStateManager
- **Impact:** Blocks all of Week 2 work
- **Mitigation:**
  - Focus full attention here in Week 1
  - Get it right the first time (tests >90% coverage)
  - Don't rush - this is the foundation

### Secondary Bottleneck: SyncEngine
- **Impact:** Blocks REST API and WebSocket
- **Mitigation:**
  - Thorough unit tests before moving on
  - Validate time calculations are accurate
  - Test optimistic locking carefully

### Final Bottleneck: Load Testing
- **Impact:** Blocks production deployment
- **Mitigation:**
  - Run tests early (mid-Week 3)
  - If performance issues found, fix immediately
  - Don't wait until end of Week 3

---

## Risk: Dependency Delays

If a critical path component is delayed:

| Delayed Component | Impact | Recovery Strategy |
|-------------------|--------|------------------|
| RedisStateManager (+1 day) | Week 2 starts 1 day late | Work extra hours, simplify DBWriteQueue |
| SyncEngine (+1 day) | REST API delayed | Parallelize with WebSocket if possible |
| Load Testing fails | Can't deploy Week 4 | Optimize hot path immediately, re-test |
| Infrastructure setup slow | Deployment delayed | Use simpler hosting (single instance first) |

---

## Recommended Work Order

### Week 1 (5 days)
- **Day 1:** Project Setup (morning) + RedisStateManager (afternoon)
- **Day 2:** RedisStateManager (continue) + PostgreSQL Schema (parallel)
- **Day 3:** RedisStateManager (finish + test) + DBWriteQueue (start)
- **Day 4:** DBWriteQueue (finish) + Validation (start)
- **Day 5:** Validation (finish) + SyncEngine (start)

### Week 2 (5 days)
- **Day 6:** SyncEngine (continue)
- **Day 7:** SyncEngine (finish + test) + REST API (start)
- **Day 8:** REST API (continue) + WebSocket (start in parallel)
- **Day 9:** REST API + WebSocket (finish)
- **Day 10:** Request Validation + Integration Tests

### Week 3 (5 days)
- **Day 11:** Logging + Metrics (parallel)
- **Day 12:** Health Checks + Unit Test Coverage
- **Day 13:** Load Testing setup
- **Day 14:** Load Testing execution
- **Day 15:** Load Testing analysis + optimization if needed

### Week 4 (5 days)
- **Day 16:** Docker + docker-compose
- **Day 17:** PaaS Configuration (Fly.io)
- **Day 18:** Infrastructure Setup (Redis, PostgreSQL, Monitoring)
- **Day 19:** Staging Deployment + Validation
- **Day 20:** Production Deployment 🚀

---

## Next Steps

1. **Start with Phase 1.1:** [phases/PHASE_1.md](phases/PHASE_1.md#component-11-project-setup)
2. **Track progress:** Update status as you complete tasks
3. **Review dependencies:** Before starting each component, check this document
4. **Identify blockers early:** If stuck, adjust plan or ask for help

---

**Remember:** The critical path is sacred. Don't skip RedisStateManager testing to "move faster" - it will slow you down later. Build solid foundations.
