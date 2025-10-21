# SyncKairos Architecture Reference

**Version:** 2.0
**Last Updated:** 2025-10-21

## Project Overview

**SyncKairos** is a standalone, high-performance real-time synchronization service for precise, synchronized timers across multiple clients with sub-100ms latency.

### Core Principles

1. **"Calculate, Don't Count"** - Use authoritative server timestamps for calculations, never local countdown timers
2. **Distributed-First Design** - Redis as PRIMARY state store, PostgreSQL as AUDIT only
3. **Hot Path Optimization** - Critical operations (<50ms target) must not touch slow data stores
4. **State Ownership Clarity** - Every piece of data has ONE clear owner and purpose
5. **Fail-Fast and Observable** - Errors should be loud, monitoring built-in
6. **Simple Over Clever** - Easy deployment and operation beats technical sophistication
7. **Performance Through Architecture** - Fast comes from design choices, not code optimization

## Tech Stack (v2.0)

### Backend
- **Runtime:** Node.js 20 LTS
- **Language:** TypeScript 5.x
- **Framework:** Express 4.x
- **WebSocket:** ws 8.x
- **Primary State:** Redis 7.x (via ioredis)
- **Audit Store:** PostgreSQL 15+ (via pg)
- **Queue:** BullMQ 4.x
- **Validation:** Zod 3.x
- **Auth:** jsonwebtoken
- **Logging:** Pino 8.x
- **Metrics:** prom-client (Prometheus)
- **Rate Limiting:** express-rate-limit + rate-limit-redis

### Testing
- **Unit:** Vitest
- **Integration:** Supertest
- **Load:** k6

### Development
- **Package Manager:** pnpm
- **Build:** tsup
- **Linting:** ESLint + Prettier

### Deployment
- **Primary:** Fly.io or Railway
- **Alternative:** AWS App Runner
- **Container:** Docker

## Architecture Components

### Core Components

1. **RedisStateManager** (`src/state/RedisStateManager.ts`)
   - Manages all session state in Redis (PRIMARY)
   - Handles Pub/Sub for cross-instance communication
   - Implements optimistic locking with version field
   - Queues async writes to PostgreSQL
   - **Latency:** 1-3ms for reads, 2-5ms for writes

2. **SyncEngine** (`src/engine/SyncEngine.ts`)
   - Core business logic for sync operations
   - Uses RedisStateManager for all state operations
   - Implements time calculations (not countdown)
   - Handles cycle switching, pause/resume, completion
   - **Hot Path:** switchCycle() targets <50ms (achieves 3-5ms)

3. **DBWriteQueue** (`src/state/DBWriteQueue.ts`)
   - BullMQ-based reliable async writes to PostgreSQL
   - Exponential backoff retry logic (5 attempts)
   - Monitoring and alerting for failures
   - Non-blocking audit logging

4. **WebSocketServer** (`src/websocket/WebSocketServer.ts`)
   - WebSocket server for real-time updates
   - Subscribes to Redis Pub/Sub for cross-instance broadcasts
   - Heartbeat mechanism for connection health
   - Automatic reconnection support

### Data Flow

1. Client sends request (REST) or maintains connection (WebSocket)
2. Load Balancer routes to ANY available instance (no sticky sessions)
3. Instance reads/writes to Redis (3-5ms)
4. Redis Pub/Sub broadcasts updates to all instances
5. Instances push updates to WebSocket clients
6. PostgreSQL gets async writes for audit trail (non-blocking)

## Performance Requirements

| Metric | Target | Expected |
|--------|--------|----------|
| Cycle switch latency | < 50ms | 3-5ms ✅ |
| WebSocket update delivery | < 100ms | 50-80ms ✅ |
| Server time sync accuracy | < 50ms | 10-30ms ✅ |
| Time calculation accuracy | ±10ms | ±5ms ✅ |
| Concurrent sessions | 10,000+ | 50,000+ ✅ |

## Project Structure (Backend Only)

```
synckairos/
├── src/
│   ├── api/
│   │   ├── routes/              # REST endpoints
│   │   ├── middlewares/         # Auth, validation, rate limiting
│   │   └── controllers/         # Request handlers
│   ├── engine/
│   │   └── SyncEngine.ts        # Core business logic
│   ├── state/
│   │   ├── RedisStateManager.ts # Redis state management
│   │   └── DBWriteQueue.ts      # Async PostgreSQL writes
│   ├── websocket/
│   │   └── WebSocketServer.ts   # WebSocket server
│   ├── services/
│   │   └── PushNotificationService.ts  # Firebase push (for mobile)
│   ├── monitoring/
│   │   ├── metrics.ts           # Prometheus metrics
│   │   ├── logger.ts            # Pino logger
│   │   └── health.ts            # Health checks
│   ├── types/                   # TypeScript types
│   ├── config/                  # Configuration
│   └── index.ts                 # App entry point
├── tests/
│   ├── unit/
│   ├── integration/
│   └── load/
├── migrations/                  # Database migrations
├── docker/                      # Docker configs
└── deployment/                  # PaaS configs
```

## Key Architectural Decisions

### 1. Redis as PRIMARY State Store
- Sub-5ms operations meet <50ms performance target
- Built-in TTL (1 hour) auto-expires inactive sessions
- Atomic operations prevent race conditions
- Built-in Pub/Sub for cross-instance communication

### 2. PostgreSQL as AUDIT Trail Only
- PostgreSQL latency (10-30ms) breaks <50ms target
- Audit logging doesn't need real-time performance
- Analytics queries don't impact production traffic

### 3. Redis Pub/Sub for Cross-Instance Broadcasting
- WebSocket clients connected to different instances need updates
- No sticky sessions required (true stateless)
- Sub-millisecond message delivery
- Built into Redis (no additional infrastructure)

### 4. Calculation-Based Time Tracking
```
time_remaining = total_time - (server_now - cycle_started_at)
```
- Local timers drift, calculations from server time don't
- Perfect synchronization across all clients
- Zero visible time corrections

### 5. Truly Stateless Instances
- Enables graceful shutdowns
- No data loss on instance crashes
- Simple auto-scaling (no session draining)
- No sticky sessions required

### 6. Optimistic Locking with Version Field
- Multiple instances updating same session concurrently
- Prevents lost updates
- Simple conflict detection

## Version Strategy

### v2.0 (Current - Fast Time-to-Market)
- Redis-first distributed architecture
- Simple, production-ready implementation
- Focus on core functionality and performance
- PaaS deployment (Fly.io/Railway)
- **Goal:** Ship quickly, validate market

### v3.0 (Future - Deferred)
- Interface-based abstractions (IStateManager, IMessageBroker, ISyncModePlugin)
- Plugin architecture for unlimited extensibility
- Layered architecture (API → Application → Domain → Infrastructure)
- Protocol versioning and backward compatibility
- **Status:** Documented but deferred in favor of v2.0

## Use Cases

- **Gaming:** Chess, poker, quiz games, turn-based strategy
- **Live Events:** Auctions, concerts, sports timers
- **Business:** Meetings, presentations, sprint timers
- **Education:** Exams, classroom activities
- **Lifestyle:** Meditation, cooking, fitness timers

## Sync Modes

1. **per_participant** - Each participant has own timer (chess players, exam students)
2. **per_cycle** - Fixed time per cycle/turn (auction bids, meeting agenda items)
3. **per_group** - Group-based timers (team competitions, breakout rooms)
4. **global** - Single timer for entire session (countdown, meditation)
5. **count_up** - Stopwatch mode (speedruns, elapsed time tracking)
