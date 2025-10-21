# SyncKairos - Tech Stack Recommendations

**Version:** 2.0
**Last Updated:** 2025-10-21
**Status:** Analysis & Recommendations

---

## Executive Summary

This document provides detailed analysis and recommendations for the **SyncKairos backend service** technology stack, considering:
- Sub-100ms latency requirements
- WebSocket real-time synchronization
- Redis-first distributed architecture
- Horizontal scalability
- Mobile client compatibility (future native iOS + Android apps will consume this API)

**Final Recommendation:** Node.js 20 LTS + TypeScript backend service.

**Scope:** This project is a **backend-only service**. Mobile apps will be built separately and consume this API.

---

## Requirements Analysis

### Performance Requirements
- **Cycle switch latency:** <50ms (target: 3-5ms)
- **WebSocket message delivery:** <100ms
- **Time sync accuracy:** <50ms
- **Concurrent sessions:** 50,000+
- **Hot path operations:** Redis-only (no database queries)

### Client Platform Requirements (Future)
- **Web clients:** Desktop and mobile browsers (separate project)
- **Mobile clients:** Native iOS and Android apps (separate project)
- **This project:** Backend API service only - truly stateless, horizontally scalable

### Operational Requirements
- **Deployment:** PaaS-first (Fly.io, Railway)
- **Monitoring:** Prometheus metrics, structured logging
- **Reliability:** 99.9% uptime target
- **Developer Experience:** Type safety, fast iteration

---

## Backend Technology Stack

### Language & Runtime: Node.js 20 LTS + TypeScript 5.x ✅

#### Why Node.js?

**Strengths for SyncKairos:**

1. **WebSocket Performance**
   - Event-driven, non-blocking I/O model
   - Handles thousands of concurrent persistent connections efficiently
   - Native support for real-time protocols

2. **Redis Integration**
   - Best-in-class Redis client (`ioredis`)
   - Full support for Redis Pub/Sub, Sentinel, Cluster
   - Async/await makes Redis operations clean and readable

3. **I/O-Bound Workload Optimization**
   - SyncKairos is I/O-bound (Redis reads/writes), not CPU-bound
   - Single-threaded event loop is perfect for this workload
   - Lower latency than traditional multi-threaded servers for I/O

4. **JSON Native**
   - No serialization overhead for JSON payloads
   - Perfect for REST API + WebSocket JSON messages

5. **Real-time Ecosystem**
   - Mature WebSocket libraries (ws, Socket.io)
   - Extensive tooling for real-time applications
   - Large community solving similar problems

6. **PaaS Support**
   - First-class support on all PaaS platforms
   - Fly.io, Railway, AWS App Runner all optimized for Node.js
   - One-command deployment

7. **Developer Experience**
   - TypeScript provides type safety
   - Huge ecosystem of packages
   - Fast development iteration
   - Easy to find developers

**Performance Characteristics:**

```typescript
// Typical hot path operation
async function switchCycle(sessionId: string): Promise<void> {
  // 1. Read from Redis: 1-2ms
  const state = await redis.get(`session:${sessionId}`)

  // 2. Business logic: <1ms
  const newState = calculateNewState(state)

  // 3. Write to Redis: 2-3ms
  await redis.setex(`session:${sessionId}`, 3600, JSON.stringify(newState))

  // 4. Broadcast via Pub/Sub: 1-2ms
  await redis.publish('session-updates', JSON.stringify({ sessionId, newState }))

  // Total: 3-5ms ✅
}
```

#### Alternatives Considered

**Go (Golang)**

Pros:
- Lower memory footprint (~10-20MB vs Node.js 50-100MB)
- Better CPU performance for compute-intensive tasks
- Built-in concurrency with goroutines
- Static compilation (single binary deployment)

Cons:
- More verbose WebSocket code
- Smaller Redis ecosystem
- No native JSON handling (requires struct marshaling)
- TypeScript type safety is better for rapid development
- Overkill for I/O-bound workload

**Verdict:** Go is excellent but unnecessary for SyncKairos. Node.js handles I/O-bound operations as well or better, with significantly better developer experience.

**Python (FastAPI)**

Pros:
- Clean async/await syntax
- Good Redis libraries (redis-py)
- Fast development

Cons:
- Slower than Node.js for real-time applications
- WebSocket support less mature
- GIL (Global Interpreter Lock) limits concurrency
- Larger memory footprint than Node.js
- Weaker ecosystem for real-time

**Verdict:** Not recommended for real-time synchronization.

**Rust (Actix/Axum)**

Pros:
- Blazing fast performance
- Memory safety without garbage collection
- Great for systems programming

Cons:
- Steep learning curve
- Slower development iteration
- Smaller ecosystem
- Overkill for business logic application

**Verdict:** Premature optimization. Node.js meets all performance requirements.

**Bun (Emerging)**

Pros:
- 3x faster startup than Node.js
- Built-in TypeScript (no transpilation)
- Built-in WebSocket support
- Lower memory usage
- Drop-in Node.js replacement

Cons:
- Newer ecosystem (v1.0 released Sept 2023)
- Fewer production deployments
- Some Node.js compatibility gaps
- Less mature PaaS support

**Verdict:** Promising but not production-ready. Revisit in 6-12 months. Stick with Node.js 20 LTS for stability.

---

### Backend Framework: Express 4.x

**Why Express:**

1. **Minimal & Flexible** - No unnecessary abstractions
2. **Mature** - 13+ years in production
3. **Ecosystem** - Thousands of middleware packages
4. **Performance** - Lightweight, low overhead
5. **WebSocket Friendly** - Easy to integrate ws or Socket.io

**Alternatives Considered:**

| Framework | Pros | Cons | Verdict |
|-----------|------|------|---------|
| **Fastify** | 2x faster than Express, built-in validation | Smaller ecosystem | Good alternative |
| **NestJS** | TypeScript-first, dependency injection | Opinionated, heavyweight | Overkill |
| **Koa** | Minimal, modern | Smaller ecosystem than Express | Express is safer |
| **Hono** | Ultra-fast, edge-ready | Very new, small ecosystem | Too new |

**Recommendation:** Start with **Express**. Migrate to Fastify later if needed.

---

### WebSocket Library: ws 8.x

**Why ws:**

1. **Lightweight** - Minimal overhead, just WebSocket
2. **Fast** - Optimized for performance
3. **Standards-Compliant** - Follows WebSocket RFC
4. **No Magic** - Simple, predictable behavior
5. **Mobile-Friendly** - Works identically in React Native

**Alternative: Socket.io**

Pros:
- Built-in reconnection logic
- Room management
- Fallback transports (polling)
- Namespaces

Cons:
- Heavier (~10x larger than ws)
- More complex
- Fallbacks unnecessary (modern browsers/mobile all support WebSocket)
- Custom protocol (not standard WebSocket)

**Recommendation:** Start with **ws**. The reconnection and room logic you're implementing manually is educational and gives you more control. Socket.io adds complexity you don't need.

---

### State & Data Layer

#### Primary State Store: Redis 7.x via ioredis 5.x

**Why ioredis:**

1. **Feature-Complete**
   - Full Pub/Sub support
   - Redis Sentinel support
   - Redis Cluster support
   - Pipeline and transactions
   - Lua scripting

2. **Performance**
   - Connection pooling
   - Automatic reconnection
   - Optimized command buffering

3. **TypeScript Support**
   - Full type definitions
   - Type-safe method signatures

4. **Production-Ready**
   - Used by major companies (Alibaba, etc.)
   - Excellent error handling
   - Comprehensive documentation

**Example:**
```typescript
import { Redis } from 'ioredis'

// Basic connection
const redis = new Redis(process.env.REDIS_URL)

// Redis Sentinel
const redis = new Redis({
  sentinels: [
    { host: 'sentinel1', port: 26379 },
    { host: 'sentinel2', port: 26379 },
    { host: 'sentinel3', port: 26379 }
  ],
  name: 'synckairos-primary'
})

// Redis Cluster
const redis = new Redis.Cluster([
  { host: 'node1', port: 6379 },
  { host: 'node2', port: 6379 }
])
```

**Alternatives:**
- **node-redis:** Good but ioredis has better cluster support
- **Upstash SDK:** Only for Upstash-hosted Redis

**Recommendation:** **ioredis** for maximum flexibility.

---

#### Audit Store: PostgreSQL 15+ via pg (node-postgres)

**Why Raw SQL with pg:**

1. **Simple Queries** - Your audit writes are straightforward inserts
2. **No ORM Overhead** - ORMs add latency you don't need
3. **Type Safety** - Use TypeScript interfaces for results
4. **Connection Pooling** - Built-in pool management
5. **Async Only** - Perfect for fire-and-forget audit writes

**Example:**
```typescript
import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20 // Connection pool size
})

// Async audit write
async function logEvent(sessionId: string, eventType: string, state: any) {
  await pool.query(
    `INSERT INTO sync_events (session_id, event_type, state_snapshot, timestamp)
     VALUES ($1, $2, $3, NOW())`,
    [sessionId, eventType, state]
  )
}
```

**Alternative: Kysely (Type-safe Query Builder)**

If you want type safety without ORM overhead:

```typescript
import { Kysely, PostgresDialect } from 'kysely'
import { Pool } from 'pg'

const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool })
})

// Type-safe query
await db
  .insertInto('sync_events')
  .values({
    session_id: sessionId,
    event_type: eventType,
    state_snapshot: state,
    timestamp: new Date()
  })
  .execute()
```

**Recommendation:** Start with **raw pg**. Add **Kysely** if type safety becomes important.

**Why NOT an ORM (Prisma, TypeORM, Sequelize)?**

- PostgreSQL is audit-only (async writes)
- No complex queries needed
- No relationships to model
- ORMs add overhead and complexity
- Direct SQL is faster and simpler

---

### Background Jobs: BullMQ 4.x

**Why BullMQ:**

1. **Redis-Backed** - Already have Redis, no additional infrastructure
2. **Reliable** - Automatic retries with exponential backoff
3. **Persistent** - Jobs survive restarts
4. **Observability** - Built-in metrics and monitoring
5. **TypeScript Support** - Full type definitions

**Use Case:**
Reliable async writes to PostgreSQL with retry logic.

**Example:**
```typescript
import { Queue, Worker } from 'bullmq'

const dbWriteQueue = new Queue('db-writes', {
  connection: redis,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 2000 }
  }
})

// Queue a write
await dbWriteQueue.add('audit', {
  sessionId,
  state,
  eventType: 'cycle_switched'
})

// Process writes
const worker = new Worker('db-writes', async (job) => {
  await logEventToPostgreSQL(job.data)
})
```

**Alternatives:**
- **Bull** - Older version, less features
- **Agenda** - MongoDB-based (you're using PostgreSQL)
- **Bee-Queue** - Simpler but less reliable

**Recommendation:** **BullMQ** for production reliability.

---

### Validation: Zod 3.x

**Why Zod:**

1. **TypeScript-First** - Types inferred from schemas
2. **Runtime Validation** - Catches invalid data
3. **Works Everywhere** - Node.js, browser, React Native
4. **Composable** - Build complex schemas from simple ones
5. **Great Error Messages** - Detailed validation errors

**Example:**
```typescript
import { z } from 'zod'

// Define schema
const SessionSchema = z.object({
  session_id: z.string().uuid(),
  sync_mode: z.enum(['per_participant', 'per_cycle', 'global', 'count_up']),
  participants: z.array(z.object({
    participant_id: z.string().uuid(),
    total_time_ms: z.number().min(1000).max(86400000)
  })).min(1).max(1000),
  increment_ms: z.number().min(0).optional()
})

// Infer TypeScript type
type Session = z.infer<typeof SessionSchema>

// Validate at runtime
app.post('/sessions', (req, res) => {
  const result = SessionSchema.safeParse(req.body)

  if (!result.success) {
    return res.status(400).json({ errors: result.error.errors })
  }

  const session: Session = result.data // Type-safe
  // ...
})
```

**Alternatives:**
- **Joi** - Popular but not TypeScript-first
- **Yup** - Good for forms, less TypeScript support
- **io-ts** - More complex, steeper learning curve

**Recommendation:** **Zod** for TypeScript-first validation.

---

### Authentication: jsonwebtoken

**Why JWT:**

1. **Stateless** - No session storage needed
2. **Standard** - RFC 7519
3. **Cross-Platform** - Works in web and mobile
4. **Secure** - Sign with HS256 or RS256

**Example:**
```typescript
import jwt from 'jsonwebtoken'

// Generate token
const token = jwt.sign(
  { userId, role: 'user' },
  process.env.JWT_SECRET,
  { expiresIn: '7d' }
)

// Verify middleware
function authenticate(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '')

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET)
    req.user = payload
    next()
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' })
  }
}
```

**Alternative: Passport.js**
- Overkill if you only need JWT
- Useful if you need OAuth, SAML, etc.

**Recommendation:** **jsonwebtoken** for simplicity.

---

### Monitoring & Observability

#### Logging: Pino

**Why Pino:**

1. **Fastest JSON Logger** - Benchmarked fastest Node.js logger
2. **Structured Logging** - JSON by default
3. **Low Overhead** - Minimal performance impact
4. **Child Loggers** - Add context (request ID, session ID)

**Example:**
```typescript
import pino from 'pino'

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
})

// Use in code
logger.info({ sessionId, userId }, 'Session created')
logger.error({ err, sessionId }, 'Failed to switch cycle')

// Child logger with context
const requestLogger = logger.child({ requestId: req.id })
requestLogger.info('Processing request')
```

**Alternatives:**
- **Winston** - More features but slower
- **Bunyan** - Good but abandoned

**Recommendation:** **Pino** for performance.

---

#### Metrics: prom-client (Prometheus)

**Why Prometheus:**

1. **Industry Standard** - De facto standard for metrics
2. **Time-Series Data** - Perfect for performance monitoring
3. **Grafana Integration** - Beautiful dashboards
4. **Pull-Based** - No need to push metrics

**Example:**
```typescript
import { Counter, Histogram, register } from 'prom-client'

// Define metrics
const cycleSwitchCounter = new Counter({
  name: 'synckairos_cycle_switches_total',
  help: 'Total cycle switches',
  labelNames: ['session_id', 'status']
})

const cycleSwitchLatency = new Histogram({
  name: 'synckairos_cycle_switch_duration_ms',
  help: 'Cycle switch latency',
  buckets: [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000]
})

// Record metrics
const startTime = Date.now()
await syncEngine.switchCycle(sessionId)
const duration = Date.now() - startTime

cycleSwitchCounter.inc({ session_id: sessionId, status: 'success' })
cycleSwitchLatency.observe(duration)

// Expose endpoint
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType)
  res.end(await register.metrics())
})
```

---

### Rate Limiting: express-rate-limit + rate-limit-redis

**Why Rate Limiting:**

Critical for preventing DoS attacks on hot path endpoints.

**Example:**
```typescript
import rateLimit from 'express-rate-limit'
import RedisStore from 'rate-limit-redis'

// Critical endpoint limiter
const cycleSwitchLimiter = rateLimit({
  store: new RedisStore({
    client: redis,
    prefix: 'rl:switch:'
  }),
  windowMs: 1000, // 1 second
  max: 10, // 10 requests per second per session
  keyGenerator: (req) => req.params.session_id,
  message: { error: 'Too many cycle switches' }
})

app.post('/sessions/:id/switch', cycleSwitchLimiter, handleSwitch)
```

---

## Testing Stack

### Unit Tests: Vitest

**Why Vitest:**

1. **Fast** - Faster than Jest (uses Vite)
2. **Modern** - ESM support, TypeScript native
3. **Jest-Compatible** - Drop-in replacement
4. **Great DX** - Watch mode, UI mode

**Example:**
```typescript
import { describe, it, expect } from 'vitest'
import { SyncEngine } from './SyncEngine'

describe('SyncEngine', () => {
  it('should switch cycle successfully', async () => {
    const engine = new SyncEngine(redisUrl)
    const result = await engine.switchCycle(sessionId)

    expect(result.status).toBe('running')
    expect(result.active_participant_id).toBe('player2')
  })
})
```

---

### Integration Tests: Supertest

**Why Supertest:**

1. **Express Integration** - Built for Express testing
2. **Simple API** - Chainable HTTP assertions
3. **No Server Start** - Tests against app instance

**Example:**
```typescript
import request from 'supertest'
import { app } from './app'

describe('POST /sessions/:id/switch', () => {
  it('should switch cycle', async () => {
    const response = await request(app)
      .post('/sessions/123/switch')
      .set('Authorization', `Bearer ${token}`)
      .send({ next_participant_id: 'player2' })
      .expect(200)

    expect(response.body.active_participant_id).toBe('player2')
  })
})
```

---

### Load Tests: k6

**Why k6:**

1. **High Performance** - Written in Go
2. **JavaScript Tests** - Familiar syntax
3. **Grafana Integration** - Visualize results
4. **CI/CD Friendly** - Easy to automate

**Example:**
```javascript
import http from 'k6/http'
import { check } from 'k6'

export const options = {
  vus: 100, // 100 virtual users
  duration: '30s'
}

export default function() {
  const res = http.post(
    'https://api.synckairos.io/v1/sessions/123/switch',
    JSON.stringify({ next_participant_id: 'player2' }),
    { headers: { 'Content-Type': 'application/json' } }
  )

  check(res, {
    'status is 200': (r) => r.status === 200,
    'latency < 50ms': (r) => r.timings.duration < 50
  })
}
```

---

## Development Tools

### Package Manager: pnpm

**Why pnpm:**

1. **Faster** - 2x faster than npm
2. **Disk Efficient** - Hard links instead of copies
3. **Strict** - Better dependency resolution
4. **Monorepo Support** - Built-in workspaces

**Usage:**
```bash
pnpm install
pnpm add express
pnpm add -D typescript
```

---

### Build Tool: tsup or esbuild

**Why tsup:**

1. **Zero Config** - Works out of the box
2. **Fast** - Uses esbuild internally
3. **TypeScript Native** - No setup needed

**Usage:**
```json
{
  "scripts": {
    "build": "tsup src/index.ts --format cjs,esm",
    "dev": "tsup src/index.ts --watch"
  }
}
```

---

## Complete Dependencies

### Backend package.json

```json
{
  "name": "@synckairos/backend",
  "version": "1.0.0",
  "type": "module",
  "engines": {
    "node": ">=20.0.0"
  },
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsup src/index.ts",
    "start": "node dist/index.js",
    "test": "vitest",
    "test:integration": "vitest --config vitest.integration.config.ts",
    "lint": "eslint src",
    "format": "prettier --write src"
  },
  "dependencies": {
    "express": "^4.18.2",
    "ws": "^8.14.2",
    "ioredis": "^5.3.2",
    "pg": "^8.11.3",
    "bullmq": "^4.12.0",
    "zod": "^3.22.4",
    "jsonwebtoken": "^9.0.2",
    "pino": "^8.16.0",
    "pino-http": "^8.5.0",
    "prom-client": "^15.0.0",
    "express-rate-limit": "^7.1.0",
    "rate-limit-redis": "^4.2.0",
    "cors": "^2.8.5",
    "dotenv": "^16.3.1",
    "firebase-admin": "^11.11.0"
  },
  "devDependencies": {
    "typescript": "^5.2.2",
    "@types/node": "^20.8.9",
    "@types/express": "^4.17.20",
    "@types/ws": "^8.5.8",
    "@types/pg": "^8.10.7",
    "@types/jsonwebtoken": "^9.0.5",
    "@types/cors": "^2.8.16",
    "vitest": "^0.34.6",
    "supertest": "^6.3.3",
    "@types/supertest": "^2.0.15",
    "tsx": "^4.1.0",
    "tsup": "^7.2.0",
    "eslint": "^8.52.0",
    "@typescript-eslint/eslint-plugin": "^6.9.1",
    "@typescript-eslint/parser": "^6.9.1",
    "prettier": "^3.0.3",
    "pino-pretty": "^10.2.3"
  }
}
```

---

## Project Structure (Backend Only)

```
synckairos/
├── src/
│   ├── api/
│   │   ├── routes/
│   │   │   ├── sessions.ts        # Session CRUD endpoints
│   │   │   ├── time.ts            # Server time sync endpoint
│   │   │   ├── devices.ts         # Device registration (for push)
│   │   │   └── health.ts          # Health check endpoints
│   │   ├── middlewares/
│   │   │   ├── auth.ts            # JWT authentication
│   │   │   ├── validation.ts      # Request validation
│   │   │   ├── rateLimit.ts       # Rate limiting
│   │   │   └── errorHandler.ts    # Error handling
│   │   └── controllers/
│   │       └── SessionController.ts
│   │
│   ├── engine/
│   │   └── SyncEngine.ts          # Core business logic
│   │
│   ├── state/
│   │   ├── RedisStateManager.ts   # Redis state management
│   │   └── DBWriteQueue.ts        # Async PostgreSQL writes
│   │
│   ├── websocket/
│   │   └── WebSocketServer.ts     # WebSocket server
│   │
│   ├── services/
│   │   └── PushNotificationService.ts  # Firebase push (for mobile)
│   │
│   ├── monitoring/
│   │   ├── metrics.ts             # Prometheus metrics
│   │   ├── logger.ts              # Pino logger
│   │   └── health.ts              # Health checks
│   │
│   ├── types/
│   │   ├── session.ts             # Session types
│   │   ├── participant.ts         # Participant types
│   │   └── index.ts               # Type exports
│   │
│   ├── config/
│   │   └── index.ts               # Configuration
│   │
│   └── index.ts                   # App entry point
│
├── tests/
│   ├── unit/
│   │   ├── SyncEngine.test.ts
│   │   └── RedisStateManager.test.ts
│   ├── integration/
│   │   └── api.test.ts
│   └── load/
│       └── load.test.js
│
├── migrations/
│   ├── 001_initial_schema.sql
│   └── 002_add_indexes.sql
│
├── docker/
│   ├── Dockerfile
│   └── docker-compose.yml
│
├── deployment/
│   ├── fly.toml
│   └── railway.toml
│
├── docs/                          # Project documentation
├── .env.example
├── .gitignore
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── vitest.config.ts
├── eslint.config.js
└── README.md
```

**Note:** No frontend code in this repository. Web and mobile clients will be separate projects that consume this API.

---

## TypeScript Configuration

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "lib": ["ES2022"],
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "allowJs": true,
    "outDir": "./dist",
    "rootDir": "./src",

    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,

    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,

    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

---

## Summary

### Final Stack

```yaml
# Backend
Runtime: Node.js 20 LTS
Language: TypeScript 5.x
Framework: Express 4.x
WebSocket: ws 8.x
Primary State: Redis 7.x (ioredis)
Audit Store: PostgreSQL 15+ (pg)
Queue: BullMQ 4.x
Validation: Zod 3.x
Auth: jsonwebtoken
Logging: Pino 8.x
Metrics: prom-client
Rate Limiting: express-rate-limit + rate-limit-redis

# Testing
Unit: Vitest
Integration: Supertest
Load: k6

# Development
Package Manager: pnpm
Build: tsup
Linting: ESLint + Prettier
Git Hooks: husky + lint-staged

# Deployment
Primary: Fly.io or Railway
Alternative: AWS App Runner
Container: Docker
Orchestration: Not needed (PaaS handles it)
```

### Key Strengths

1. **Performance** ✅
   - Node.js + Redis = 3-5ms hot path
   - WebSocket for sub-100ms delivery
   - Type-safe validation with Zod

2. **Scalability** ✅
   - Truly stateless (Redis primary state)
   - Horizontal scaling with no sticky sessions
   - Redis Pub/Sub for cross-instance sync

3. **Developer Experience** ✅
   - TypeScript type safety
   - Modern tooling (Vitest, tsup, pnpm)
   - Fast iteration with hot reload
   - Comprehensive testing

4. **Production Ready** ✅
   - Structured logging (Pino)
   - Metrics (Prometheus)
   - Rate limiting
   - Graceful error handling
   - Health checks

5. **Client-Agnostic API** ✅
   - REST + WebSocket works for any client (web, mobile, desktop)
   - Standard protocols (no vendor lock-in)
   - TypeScript type definitions can be exported for client projects

### Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Node.js single-threaded | I/O-bound workload, event loop is perfect |
| JavaScript runtime errors | TypeScript + Zod validation catch most issues |
| Redis single point of failure | Redis Sentinel or Cluster for HA |
| WebSocket scaling | Truly stateless + Redis Pub/Sub |

### Next Steps

1. ✅ **Decision**: Approve this tech stack
2. 📝 **Setup**: Create initial project structure
3. 🔧 **Implement**: Start with RedisStateManager
4. ✅ **Test**: Unit + integration tests
5. 🚀 **Deploy**: PaaS deployment

---

## Appendix: Performance Benchmarks

### Expected Performance (Node.js + Redis)

| Operation | Target | Expected | Notes |
|-----------|--------|----------|-------|
| GET session | <5ms | 1-2ms | Redis read |
| SET session | <5ms | 2-3ms | Redis write |
| Pub/Sub broadcast | <5ms | 1-2ms | Redis publish |
| switchCycle() total | <50ms | 3-5ms | Hot path |
| WebSocket delivery | <100ms | 50-80ms | Including network |
| Concurrent connections | 1000+ | 10,000+ | Per instance |
| Memory per session | N/A | ~1-2KB | In Redis |
| Instance memory | N/A | 50-100MB | Base footprint |

These numbers are conservative estimates. Real-world performance will likely exceed targets.
