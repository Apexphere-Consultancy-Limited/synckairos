# SyncKairos v2.0

[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=synckairos&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=synckairos)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=synckairos&metric=coverage)](https://sonarcloud.io/summary/new_code?id=synckairos)

High-performance real-time synchronization service with distributed-first architecture.

## Features

- ✅ **Sub-millisecond Operations**: <1ms average latency
- ✅ **Truly Stateless**: Any instance can serve any request
- ✅ **Horizontal Scaling**: Add instances without configuration
- ✅ **Multi-Instance Ready**: Redis Pub/Sub for cross-instance sync
- ✅ **Audit Trail**: Async PostgreSQL writes via BullMQ

## Quick Start

### Prerequisites
- Node.js 20+
- pnpm (`npm install -g pnpm`)
- Docker Desktop running

### One-Command Setup (Recommended)
```bash
# Install dependencies
pnpm install

# Start local environment (Docker + Redis + PostgreSQL + API)
./scripts/start-local.sh
```

**What it does:**
- ✅ Starts Redis (port 6379)
- ✅ Starts PostgreSQL (port 5433)
- ✅ Runs database migrations
- ✅ Starts SyncKairos API server (port 3000)

**Access Points:**
- API: `http://localhost:3000`
- API Docs: `http://localhost:3000/api-docs/` (Interactive Swagger UI)
- Health: `http://localhost:3000/health`
- WebSocket: `ws://localhost:3000/ws`

### Alternative: Development Mode (with auto-reload)
```bash
# Start infrastructure only
docker compose up -d

# Run migrations (first time only)
pnpm migrate

# Start server with hot-reload
pnpm dev
```

### Manual Setup
```bash
# Install
pnpm install

# Start infrastructure
docker compose up -d

# Run migrations
pnpm migrate

# Build and run
pnpm build
pnpm start
```

## Phase 1 Status: 🟢 Complete

**Delivered**:
- RedisStateManager (primary state store)
- DBWriteQueue (async audit writes)
- PostgreSQL schema
- Multi-instance validation (4/4 tests passed)
- Performance: 10-16x better than targets
- Test coverage: >90%
- Complete documentation suite

See [Phase 1 Validation](docs/project-tracking/PHASE_1_VALIDATION.md)

## Documentation

### Architecture
- [Overview](docs/architecture/README.md)
- [System Design](docs/architecture/SYSTEM_DESIGN.md)
- [Data Flow](docs/architecture/DATA_FLOW.md)
- [Design Decisions](docs/architecture/DESIGN_DECISIONS.md)

### API Documentation
- **Interactive API Docs**: Visit `/api-docs` when server is running
  - Try out endpoints directly in the browser
  - View request/response schemas with examples
  - Auto-generated from Zod schemas (single source of truth)
- **OpenAPI Spec**: Available at `/api-docs.json`
- **Schema Source**: `src/api/schemas/session.ts`

### Component Reference
- [RedisStateManager](docs/components/RedisStateManager.md)
- [DBWriteQueue](docs/components/DBWriteQueue.md)
- [Configuration](docs/components/CONFIGURATION.md)

### Guides
- [Deployment](docs/guides/DEPLOYMENT.md)
- [Testing](docs/guides/TESTING.md)
- [Development](docs/guides/DEVELOPMENT.md)
- [Troubleshooting](docs/guides/TROUBLESHOOTING.md)
- [SonarQube Setup](docs/guides/SONARQUBE_SETUP.md)

## Performance

| Operation | Target | Achieved |
|-----------|--------|----------|
| getSession() | <3ms | 0.25ms |
| updateSession() | <5ms | 0.46ms |
| Pub/Sub | <2ms | 0.19ms |

## Tech Stack

- **Runtime**: Node.js 20 + TypeScript
- **Primary Store**: Redis 7
- **Audit Store**: PostgreSQL 15
- **Queue**: BullMQ
- **Testing**: Vitest
- **Package Manager**: pnpm

## Project Structure

```
src/
├── api/          # REST API & documentation
│   ├── routes/   # Express routes
│   ├── schemas/  # Zod validation schemas (source of truth)
│   ├── middlewares/  # Express middlewares
│   ├── openapi.ts    # OpenAPI spec generator
│   └── app.ts    # Express app factory
├── engine/       # SyncEngine business logic
├── websocket/    # WebSocket server
├── config/       # Redis, PostgreSQL configuration
├── state/        # RedisStateManager, DBWriteQueue
├── types/        # TypeScript types
├── errors/       # Custom errors
└── utils/        # Logger, helpers
```

## Development

### Local Development
```bash
# One-command start (includes Docker services)
./scripts/start-local.sh

# OR development mode with hot-reload
pnpm dev
```

### Testing & Building
```bash
pnpm test                  # Run all tests
pnpm test:coverage         # With coverage report
pnpm test:multi-instance   # Multi-instance validation
pnpm lint                  # Check code style
pnpm build                 # Production build
pnpm sonar                 # Run SonarQube analysis (cloud)
pnpm sonar:local           # Run SonarQube analysis (local)
```

### Infrastructure Management
```bash
# Test connections
node .claude/skills/devops/scripts/test-redis.js
node .claude/skills/devops/scripts/test-postgres.js

# Check health
bash .claude/skills/devops/scripts/check-health.sh

# Validate environment
bash .claude/skills/devops/scripts/validate-env.sh .env
```

### Deployment
```bash
# Deploy to staging
./scripts/deploy.sh synckairos-staging staging

# Deploy to production
./scripts/deploy.sh synckairos-production production
```

## License

ISC
