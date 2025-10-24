# SyncKairos Documentation Map

This document provides a complete map of the SyncKairos documentation and guides you to the right resources.

## Documentation Structure

### Architecture & Design

**[architecture/](architecture/)** - System architecture and design decisions

- **[ARCHITECTURE.md](architecture/ARCHITECTURE.md)** ⭐ **MAIN REFERENCE**
  - System architecture overview (Redis-first distributed design)
  - API Contract - Single Source of Truth (Zod schemas)
  - Database schema design
  - Performance requirements and targets
  - Key architectural decisions

- **[SYSTEM_DESIGN.md](architecture/SYSTEM_DESIGN.md)** - Detailed system design
- **[DATA_FLOW.md](architecture/DATA_FLOW.md)** - Data flow diagrams
- **[DESIGN_DECISIONS.md](architecture/DESIGN_DECISIONS.md)** - Key design decisions
- **[README.md](architecture/README.md)** - Architecture documentation index

**[architecture/ADR/](architecture/ADR/)** - Architectural Decision Records

- **[WEBSOCKET_API_ANALYSIS.md](architecture/ADR/WEBSOCKET_API_ANALYSIS.md)** - STATE_UPDATE vs granular events decision

### Component Documentation

**[components/](components/)** - Internal component API documentation

- **[RedisStateManager.md](components/RedisStateManager.md)** - RedisStateManager class API reference
  - CRUD operations, TTL management, Pub/Sub
  - Performance: 0.25ms GET, 0.46ms UPDATE
  - Best practices and error handling

- **[DBWriteQueue.md](components/DBWriteQueue.md)** - BullMQ audit queue API reference
  - Async PostgreSQL writes via BullMQ
  - Retry logic and metrics

- **[CONFIGURATION.md](components/CONFIGURATION.md)** - Configuration reference
  - Environment variables
  - Redis/PostgreSQL settings
  - Constants and defaults

### Guides & How-Tos

**[guides/](guides/)** - Practical guides for developers and operators

- **[DEVELOPMENT.md](guides/DEVELOPMENT.md)** - Development guide
- **[TESTING.md](guides/TESTING.md)** - Testing guide
- **[DEPLOYMENT.md](guides/DEPLOYMENT.md)** - Deployment guide (Fly.io, Docker)
- **[INFRASTRUCTURE_SETUP.md](guides/INFRASTRUCTURE_SETUP.md)** - Infrastructure setup (Upstash Redis, Supabase PostgreSQL)
- **[TROUBLESHOOTING.md](guides/TROUBLESHOOTING.md)** - Troubleshooting guide
- **[USE_CASES.md](guides/USE_CASES.md)** - Usage examples and integration patterns
- **[MOBILE_CONSIDERATIONS.md](guides/MOBILE_CONSIDERATIONS.md)** 📱 - Mobile client guide
  - Backend requirements for mobile clients
  - Push notification integration (Firebase)
  - Network resilience and battery optimization

### Project Tracking

**[project-tracking/](project-tracking/)** - Implementation management and task tracking

- **[PROJECT_PHASES.md](project-tracking/PROJECT_PHASES.md)** 📋 - 4-week implementation roadmap
- **[DEPENDENCIES.md](project-tracking/DEPENDENCIES.md)** 🔗 - Component dependencies and critical path
- **Phase-specific tracking:**
  - [phases/PHASE_1.md](project-tracking/phases/PHASE_1.md) - Week 1: Core Architecture
  - [phases/PHASE_2.md](project-tracking/phases/PHASE_2.md) - Week 2: Business Logic & API
  - [phases/PHASE_3.md](project-tracking/phases/PHASE_3.md) - Week 3: Testing & Quality
  - [phases/PHASE_4.md](project-tracking/phases/PHASE_4.md) - Week 4: Deployment
- **Detailed task breakdowns:** [tasks/](project-tracking/tasks/)

### Testing Documentation

**[testing/](testing/)** - Test strategies and results

- **[e2e/](testing/e2e/)** - End-to-end testing documentation

### Version 3 Design (Future)

**[design/v3/](design/v3/)** - Future extensible architecture proposals (deferred)

> **Decision:** Following fast time-to-market strategy with v2.0 architecture.
> v3.0 extensible architecture proposals are available for future consideration.

- **[EXTENSIBILITY_REVIEW.md](design/v3/EXTENSIBILITY_REVIEW.md)** 🔄
  - Analysis of v2.0 architectural limitations
  - Decoupling strategies for future extensibility

- **[ARCHITECTURE_V3_PROPOSAL.md](design/v3/ARCHITECTURE_V3_PROPOSAL.md)** 🚀
  - Complete redesign with extensibility built-in
  - Interface-based abstractions (IStateManager, IMessageBroker, ISyncModePlugin)
  - Plugin system for unlimited extensibility
  - **Status:** Deferred in favor of v2.0 fast implementation

- **[ARCHITECTURE_V3_ADDENDUM.md](design/v3/ARCHITECTURE_V3_ADDENDUM.md)** 🔍
  - Additional design considerations for v3.0
  - Transaction models, error handling, observability patterns
  - **Status:** Available for future v3.0 migration

### Archive

**[archive/](archive/)** - Historical and obsolete documentation

- Pre-implementation planning documents (superseded by actual implementation)
- Old architecture reviews (superseded by current architecture)
- Legacy design documents (reference only)

---

## Quick Start

### For Development (v2.0 Implementation)

**If you're building SyncKairos:**

1. **Start Here**: [project-tracking/PROJECT_PHASES.md](project-tracking/PROJECT_PHASES.md) - Get the 4-week roadmap
2. **Review Architecture**: [architecture/ARCHITECTURE.md](architecture/ARCHITECTURE.md) - Technical details
3. **API Contract**: Check the "API Contract - Single Source of Truth" section in ARCHITECTURE.md
   - Zod schemas in `src/api/schemas/session.ts` are the source of truth
   - Auto-generates: Runtime validation + TypeScript types + OpenAPI docs
4. **Component APIs**: [components/](components/) - Internal component documentation
5. **Track Progress**: [project-tracking/TASK_TRACKING.md](project-tracking/TASK_TRACKING.md) - Detailed task breakdown

### For Understanding (Design Review)

**If you're learning about SyncKairos:**

1. **Architecture Overview**: Start with [architecture/ARCHITECTURE.md](architecture/ARCHITECTURE.md)
2. **Explore Use Cases**: See [guides/USE_CASES.md](guides/USE_CASES.md) for your scenario
3. **Review API Contract**: Check the Zod schemas section in ARCHITECTURE.md
4. **Deployment**: Review [guides/DEPLOYMENT.md](guides/DEPLOYMENT.md) for production setup
5. **Mobile Support**: Check [guides/MOBILE_CONSIDERATIONS.md](guides/MOBILE_CONSIDERATIONS.md)

### For API Integration

**If you're integrating with SyncKairos:**

1. **API Documentation**: Access the interactive Swagger UI at `http://localhost:3000/api-docs` (when server is running)
   - Raw OpenAPI JSON available at `http://localhost:3000/api-docs.json`
2. **API Contract Source**: Review Zod schemas in `src/api/schemas/session.ts`
3. **OpenAPI Generator**: See `src/api/openapi.ts` for route definitions
4. **WebSocket Protocol**: Check [architecture/ADR/WEBSOCKET_API_ANALYSIS.md](architecture/ADR/WEBSOCKET_API_ANALYSIS.md)
5. **Usage Examples**: See [guides/USE_CASES.md](guides/USE_CASES.md)

### For Operations (DevOps)

**If you're deploying SyncKairos:**

1. **Infrastructure Setup**: [guides/INFRASTRUCTURE_SETUP.md](guides/INFRASTRUCTURE_SETUP.md) - Upstash Redis + Supabase PostgreSQL
2. **Deployment Guide**: [guides/DEPLOYMENT.md](guides/DEPLOYMENT.md) - Fly.io deployment
3. **Configuration**: [components/CONFIGURATION.md](components/CONFIGURATION.md) - Environment variables
4. **Troubleshooting**: [guides/TROUBLESHOOTING.md](guides/TROUBLESHOOTING.md) - Common issues

### For v3.0 (Future - Deferred)

**Note:** v3.0 architecture is deferred in favor of v2.0 fast time-to-market strategy.

1. **Review v3.0 Proposal**: Read [design/v3/ARCHITECTURE_V3_PROPOSAL.md](design/v3/ARCHITECTURE_V3_PROPOSAL.md)
2. **Critical Considerations**: Review [design/v3/ARCHITECTURE_V3_ADDENDUM.md](design/v3/ARCHITECTURE_V3_ADDENDUM.md)
3. **Compare Approaches**: See [design/v3/EXTENSIBILITY_REVIEW.md](design/v3/EXTENSIBILITY_REVIEW.md)

---

## Core Principles

### 1. Calculate, Don't Count
SyncKairos uses authoritative server timestamps for time calculations instead of local countdown timers, ensuring perfect synchronization across all clients.

### 2. Distributed-First Design
Designed for multiple instances from day one with:
- Redis as PRIMARY state store
- PostgreSQL as AUDIT ONLY (async)
- Redis Pub/Sub for cross-instance communication
- Truly stateless instances

### 3. Hot Path Optimization
Critical operations (<50ms target) use Redis only, never PostgreSQL.

### 4. API Contract - Single Source of Truth
- **Zod schemas** (`src/api/schemas/session.ts`) are the source of truth
- Auto-generates: Runtime validation + TypeScript types + OpenAPI docs
- Interactive Swagger UI available at `/api-docs` endpoint
- No manual API documentation - everything is generated from schemas
- See [architecture/ARCHITECTURE.md](architecture/ARCHITECTURE.md) for details

---

## Documentation Version

**Version:** 2.0
**Last Updated:** 2025-10-24
**Status:** Phase 4 - Deployment & Production

---

## Project Status

| Phase | Status | Target |
|-------|--------|--------|
| Design | ✅ Complete | - |
| Phase 1: Core Architecture | ✅ Complete | Week 1 |
| Phase 2: Business Logic & API | ✅ Complete | Week 2 |
| Phase 3: Testing & Quality | ✅ Complete | Week 3 |
| Phase 4: Deployment | 🟡 In Progress | Week 4 |

**Current Phase:** Phase 4 - Deployment & Infrastructure Setup
