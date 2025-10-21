# Task 1.1: Project Setup

**Component:** Core Infrastructure
**Phase:** 1 - Core Architecture
**Estimated Time:** 0.5 days (4 hours)
**Priority:** High

> **Note:** Track progress in [TASK_TRACKING.md](../TASK_TRACKING.md)

---

## Objective

Initialize the SyncKairos Node.js project with TypeScript, development tooling, and core dependencies. Establish project structure and development environment.

---

## Tasks Breakdown

### 1. Node.js Project Initialization (30 min)

- [ ] Initialize Node.js 20 LTS project
  ```bash
  pnpm init
  ```
- [ ] Update `package.json` settings:
  - [ ] Add `"type": "module"`
  - [ ] Set `"engines": { "node": ">=20.0.0" }`
  - [ ] Add name: `"synckairos"`
  - [ ] Add version: `"2.0.0"`
  - [ ] Add description: `"Real-time synchronization service with Redis-first distributed architecture"`

**Verification:**
```bash
node --version  # Should be >=20.0.0
pnpm --version  # Should work
```

---

### 2. TypeScript Configuration (30 min)

- [ ] Install TypeScript dependencies
  ```bash
  pnpm add -D typescript @types/node
  ```

- [ ] Create `tsconfig.json`
  ```json
  {
    "compilerOptions": {
      "target": "ES2022",
      "module": "ESNext",
      "lib": ["ES2022"],
      "moduleResolution": "node",
      "outDir": "./dist",
      "rootDir": "./src",
      "strict": true,
      "esModuleInterop": true,
      "skipLibCheck": true,
      "forceConsistentCasingInFileNames": true,
      "resolveJsonModule": true,
      "noUnusedLocals": true,
      "noUnusedParameters": true,
      "noImplicitReturns": true,
      "noFallthroughCasesInSwitch": true,
      "allowSyntheticDefaultImports": true,
      "baseUrl": ".",
      "paths": {
        "@/*": ["src/*"]
      }
    },
    "include": ["src/**/*"],
    "exclude": ["node_modules", "dist", "tests"]
  }
  ```

**Verification:**
```bash
pnpm tsc --noEmit  # Should compile without errors (once src/ exists)
```

---

### 3. ESLint + Prettier Setup (30 min)

- [ ] Install linting dependencies
  ```bash
  pnpm add -D eslint prettier @typescript-eslint/parser @typescript-eslint/eslint-plugin eslint-config-prettier eslint-plugin-prettier
  ```

- [ ] Create `.eslintrc.json`
  ```json
  {
    "parser": "@typescript-eslint/parser",
    "parserOptions": {
      "ecmaVersion": 2022,
      "sourceType": "module",
      "project": "./tsconfig.json"
    },
    "plugins": ["@typescript-eslint", "prettier"],
    "extends": [
      "eslint:recommended",
      "plugin:@typescript-eslint/recommended",
      "plugin:prettier/recommended"
    ],
    "rules": {
      "prettier/prettier": "error",
      "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/no-explicit-any": "error"
    },
    "env": {
      "node": true,
      "es2022": true
    }
  }
  ```

- [ ] Create `.prettierrc`
  ```json
  {
    "semi": false,
    "singleQuote": true,
    "trailingComma": "es5",
    "printWidth": 100,
    "tabWidth": 2,
    "arrowParens": "avoid"
  }
  ```

- [ ] Add scripts to `package.json`
  ```json
  "scripts": {
    "lint": "eslint src/**/*.ts",
    "lint:fix": "eslint src/**/*.ts --fix",
    "format": "prettier --write \"src/**/*.ts\"",
    "format:check": "prettier --check \"src/**/*.ts\""
  }
  ```

**Verification:**
```bash
pnpm run lint      # Should pass (once src/ has files)
pnpm run format    # Should format files
```

---

### 4. Project Structure Creation (30 min)

- [ ] Create directory structure
  ```bash
  mkdir -p src/{api/{routes,middlewares,controllers},engine,state,websocket,services,monitoring,types,config}
  mkdir -p tests/{unit,integration,load/scenarios}
  mkdir -p migrations
  ```

- [ ] Create placeholder files to establish structure:
  - [ ] `src/index.ts` (empty for now)
  - [ ] `src/types/session.ts` (will define interfaces in Task 1.2)
  - [ ] `src/config/redis.ts` (placeholder)
  - [ ] `src/config/database.ts` (placeholder)

**Directory Structure:**
```
synckairos/
├── src/
│   ├── api/
│   │   ├── routes/
│   │   ├── middlewares/
│   │   └── controllers/
│   ├── engine/
│   ├── state/
│   ├── websocket/
│   ├── services/
│   ├── monitoring/
│   ├── types/
│   ├── config/
│   └── index.ts
├── tests/
│   ├── unit/
│   ├── integration/
│   └── load/
│       └── scenarios/
├── migrations/
├── docs/
├── .claude/
└── package.json
```

**Verification:**
```bash
tree -L 3 src/    # Should show structure
tree -L 2 tests/  # Should show test folders
```

---

### 5. Environment Configuration (30 min)

- [ ] Create `.env.example`
  ```env
  # Server
  NODE_ENV=development
  PORT=3000

  # Redis (PRIMARY State Store)
  REDIS_URL=redis://localhost:6379
  REDIS_PASSWORD=
  REDIS_TLS=false

  # PostgreSQL (AUDIT Only)
  DATABASE_URL=postgresql://user:password@localhost:5432/synckairos
  DATABASE_POOL_MIN=2
  DATABASE_POOL_MAX=20
  DATABASE_SSL=false

  # BullMQ (Async DB Writes)
  BULLMQ_REDIS_URL=redis://localhost:6379

  # JWT Authentication (Phase 2)
  JWT_SECRET=your-secret-key-here
  JWT_EXPIRES_IN=24h

  # Monitoring (Phase 3)
  LOG_LEVEL=info
  PROMETHEUS_PORT=9090
  SENTRY_DSN=

  # Rate Limiting (Phase 2)
  RATE_LIMIT_WINDOW_MS=60000
  RATE_LIMIT_MAX_REQUESTS=100
  ```

- [ ] Install dotenv
  ```bash
  pnpm add dotenv
  ```

- [ ] Create `.gitignore`
  ```gitignore
  # Dependencies
  node_modules/

  # Build output
  dist/
  build/

  # Environment
  .env
  .env.local
  .env.*.local

  # Logs
  logs/
  *.log
  npm-debug.log*
  pnpm-debug.log*

  # Testing
  coverage/
  .nyc_output/

  # IDE
  .vscode/
  .idea/
  *.swp
  *.swo
  *~
  .DS_Store

  # Temporary
  tmp/
  temp/
  *.tmp

  # Skills (generated)
  .claude/skills/*.zip
  ```

**Verification:**
```bash
cat .env.example  # Should show all variables
git status        # .env should not be tracked
```

---

### 6. Install Core Dependencies (45 min)

- [ ] Install production dependencies
  ```bash
  pnpm add express ws ioredis pg bullmq zod jsonwebtoken pino pino-http prom-client express-rate-limit rate-limit-redis cors dotenv
  ```

  **Dependency purposes:**
  - `express` - REST API framework
  - `ws` - WebSocket server
  - `ioredis` - Redis client (PRIMARY state store)
  - `pg` - PostgreSQL client (AUDIT only)
  - `bullmq` - Async job queue for DB writes
  - `zod` - Runtime validation
  - `jsonwebtoken` - JWT auth (Phase 2)
  - `pino` - Structured logging (Phase 3)
  - `pino-http` - HTTP request logging (Phase 3)
  - `prom-client` - Prometheus metrics (Phase 3)
  - `express-rate-limit` - Rate limiting (Phase 2)
  - `rate-limit-redis` - Redis-backed rate limiter (Phase 2)
  - `cors` - CORS middleware
  - `dotenv` - Environment variables

- [ ] Install development dependencies
  ```bash
  pnpm add -D vitest @vitest/coverage-v8 supertest tsx tsup @types/express @types/ws @types/pg @types/jsonwebtoken @types/cors pino-pretty nodemon
  ```

  **Dev dependency purposes:**
  - `vitest` - Unit test framework
  - `@vitest/coverage-v8` - Code coverage
  - `supertest` - Integration testing for APIs
  - `tsx` - TypeScript execution
  - `tsup` - Fast TypeScript bundler
  - `@types/*` - TypeScript type definitions
  - `pino-pretty` - Pretty log formatting
  - `nodemon` - Auto-restart on file changes

- [ ] Add build and dev scripts to `package.json`
  ```json
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsup src/index.ts --format esm --clean",
    "start": "node dist/index.js",
    "test": "vitest",
    "test:coverage": "vitest --coverage",
    "test:unit": "vitest tests/unit",
    "test:integration": "vitest tests/integration",
    "lint": "eslint src/**/*.ts",
    "lint:fix": "eslint src/**/*.ts --fix",
    "format": "prettier --write \"src/**/*.ts\"",
    "format:check": "prettier --check \"src/**/*.ts\""
  }
  ```

**Verification:**
```bash
pnpm install              # Should complete successfully
ls -la node_modules/      # Should contain all dependencies
pnpm run build            # Should create dist/ (once src/index.ts has content)
```

---

## Acceptance Criteria

### Must Complete

- [ ] `pnpm install` runs successfully without errors
- [ ] `pnpm run lint` passes (or shows no files if src/ is empty)
- [ ] `pnpm run format` works
- [ ] TypeScript compiles: `pnpm tsc --noEmit` (once src/ has content)
- [ ] Project structure created with all folders
- [ ] `.env.example` contains all required config variables
- [ ] `.gitignore` excludes `.env`, `node_modules/`, `dist/`
- [ ] All core dependencies installed (22 production + 12 dev dependencies)

### Quality Checks

- [ ] No `any` types allowed (ESLint rule enforced)
- [ ] Strict TypeScript mode enabled
- [ ] Prettier configured with consistent formatting
- [ ] Git repository clean (no tracked secrets)

---

## Files Created

- [ ] `package.json` (with scripts and dependencies)
- [ ] `tsconfig.json` (TypeScript configuration)
- [ ] `.eslintrc.json` (ESLint rules)
- [ ] `.prettierrc` (Prettier formatting)
- [ ] `.env.example` (Environment template)
- [ ] `.gitignore` (Git exclusions)
- [ ] `src/index.ts` (entry point placeholder)
- [ ] `src/types/session.ts` (types placeholder)
- [ ] `src/config/redis.ts` (config placeholder)
- [ ] `src/config/database.ts` (config placeholder)
- [ ] Directory structure: `src/`, `tests/`, `migrations/`

---

## Dependencies

**Blocks:**
- Task 1.2 (RedisStateManager) - Needs project setup complete
- Task 1.3 (PostgreSQL Schema) - Needs project setup complete
- Task 1.4 (DBWriteQueue) - Needs project setup complete

**Blocked By:**
- None (first task in Phase 1)

---

## Notes

### Technical Decisions
- Using `pnpm` for faster installs and disk efficiency
- Using `tsx` for development (faster than ts-node)
- Using `tsup` for production builds (faster than tsc)
- Separate Redis connections for state and Pub/Sub (required by Redis)

### Deferred
- Docker setup (Phase 4)
- CI/CD configuration (Phase 4)
- Prometheus dashboards (Phase 3)

---

## Next Steps After Completion

1. Begin Task 1.2 (RedisStateManager) - CRITICAL PATH component
