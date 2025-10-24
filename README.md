# SyncKairos v2.0

High-performance real-time synchronization service with distributed-first architecture.

## Features

- ✅ **Sub-millisecond Operations**: <1ms average latency
- ✅ **Truly Stateless**: Any instance can serve any request
- ✅ **Horizontal Scaling**: Add instances without configuration
- ✅ **Multi-Instance Ready**: Redis Pub/Sub for cross-instance sync
- ✅ **Audit Trail**: Async PostgreSQL writes via BullMQ

## Quick Start

### One-Command Setup (Recommended)
```bash
# Install dependencies
pnpm install

# Start local environment (Docker Compose + migrations + app)
./scripts/start-local.sh
```

### Manual Setup
```bash
# Install
pnpm install

# Start infrastructure
docker compose up -d

# Run migrations
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/synckairos?sslmode=disable" node scripts/direct-migrate.js

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

### API Reference
- [RedisStateManager](docs/api/RedisStateManager.md)
- [DBWriteQueue](docs/api/DBWriteQueue.md)
- [Configuration](docs/api/CONFIGURATION.md)

### Guides
- [Deployment](docs/guides/DEPLOYMENT.md)
- [Testing](docs/guides/TESTING.md)
- [Development](docs/guides/DEVELOPMENT.md)
- [Troubleshooting](docs/guides/TROUBLESHOOTING.md)

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
├── config/       # Redis, PostgreSQL configuration
├── state/        # RedisStateManager, DBWriteQueue
├── types/        # TypeScript types
├── errors/       # Custom errors
└── utils/        # Logger, helpers
```

## Development

### Local Development
```bash
./scripts/start-local.sh   # Start local environment (one command)
```

### Testing & Building
```bash
pnpm test                  # Run all tests
pnpm test:coverage         # With coverage report
pnpm test:multi-instance   # Multi-instance validation
pnpm lint                  # Check code style
pnpm build                 # Production build
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
