# SyncKairos v2.0

High-performance real-time synchronization service with distributed-first architecture.

## Features

- ✅ **Sub-millisecond Operations**: <1ms average latency
- ✅ **Truly Stateless**: Any instance can serve any request
- ✅ **Horizontal Scaling**: Add instances without configuration
- ✅ **Multi-Instance Ready**: Redis Pub/Sub for cross-instance sync
- ✅ **Audit Trail**: Async PostgreSQL writes via BullMQ

## Quick Start

```bash
# Install
pnpm install

# Setup
cp .env.example .env
docker run -d -p 6379:6379 redis:7-alpine
docker run -d -p 5432:5432 -e POSTGRES_DB=synckairos -e POSTGRES_PASSWORD=password postgres:15

# Run
pnpm run migrate
pnpm dev
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

```bash
pnpm test              # Run all tests
pnpm test:coverage     # With coverage report
pnpm test:multi-instance  # Multi-instance validation
pnpm lint              # Check code style
pnpm build             # Production build
```

## License

ISC
