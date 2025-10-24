# SyncKairos - Deployment Guide

**Version:** 2.0
**Last Updated:** 2025-10-20

---

## Overview

SyncKairos is designed as a **truly stateless**, high-performance service that deploys easily on modern PaaS platforms with built-in auto-scaling and multi-region support.

**Recommended Approach:** PaaS deployment (Fly.io, Railway, AWS App Runner) for effortless operation.

---

## Deployment Architecture (Corrected)

```
┌─────────────────────────────────────────────────┐
│    Global Load Balancer / CDN (Cloudflare)      │
└────────────┬────────────────────────────────────┘
             │
             ├──────────────┬──────────────┐
             │              │              │
             ▼              ▼              ▼
    ┌────────────┐  ┌────────────┐  ┌────────────┐
    │ SyncKairos │  │ SyncKairos │  │ SyncKairos │
    │ Instance 1 │  │ Instance 2 │  │ Instance N │
    │            │  │            │  │            │
    │ STATELESS  │  │ STATELESS  │  │ STATELESS  │
    └─────┬──────┘  └─────┬──────┘  └─────┬──────┘
          │               │               │
          └───────────────┼───────────────┘
                          │
                ┌─────────┴─────────┐
                │                   │
                ▼                   ▼
         ┌──────────┐         ┌──────────┐
         │  Redis   │         │PostgreSQL│
         │ Cluster  │────────▶│ Database │
         │(PRIMARY) │  async  │ (AUDIT)  │
         │          │  write  │          │
         │ Pub/Sub  │         │          │
         └──────────┘         └──────────┘
```

**Key Points:**
- **NO sticky sessions** - Load balancer uses round-robin
- **Truly stateless** - All state in Redis
- **Auto-scaling** - Based on CPU/memory/connections
- **Multi-region** - Deploy globally with PaaS

---

## Recommended Deployment: PaaS

### Why PaaS over Kubernetes?

| Aspect | Kubernetes | PaaS (Fly.io/Railway) |
|--------|------------|----------------------|
| Deployment complexity | High | Low |
| Time to deploy | Hours | Minutes |
| Auto-scaling config | Manual HPA setup | Built-in |
| Cost (small scale) | $180/mo + DevOps time | $20-40/mo |
| Multi-region | Manual setup | One command |
| Maintenance | High (upgrades, monitoring) | Managed |

**Verdict:** PaaS wins for 95% of use cases.

---

## Deployment Options

### Option 1: Fly.io (Recommended for Global Deployment) ⭐

**Best for:** Production deployments requiring global reach and effortless scaling.

**Configuration:**

Create `fly.toml`:
```toml
app = "synckairos"

[build]
  dockerfile = "Dockerfile"

[env]
  NODE_ENV = "production"
  PORT = "3000"

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 2
  max_machines_running = 10

[[vm]]
  cpu_kind = "shared"
  cpus = 2
  memory_mb = 2048

[metrics]
  port = 9091
  path = "/metrics"

# Multi-region deployment
[primary_region]
  primary = "iad"  # US East

# Auto-scaling
[scaling]
  min_machines = 2
  max_machines = 10

[[scaling.metrics]]
  type = "requests"
  value = 100

[[scaling.metrics]]
  type = "cpu"
  value = 80
```

**Deployment Commands:**
```bash
# Initial setup
fly launch

# Deploy
fly deploy

# Scale globally (optional)
fly scale count 3 --region iad,lhr,nrt

# Auto-scaling
fly autoscale set min=2 max=10

# Monitor
fly status
fly logs
```

**Cost:** ~$10-30/month for small scale

**Pros:**
- Global edge network (35+ regions)
- WebSocket support everywhere
- Auto-scaling built-in
- One-command deployment
- Multi-region by default

---

### Option 2: Railway.app (Easiest for Beginners) ⭐

**Best for:** Quick prototypes and small-to-medium production deployments.

**Configuration:**

Create `railway.toml`:
```toml
[build]
  builder = "nixpacks"
  buildCommand = "npm ci && npm run build"

[deploy]
  startCommand = "npm start"
  restartPolicyType = "on-failure"
  restartPolicyMaxRetries = 10

[[deploy.healthcheck]]
  path = "/health"
  interval = 10
  timeout = 5

[scaling]
  minInstances = 2
  maxInstances = 10
  targetCPU = 70
  targetMemory = 80
```

**Deployment:**
```bash
# Initial setup
railway login
railway init

# Deploy (or just push to GitHub)
railway up

# Add services
railway add postgresql
railway add redis

# Environment variables auto-configured
# DATABASE_URL, REDIS_URL are set automatically
```

**Cost:** Free tier available, ~$5-20/month for production

**Pros:**
- Zero configuration
- GitHub integration (auto-deploy on push)
- Built-in PostgreSQL and Redis
- Beautiful UI

---

### Option 3: AWS App Runner (AWS Native)

**Best for:** Teams already using AWS ecosystem.

**Configuration:**

Create `apprunner.yaml`:
```yaml
version: 1.0
runtime: nodejs18

build:
  commands:
    pre-build:
      - npm ci --only=production
    build:
      - npm run build

run:
  command: npm start
  network:
    port: 3000
    env: APP_PORT
  env:
    - name: NODE_ENV
      value: production
    - name: DATABASE_URL
      value-from: "arn:aws:secretsmanager:us-east-1:xxx:secret:synckairos/db"
    - name: REDIS_URL
      value-from: "arn:aws:secretsmanager:us-east-1:xxx:secret:synckairos/redis"

scaling:
  min_size: 2
  max_size: 10
  cpu: 1024
  memory: 2048

health_check:
  protocol: http
  path: /health
  interval: 10
  timeout: 5
```

**Deployment:**
```bash
# Deploy via AWS CLI
aws apprunner create-service \
  --service-name synckairos \
  --source-configuration file://apprunner.yaml
```

**Cost:** ~$25-50/month base + usage

---

### Option 4: Docker Deployment (Self-Hosted)

**Dockerfile:**
```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3000 3001

CMD ["npm", "start"]
```

**docker-compose.yml:**
```yaml
version: '3.8'

services:
  synckairos:
    build: .
    ports:
      - "3000:3000"  # REST API
      - "3001:3001"  # WebSocket
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://user:pass@postgres:5432/synckairos
      - REDIS_URL=redis://redis:6379
      - JWT_SECRET=${JWT_SECRET}
    depends_on:
      - postgres
      - redis
    restart: unless-stopped

  postgres:
    image: postgres:15-alpine
    environment:
      - POSTGRES_DB=synckairos
      - POSTGRES_USER=user
      - POSTGRES_PASSWORD=pass
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:
```

---

### Option 5: Kubernetes Deployment (Advanced Users Only)

**deployment.yaml:**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: synckairos
  labels:
    app: synckairos
spec:
  replicas: 3
  selector:
    matchLabels:
      app: synckairos
  template:
    metadata:
      labels:
        app: synckairos
    spec:
      containers:
      - name: synckairos
        image: synckairos:latest
        ports:
        - containerPort: 3000
          name: http
        - containerPort: 3001
          name: websocket
        env:
        - name: NODE_ENV
          value: "production"
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: synckairos-secrets
              key: database-url
        - name: REDIS_URL
          valueFrom:
            secretKeyRef:
              name: synckairos-secrets
              key: redis-url
        - name: JWT_SECRET
          valueFrom:
            secretKeyRef:
              name: synckairos-secrets
              key: jwt-secret
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5

---
apiVersion: v1
kind: Service
metadata:
  name: synckairos
spec:
  selector:
    app: synckairos
  ports:
  - name: http
    port: 80
    targetPort: 3000
  - name: websocket
    port: 3001
    targetPort: 3001
  type: LoadBalancer
```

**IMPORTANT:** Updated Kubernetes deployment with HPA (Horizontal Pod Autoscaler) and NO sticky sessions.

See [ARCHITECTURE_REVIEW.md](ARCHITECTURE_REVIEW.md#solution-3-kubernetes-with-auto-scaling-for-advanced-users) for complete Kubernetes configuration including:
- Horizontal Pod Autoscaler (HPA) with custom metrics
- No sticky sessions configuration
- Graceful shutdown for WebSocket connections
- Resource limits and health checks

**Note:** Kubernetes adds significant operational complexity. Only use if you have existing Kubernetes infrastructure and expertise.

---

### Option 6: Serverless (NOT RECOMMENDED)

**⚠️ WARNING:** Traditional serverless (AWS Lambda, Vercel Functions) is **NOT suitable** for SyncKairos due to:

1. **WebSocket Requirements:**
   - Persistent connections required
   - Lambda has 15-minute timeout
   - API Gateway WebSocket is limited and complex

2. **Performance:**
   - Cold starts break <50ms latency requirement
   - Provisioned concurrency is expensive

3. **Complexity:**
   - Requires split architecture (Lambda for REST, EC2/ECS for WebSocket)
   - More complex than traditional deployment
   - Defeats the purpose of "simple deployment"

**If you must use AWS:** Use AWS App Runner (Option 3) or ECS Fargate instead.

---

## Infrastructure Requirements

### Minimum Requirements

| Component | Specification |
|-----------|--------------|
| CPU | 2 cores |
| RAM | 4 GB |
| Storage | 20 GB SSD |
| Network | 1 Gbps |

### Recommended for Production

| Component | Specification |
|-----------|--------------|
| CPU | 4+ cores |
| RAM | 8+ GB |
| Storage | 100+ GB SSD |
| Network | 10 Gbps |

### Database

- **PostgreSQL 14+**
- Connection pool: 20-50 connections per instance
- Backups: Daily automated backups with point-in-time recovery

### Redis (PRIMARY State Store)

**CRITICAL:** Redis is the PRIMARY data store, not a cache. Redis failure = service unavailable.

#### Basic Requirements

- **Redis 6+** (Redis 7 recommended)
- **Memory:** 2-4 GB minimum (scales with active sessions)
- **Persistence:** AOF (Append Only File) enabled for durability
- **Pub/Sub:** Required for cross-instance communication
- **TTL:** Sessions auto-expire after 1 hour of inactivity

#### High Availability Strategy (Production Required)

**⚠️ CRITICAL:** Single Redis instance is a single point of failure. Production deployments MUST use Redis Sentinel or Cluster.

##### Option 1: Redis Sentinel (Recommended for Most Cases)

**Use Case:** Automatic failover with 5-10 second recovery time.

**Architecture:**
```
┌─────────────┐
│   Primary   │ ──writes──> AOF log (fsync every 1s)
│    Redis    │
└──────┬──────┘
       │ replication (async)
       ├────────────┬────────────┐
       ▼            ▼            ▼
  ┌─────────┐  ┌─────────┐  ┌─────────┐
  │Replica 1│  │Replica 2│  │Replica 3│
  └─────────┘  └─────────┘  └─────────┘
       │            │            │
       └────────────┴────────────┘
                    │
            ┌───────┴────────┐
            │ Sentinel Cluster│
            │  (3+ instances) │
            │ Auto-Failover   │
            └─────────────────┘
```

**Configuration:**

```conf
# redis-primary.conf
port 6379
bind 0.0.0.0
requirepass your-redis-password

# Persistence (critical for data durability)
appendonly yes
appendfsync everysec
auto-aof-rewrite-percentage 100
auto-aof-rewrite-min-size 64mb

# Replication
replicaof <primary-host> 6379
masterauth your-redis-password

# Memory
maxmemory 2gb
maxmemory-policy allkeys-lru
```

```conf
# sentinel.conf (run on 3+ separate nodes)
port 26379
sentinel monitor synckairos-primary <primary-host> 6379 2
sentinel auth-pass synckairos-primary your-redis-password
sentinel down-after-milliseconds synckairos-primary 5000
sentinel failover-timeout synckairos-primary 10000
sentinel parallel-syncs synckairos-primary 1
```

**Application Configuration:**

```typescript
import Redis from 'ioredis'

const redis = new Redis({
  sentinels: [
    { host: 'sentinel1', port: 26379 },
    { host: 'sentinel2', port: 26379 },
    { host: 'sentinel3', port: 26379 }
  ],
  name: 'synckairos-primary',
  password: process.env.REDIS_PASSWORD,
  sentinelPassword: process.env.SENTINEL_PASSWORD,
  db: 0
})
```

**Deployment:**
```bash
# Using Docker Compose
docker-compose -f docker-compose.sentinel.yml up -d
```

**Cost:** ~$60-120/month (3 Redis nodes + 3 sentinels)

**Recovery Time:** 5-10 seconds automatic failover

##### Option 2: Redis Cluster (For >10k Sessions)

**Use Case:** Horizontal scalability + high availability.

**Setup:**
```bash
# 6 nodes: 3 masters + 3 replicas
redis-cli --cluster create \
  host1:6379 host2:6379 host3:6379 \
  host4:6379 host5:6379 host6:6379 \
  --cluster-replicas 1
```

**Application Configuration:**
```typescript
import Redis from 'ioredis'

const redis = new Redis.Cluster([
  { host: 'node1', port: 6379 },
  { host: 'node2', port: 6379 },
  { host: 'node3', port: 6379 }
], {
  redisOptions: {
    password: process.env.REDIS_PASSWORD
  }
})
```

**Cost:** ~$200-400/month

**Recovery Time:** <5 seconds automatic failover

##### Option 3: Managed Redis (Easiest)

**Recommended Providers:**

| Provider | Use Case | Cost | HA | Global |
|----------|----------|------|-----|--------|
| **Upstash Redis** | PaaS deployments | $10-50/mo | ✅ Built-in | ✅ Multi-region |
| **AWS ElastiCache** | AWS ecosystem | $50-200/mo | ✅ Sentinel mode | ❌ Single region |
| **Redis Cloud** | Enterprise | $100+/mo | ✅ Cluster mode | ✅ Multi-region |
| **DigitalOcean Managed Redis** | Simple setup | $15-80/mo | ✅ Built-in | ❌ Single region |

**Upstash Configuration (Recommended):**
```typescript
import { Redis } from '@upstash/redis'

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN
})
```

**Benefits:**
- Zero configuration HA
- Global replication
- Auto-scaling
- No server management

#### Persistence Strategy

**CRITICAL:** Configure AOF (Append Only File) for data durability.

```conf
# redis.conf
appendonly yes
appendfsync everysec  # Fsync every second (good balance)
# appendfsync always  # Fsync every write (slower, safest)
# appendfsync no      # OS decides (fastest, least safe)

auto-aof-rewrite-percentage 100
auto-aof-rewrite-min-size 64mb
```

**Data Loss Risk:**
- `everysec`: Up to 1 second of data loss
- `always`: No data loss (but slower)
- `no`: Up to 30+ seconds of data loss

**Recommendation:** Use `everysec` for balance of performance and safety.

#### Monitoring Redis Health

**Critical Metrics:**
```bash
# Redis availability
redis-cli ping  # Should return PONG

# Replication lag
redis-cli info replication | grep master_repl_offset

# Memory usage
redis-cli info memory | grep used_memory_human

# Persistence status
redis-cli info persistence | grep aof_last_write_status
```

**Alerts to Configure:**
- Redis primary down >30 seconds
- Replication lag >5 seconds
- Memory usage >90%
- AOF write failures

---

## Environment Variables

```bash
# Server Configuration
NODE_ENV=production
PORT=3000
WS_PORT=3001

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/synckairos

# Redis Cache
REDIS_URL=redis://localhost:6379

# Authentication
JWT_SECRET=your-secret-key-here
JWT_EXPIRES_IN=7d

# CORS
ALLOWED_ORIGINS=https://yourdomain.com,https://app.yourdomain.com

# Monitoring
SENTRY_DSN=https://your-sentry-dsn
LOG_LEVEL=info

# Performance
MAX_SESSIONS_PER_INSTANCE=10000
SESSION_CACHE_TTL=3600

# WebSocket
WS_HEARTBEAT_INTERVAL=5000
WS_CONNECTION_TIMEOUT=30000
```

---

## Database Migrations

### Initial Setup

```bash
# Run migrations
npm run migrate

# Seed data (optional)
npm run seed
```

### Migration Files

Place SQL migration files in `migrations/` directory:

```sql
-- migrations/001_initial_schema.sql
-- See ARCHITECTURE.md for complete schema
```

---

## Monitoring & Observability

### Health Check Endpoints

```typescript
// GET /health
{
  "status": "ok",
  "timestamp": "2025-10-20T14:30:00.000Z",
  "uptime": 86400,
  "database": "connected",
  "redis": "connected"
}

// GET /ready
{
  "ready": true
}
```

### Metrics to Monitor

1. **Performance Metrics**
   - Cycle switch latency (p50, p95, p99)
   - WebSocket message delivery time
   - Server time sync accuracy
   - API response times

2. **System Metrics**
   - CPU usage
   - Memory usage
   - Active WebSocket connections
   - Database connection pool usage

3. **Business Metrics**
   - Active sessions count
   - Sessions created per minute
   - Average session duration
   - Timeout events count

### Logging

Use structured logging (JSON format):

```json
{
  "level": "info",
  "timestamp": "2025-10-20T14:30:00.000Z",
  "message": "Session created",
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "sync_mode": "per_participant",
  "participant_count": 2
}
```

---

## Scaling Strategy (Updated for Redis-First)

### Horizontal Scaling

SyncKairos is **truly stateless** and scales horizontally without complexity.

1. **Stateless Application Layer**
   - **Zero state in instance memory** - All state in Redis
   - **No sticky sessions required** - Any instance can serve any request
   - **Auto-scaling triggers:**
     - CPU > 70%
     - Memory > 80%
     - WebSocket connections > 500 per instance
     - HTTP requests > 100/sec per instance

2. **Redis Scaling (PRIMARY Store)**
   - **Small scale (< 1k sessions):** Single Redis instance (2GB)
   - **Medium scale (1k-10k sessions):** Redis with replication (4-8GB)
   - **Large scale (10k+ sessions):** Redis Cluster (16GB+)
   - **Managed options:** Upstash (serverless), Redis Cloud, ElastiCache

3. **PostgreSQL Scaling (AUDIT Only)**
   - **NOT on hot path** - Receives async writes only
   - **Read replicas** - For analytics queries only
   - **Connection pooling** - 20-50 connections per instance
   - **Partitioning** - By date for `sync_events` table

### Load Balancing (NO Sticky Sessions)

**IMPORTANT:** Load balancer uses **round-robin**, NOT sticky sessions.

- ✅ **Round-robin for all traffic** (REST + WebSocket)
- ✅ **Health check integration** (`/health`, `/ready`)
- ✅ **Graceful shutdown** - 15s drain period for WebSocket connections
- ❌ **NO sticky sessions** - Redis Pub/Sub handles cross-instance sync

**How it works:**
1. Client connects to Instance 1 via WebSocket
2. State change happens on Instance 2
3. Instance 2 broadcasts via Redis Pub/Sub
4. Instance 1 receives broadcast and pushes to WebSocket client
5. Perfect sync across all instances

---

## Security Considerations

### 1. Authentication

- **JWT token validation** on all endpoints
- **Token expiration** and refresh (7 days default)
- **Strong secrets** - Minimum 32 characters
- **HTTPS only** in production

### 2. Rate Limiting (Critical for DoS Prevention)

#### Per-Endpoint Rate Limits

| Endpoint | Rate Limit | Window | Key | Action on Exceed |
|----------|-----------|--------|-----|------------------|
| `POST /sessions/:id/switch` | 10 req/sec | 1 second | Per session | 429 + 10s cooldown |
| `POST /sessions` | 5 req/min | 1 minute | Per user | 429 Too Many Requests |
| `GET /sessions/:id` | 100 req/min | 1 minute | Per user | 429 Too Many Requests |
| `GET /time` | 60 req/min | 1 minute | Per client IP | 429 Too Many Requests |
| WebSocket connections | 5 connections/min | 1 minute | Per client IP | Reject connection |
| WebSocket messages | 100 msg/min | 1 minute | Per connection | Disconnect with 1008 |

#### Implementation (Express + Redis)

```typescript
import rateLimit from 'express-rate-limit'
import RedisStore from 'rate-limit-redis'
import { Redis } from 'ioredis'

const redisClient = new Redis(process.env.REDIS_URL)

// Global rate limiter
const globalLimiter = rateLimit({
  store: new RedisStore({
    client: redisClient,
    prefix: 'rl:global:'
  }),
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false
})

// Critical endpoint - cycle switch
const cycleSwitchLimiter = rateLimit({
  store: new RedisStore({
    client: redisClient,
    prefix: 'rl:switch:'
  }),
  windowMs: 1000, // 1 second
  max: 10, // 10 requests per second
  keyGenerator: (req) => req.params.session_id, // Rate limit per session, not per user
  message: { error: 'Too many cycle switches for this session' },
  skip: (req) => req.rateLimit.remaining <= 0 && req.rateLimit.limit > 0,
  handler: (req, res) => {
    res.status(429).json({
      error: 'Rate limit exceeded',
      message: 'Too many cycle switches, please slow down',
      retryAfter: 10 // seconds
    })
  }
})

// Session creation
const createSessionLimiter = rateLimit({
  store: new RedisStore({
    client: redisClient,
    prefix: 'rl:create:'
  }),
  windowMs: 60 * 1000,
  max: 5,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { error: 'Too many session creations' }
})

// Apply to routes
app.use('/api', globalLimiter)
app.post('/api/sessions/:id/switch', cycleSwitchLimiter, handleSwitchCycle)
app.post('/api/sessions', createSessionLimiter, handleCreateSession)
```

#### WebSocket Rate Limiting

```typescript
import WebSocket from 'ws'

const connectionAttempts = new Map<string, number[]>()

wss.on('connection', (ws, req) => {
  const clientIP = req.socket.remoteAddress

  // Check connection rate limit
  const now = Date.now()
  const attempts = connectionAttempts.get(clientIP) || []
  const recentAttempts = attempts.filter(t => now - t < 60000) // Last minute

  if (recentAttempts.length >= 5) {
    ws.close(1008, 'Too many connection attempts')
    return
  }

  // Record attempt
  recentAttempts.push(now)
  connectionAttempts.set(clientIP, recentAttempts)

  // Message rate limiting
  let messageCount = 0
  const messageWindow = setInterval(() => {
    messageCount = 0
  }, 60000) // Reset every minute

  ws.on('message', (data) => {
    messageCount++

    if (messageCount > 100) {
      ws.close(1008, 'Message rate limit exceeded')
      clearInterval(messageWindow)
      return
    }

    // Handle message...
  })

  ws.on('close', () => {
    clearInterval(messageWindow)
  })
})
```

### 3. WebSocket Security

- **Token validation** on connection
- **Origin verification** - Whitelist allowed origins
- **Message size limits** - Max 10KB per message
- **Connection limits** - Max 5 per user
- **Heartbeat timeout** - Disconnect after 30s inactivity

```typescript
// Origin verification
wss.on('connection', (ws, req) => {
  const origin = req.headers.origin
  const allowedOrigins = process.env.ALLOWED_ORIGINS.split(',')

  if (!allowedOrigins.includes(origin)) {
    ws.close(1008, 'Origin not allowed')
    return
  }

  // Message size limit
  ws.on('message', (data) => {
    if (data.length > 10240) { // 10KB
      ws.close(1009, 'Message too large')
      return
    }
    // Handle message...
  })
})
```

### 4. Database Security

- **Encrypted connections** (SSL/TLS)
- **Least privilege access** - App user can't DROP tables
- **Connection pooling** - Prevent connection exhaustion
- **SQL injection prevention** - Parameterized queries only
- **Regular security audits**

### 5. Input Validation

See [archive/ARCHITECTURE_REVIEW_2.md - Issue #12](archive/ARCHITECTURE_REVIEW_2.md) for complete validation schema.

**Critical validations:**
- `session_id` - Must be valid UUID
- `total_time_ms` - Range: 1000ms to 86400000ms (1s to 24h)
- `participants` - Max 1000 participants
- `metadata` - Max 10KB JSON size

### 6. DDoS Protection

- **Rate limiting** (see above)
- **Connection limits** - Max 10,000 WebSocket connections per instance
- **Cloudflare/AWS Shield** - L3/L4 DDoS protection
- **Auto-scaling** - Scale out under attack
- **Monitoring** - Alert on unusual traffic patterns

---

## Backup & Disaster Recovery

### Database Backups

- **Frequency:** Daily automated backups
- **Retention:** 30 days
- **Point-in-time recovery:** Enabled
- **Testing:** Monthly restore tests

### Redis Backups

- **Persistence:** AOF (Append Only File)
- **Snapshots:** Every 6 hours
- **Replication:** Master-slave setup

### Disaster Recovery Plan

1. **RTO (Recovery Time Objective):** < 1 hour
2. **RPO (Recovery Point Objective):** < 15 minutes
3. **Backup restoration procedure documented**
4. **Regular DR drills**

---

## CI/CD Pipeline

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm test
      - run: npm run lint

  build:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: docker/build-push-action@v4
        with:
          push: true
          tags: synckairos:${{ github.sha }}

  deploy:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to Kubernetes
        run: |
          kubectl set image deployment/synckairos \
            synckairos=synckairos:${{ github.sha }}
          kubectl rollout status deployment/synckairos
```

---

## Performance Optimization

1. **Database Query Optimization**
   - Proper indexing on frequently queried fields
   - Use of prepared statements
   - Connection pooling

2. **Caching Strategy**
   - Active sessions in Redis
   - Cache invalidation on updates
   - Read-through cache pattern

3. **WebSocket Optimization**
   - Message batching where possible
   - Compression for large payloads
   - Connection pooling

4. **Code Optimization**
   - Async/await for I/O operations
   - Avoid blocking operations
   - Memory leak prevention

---

## Cost Estimation

### Small Scale (< 1,000 concurrent sessions)

- **Compute:** $50-100/month (2x small instances)
- **Database:** $30-50/month (small PostgreSQL instance)
- **Redis:** $20-30/month (small cache instance)
- **Total:** ~$100-180/month

### Medium Scale (1,000-10,000 concurrent sessions)

- **Compute:** $200-400/month (4x medium instances)
- **Database:** $100-200/month (medium PostgreSQL with read replicas)
- **Redis:** $80-150/month (Redis cluster)
- **Total:** ~$380-750/month

### Large Scale (10,000+ concurrent sessions)

- **Compute:** $1,000+/month (10+ instances with auto-scaling)
- **Database:** $500+/month (large PostgreSQL cluster)
- **Redis:** $300+/month (Redis cluster with replication)
- **Total:** ~$1,800+/month

---

## Deployment Checklist

- [ ] Environment variables configured
- [ ] Database migrations applied
- [ ] Redis cache connected
- [ ] JWT secret generated
- [ ] SSL/TLS certificates installed
- [ ] Health check endpoints working
- [ ] Monitoring and logging configured
- [ ] Backup strategy implemented
- [ ] Load testing completed
- [ ] Security audit performed
- [ ] Documentation updated
- [ ] DR plan documented and tested
