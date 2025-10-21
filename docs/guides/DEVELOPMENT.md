# Development Setup

## Quick Start

```bash
git clone <repo>
cd synckairos
pnpm install
cp .env.example .env
docker run -d -p 6379:6379 redis:7-alpine
docker run -d -p 5432:5432 -e POSTGRES_DB=synckairos -e POSTGRES_PASSWORD=password postgres:15-alpine
pnpm run migrate
pnpm dev
```

## Project Structure

```
src/
├── config/
│   ├── redis.ts          # Redis client factory
│   └── database.ts       # PostgreSQL pool
├── state/
│   ├── RedisStateManager.ts  # PRIMARY - Phase 1 ✅
│   └── DBWriteQueue.ts       # AUDIT - Phase 1 ✅
├── types/
│   └── session.ts        # SyncState, SyncMode, etc.
├── errors/
│   └── StateErrors.ts    # Custom errors
└── utils/
    └── logger.ts         # Pino logger
```

## Development Workflow

```bash
# 1. Create feature branch
git checkout -b feat/my-feature

# 2. Make changes

# 3. Run tests
pnpm test

# 4. Check types
pnpm tsc --noEmit

# 5. Lint
pnpm lint

# 6. Commit
git add .
git commit -m "feat: my feature"
```

## Code Style

- TypeScript strict mode
- ESLint + Prettier
- No `any` types
- Functional style preferred
- Tests required for all features

## Testing Requirements

- Unit tests for all new code
- Integration tests for cross-component features
- Performance tests for hot path changes
- Coverage targets:
  - New files: >85%
  - Modified files: maintain existing coverage

## Commands

```bash
pnpm dev          # Development server with watch
pnpm build        # Production build
pnpm start        # Run production build
pnpm test         # Run all tests
pnpm test:watch   # Watch mode
pnpm lint         # Check linting
pnpm lint:fix     # Auto-fix linting
pnpm tsc          # Type check
```

## Database Migrations

```bash
# Create migration
# (Manual for now - Phase 1 has initial schema)

# Run migrations
pnpm run migrate

# Rollback (manual for now)
# Drop tables and re-run migrate
```

## Debugging

### VS Code Launch Config

```json
{
  "type": "node",
  "request": "launch",
  "name": "Debug Server",
  "runtimeExecutable": "pnpm",
  "runtimeArgs": ["dev"],
  "console": "integratedTerminal"
}
```

### Debug Tests

```bash
pnpm test --inspect-brk
```

## Phase 1 Complete Checklist

✅ RedisStateManager implemented
✅ DBWriteQueue implemented
✅ PostgreSQL schema created
✅ Unit tests (>90% coverage)
✅ Integration tests
✅ Performance tests
✅ Multi-instance validation

## Next: Phase 2

- SyncEngine business logic
- Timer calculations
- Cycle management
- State transitions
