# Task 4.3: Infrastructure Setup

**Phase:** 4 - Deployment
**Component:** Managed Infrastructure (Redis, PostgreSQL, Monitoring)
**Priority:** ⭐ **CRITICAL PATH**
**Estimated Time:** 2 days (16 hours)
**Status:** ⚪ Pending
**Dependencies:** Task 4.2 (PaaS Configuration) ✅ Complete

---

## Objective

Set up production-ready managed infrastructure including Redis (primary state store), PostgreSQL (audit store), and monitoring/alerting with Grafana Cloud or DataDog. Ensure all services are production-grade with automatic backups, high availability, and proper monitoring.

**Key Focus:** Zero-maintenance managed services with built-in HA and monitoring.

---

## Success Criteria

- [ ] ✅ Managed Redis configured and accessible
- [ ] ✅ Redis connection string added to PaaS secrets
- [ ] ✅ Managed PostgreSQL configured and accessible
- [ ] ✅ Database migrations run successfully
- [ ] ✅ PostgreSQL connection string added to PaaS secrets
- [ ] ✅ Monitoring dashboards created (latency, throughput, errors)
- [ ] ✅ Alerts configured (high latency, errors, queue backup)
- [ ] ✅ All services tested end-to-end
- [ ] ✅ Application deployed with full infrastructure

---

## Day 1: Redis & PostgreSQL Setup (8 hours)

### Morning: Managed Redis (4 hours)

#### Option A: Upstash Redis (Recommended - Free Tier)

**1. Create Upstash Account (15 minutes)**

```bash
# Visit https://upstash.com and sign up
# Or use Fly.io integration:
flyctl ext redis create
```

**2. Create Redis Database (30 minutes)**

**Via Upstash Console:**
- Go to https://console.upstash.com
- Click "Create Database"
- Choose region closest to your app (e.g., `us-west-1` for San Jose)
- Select plan:
  - **Free tier:** 10k commands/day, 256MB storage
  - **Pay-as-you-go:** $0.20 per 100k commands
- Enable:
  - ✅ TLS
  - ✅ Eviction policy: `allkeys-lru`
  - ✅ Auto-backup (if available)

**Via Fly.io Extension:**
```bash
# Create Redis through Fly.io
flyctl ext redis create \
  --name synckairos-redis \
  --region sjc \
  --plan free
```

**3. Get Connection Details (15 minutes)**

**From Upstash:**
```bash
# Connection string format:
rediss://:PASSWORD@ENDPOINT:PORT

# Example:
rediss://:AYHxASQgZjk0Yjg...@us1-merry-frog-12345.upstash.io:6379
```

**From Fly.io:**
```bash
flyctl ext redis show synckairos-redis
# Copy the REDIS_URL value
```

**4. Configure Connection String (30 minutes)**

```bash
# Set Redis URL in Fly.io secrets
REDIS_URL="rediss://your-connection-string"
flyctl secrets set REDIS_URL="$REDIS_URL" --app synckairos-staging

# Verify secret is set
flyctl secrets list --app synckairos-staging
```

**5. Test Redis Connection (45 minutes)**

**Create test script:** `scripts/test-redis.js`
```javascript
import Redis from 'ioredis'

const redis = new Redis(process.env.REDIS_URL)

async function testRedis() {
  console.log('Testing Redis connection...')

  // Test PING
  const pong = await redis.ping()
  console.log('✓ PING:', pong)

  // Test SET/GET
  await redis.set('test:key', 'hello')
  const value = await redis.get('test:key')
  console.log('✓ SET/GET:', value)

  // Test TTL
  await redis.setex('test:ttl', 10, 'expires')
  const ttl = await redis.ttl('test:ttl')
  console.log('✓ TTL:', ttl)

  // Test Pub/Sub
  const subscriber = redis.duplicate()
  await subscriber.subscribe('test:channel')
  subscriber.on('message', (channel, message) => {
    console.log('✓ Pub/Sub:', channel, message)
  })
  await redis.publish('test:channel', 'hello')

  await redis.quit()
  await subscriber.quit()
  console.log('✓ All Redis tests passed!')
}

testRedis().catch(console.error)
```

**Run test:**
```bash
REDIS_URL="your-connection-string" node scripts/test-redis.js
```

**6. Configure Redis Settings (45 minutes)**

**Upstash Console Settings:**
- **Max Memory Policy:** `allkeys-lru` (evict old keys when memory full)
- **Max Connections:** Auto (or increase if needed)
- **TLS:** Enabled (required for security)
- **Persistence:** Enabled (automatic backups)

**Verify settings:**
```bash
# Connect with redis-cli
redis-cli -u "$REDIS_URL" INFO memory
redis-cli -u "$REDIS_URL" CONFIG GET maxmemory-policy
```

---

#### Option B: Redis Cloud (Alternative - Production Grade)

**1. Create Redis Cloud Account**
- Visit https://redis.com/try-free/
- Sign up for free trial (30MB free)

**2. Create Database**
- Choose subscription: Flexible (Pay-as-you-go)
- Region: Same as application
- Redis version: 7.x
- Dataset size: 256MB minimum
- Replication: Enabled (High Availability)

**3. Enable Features**
- Redis Sentinel (automatic failover)
- Backups: Daily
- Alerts: Enabled

**4. Get connection string and configure same as Upstash**

---

### Afternoon: Managed PostgreSQL (4 hours)

#### Option A: Supabase (Recommended - Free Tier)

**1. Create Supabase Account (15 minutes)**

```bash
# Visit https://supabase.com and sign up
# Or use Fly.io Postgres:
flyctl postgres create --name synckairos-db --region sjc
```

**2. Create PostgreSQL Project (30 minutes)**

**Via Supabase:**
- Go to https://app.supabase.com
- Click "New Project"
- Project name: `synckairos-staging`
- Database password: Generate strong password
- Region: Closest to your app
- Plan: Free tier (500MB storage, 2GB bandwidth)

**Via Fly.io:**
```bash
# Create Postgres instance
flyctl postgres create \
  --name synckairos-db \
  --region sjc \
  --initial-cluster-size 2 \
  --vm-size shared-cpu-1x \
  --volume-size 10

# Get connection string
flyctl postgres connect -a synckairos-db
```

**3. Get Connection Details (15 minutes)**

**From Supabase:**
```bash
# Go to Settings > Database > Connection string
# Copy "Connection string" (Direct connection)

# Format:
postgresql://postgres:PASSWORD@db.PROJECT.supabase.co:5432/postgres

# Example:
postgresql://postgres:your-password@db.abcdefghijklmnop.supabase.co:5432/postgres
```

**Enable connection pooling (recommended):**
```bash
# Use Transaction mode for best performance
# Replace :5432 with :6543 for pooler
postgresql://postgres:PASSWORD@db.PROJECT.supabase.co:6543/postgres?pgbouncer=true
```

**From Fly.io:**
```bash
flyctl postgres connect -a synckairos-db
# Connection string shown in output
```

**4. Configure Connection String (30 minutes)**

```bash
# Set DATABASE_URL in Fly.io secrets
DATABASE_URL="postgresql://your-connection-string"
flyctl secrets set DATABASE_URL="$DATABASE_URL" --app synckairos-staging

# Verify secret is set
flyctl secrets list --app synckairos-staging
```

**5. Run Database Migrations (45 minutes)**

**Test connection first:**
```bash
# Install psql if not already installed
brew install postgresql

# Test connection
psql "$DATABASE_URL" -c "SELECT version();"
```

**Run migrations:**
```bash
# Ensure migrations directory exists
ls migrations/

# Run migration
psql "$DATABASE_URL" -f migrations/001_initial_schema.sql

# Verify tables created
psql "$DATABASE_URL" -c "\dt"
psql "$DATABASE_URL" -c "SELECT count(*) FROM sync_sessions;"
```

**6. Test PostgreSQL Connection (45 minutes)**

**Create test script:** `scripts/test-postgres.js`
```javascript
import pg from 'pg'
const { Pool } = pg

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

async function testPostgres() {
  console.log('Testing PostgreSQL connection...')

  const client = await pool.connect()

  try {
    // Test connection
    const version = await client.query('SELECT version()')
    console.log('✓ Connected:', version.rows[0].version.split(' ')[0])

    // Test tables exist
    const tables = await client.query(`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
    `)
    console.log('✓ Tables:', tables.rows.map(r => r.tablename))

    // Test insert
    await client.query('BEGIN')
    const testSession = await client.query(`
      INSERT INTO sync_sessions
      (session_id, sync_mode, time_per_cycle_ms, created_at, last_updated_at)
      VALUES ($1, $2, $3, NOW(), NOW())
      RETURNING session_id
    `, ['test-session-' + Date.now(), 'per_participant', 60000])
    console.log('✓ Insert:', testSession.rows[0].session_id)
    await client.query('ROLLBACK')

    console.log('✓ All PostgreSQL tests passed!')
  } finally {
    client.release()
    await pool.end()
  }
}

testPostgres().catch(console.error)
```

**Run test:**
```bash
DATABASE_URL="your-connection-string" node scripts/test-postgres.js
```

**7. Configure PostgreSQL Settings (30 minutes)**

**Supabase Settings:**
- Connection pooling: Enabled (Transaction mode)
- Auto-pause: Disabled (for production)
- Backups: Automatic daily backups
- Point-in-time recovery: Enabled

**Verify settings:**
```bash
psql "$DATABASE_URL" -c "SHOW max_connections;"
psql "$DATABASE_URL" -c "SHOW shared_buffers;"
```

---

#### Option B: Neon (Alternative - Serverless PostgreSQL)

**1. Create Neon Account**
- Visit https://neon.tech
- Sign up for free tier (0.5GB storage, 100 hours compute)

**2. Create Project**
- Project name: `synckairos`
- Region: Same as application
- PostgreSQL version: 15

**3. Create Database**
- Database: `synckairos_production`
- Branch: `main` (production)
- Create `staging` branch for testing

**4. Get connection string**
- Go to Dashboard > Connection Details
- Copy connection string
- Use connection pooling endpoint for better performance

**5. Run migrations and test same as Supabase**

---

## Day 2: Monitoring & Validation (8 hours)

### Morning: Monitoring Setup (4 hours)

#### Option A: Grafana Cloud (Recommended - Free Tier)

**1. Create Grafana Cloud Account (15 minutes)**

```bash
# Visit https://grafana.com/auth/sign-up/create-user
# Free tier: 10k series, 14-day retention, 50GB logs
```

**2. Configure Prometheus Remote Write (45 minutes)**

**Get credentials:**
- Go to Grafana Cloud > Prometheus
- Copy "Remote Write Endpoint"
- Generate API key

**Update application to push metrics:**

**File:** `src/api/middlewares/metrics.ts` (add at end)
```typescript
// Optional: Configure remote write for Grafana Cloud
if (process.env.GRAFANA_REMOTE_WRITE_URL) {
  // Note: prom-client doesn't support remote write directly
  // You'll need to use a sidecar like prometheus-pushgateway
  // or use Grafana Agent for metrics collection
  console.log('Grafana remote write configured')
}
```

**Alternative: Use Grafana Agent (simpler):**
```yaml
# grafana-agent.yaml
metrics:
  global:
    scrape_interval: 15s
    remote_write:
      - url: https://prometheus-prod-01-eu-west-0.grafana.net/api/prom/push
        basic_auth:
          username: YOUR_INSTANCE_ID
          password: YOUR_API_KEY

  configs:
    - name: synckairos
      scrape_configs:
        - job_name: 'synckairos'
          static_configs:
            - targets: ['localhost:3000']
          metrics_path: '/metrics'
```

**3. Create Dashboards (1.5 hours)**

**Dashboard 1: Latency Dashboard**
```json
{
  "title": "SyncKairos - Latency",
  "panels": [
    {
      "title": "switchCycle() Latency",
      "targets": [
        {
          "expr": "histogram_quantile(0.50, synckairos_switch_cycle_duration_ms_bucket)",
          "legendFormat": "p50"
        },
        {
          "expr": "histogram_quantile(0.95, synckairos_switch_cycle_duration_ms_bucket)",
          "legendFormat": "p95"
        },
        {
          "expr": "histogram_quantile(0.99, synckairos_switch_cycle_duration_ms_bucket)",
          "legendFormat": "p99"
        }
      ],
      "yAxis": { "unit": "ms" }
    },
    {
      "title": "HTTP Request Duration",
      "targets": [
        {
          "expr": "histogram_quantile(0.95, synckairos_http_request_duration_ms_bucket)",
          "legendFormat": "{{route}} p95"
        }
      ]
    }
  ]
}
```

**Dashboard 2: Throughput Dashboard**
- Active sessions (gauge)
- Requests per second (rate)
- WebSocket connections (gauge)
- DB write queue depth (gauge)

**Dashboard 3: Error Rate Dashboard**
- HTTP errors by status code
- Error rate percentage
- Failed DB writes

**4. Configure Alerts (1 hour)**

**Alert 1: High Latency**
```yaml
- name: high_latency
  condition: |
    histogram_quantile(0.95,
      synckairos_switch_cycle_duration_ms_bucket
    ) > 50
  for: 5m
  annotations:
    summary: "High switchCycle latency"
    description: "p95 latency > 50ms for 5 minutes"
  actions:
    - email: alerts@yourdomain.com
    - slack: #synckairos-alerts
```

**Alert 2: High Error Rate**
```yaml
- name: high_error_rate
  condition: |
    rate(synckairos_http_requests_total{status_code=~"5.."}[5m]) /
    rate(synckairos_http_requests_total[5m]) > 0.01
  for: 5m
  annotations:
    summary: "High error rate"
    description: "Error rate > 1% for 5 minutes"
```

**Alert 3: Queue Backup**
```yaml
- name: queue_backup
  condition: |
    synckairos_db_write_queue_size > 1000
  for: 10m
  annotations:
    summary: "DB write queue backed up"
    description: "Queue depth > 1000 for 10 minutes"
```

**5. Configure Notification Channels (30 minutes)**

**Email:**
- Add email addresses in Grafana Cloud > Alerting > Contact points

**Slack (recommended):**
```bash
# Create Slack app: https://api.slack.com/apps
# Add incoming webhook
# Add webhook URL to Grafana Cloud contact points
```

---

#### Option B: DataDog (Alternative - Full APM)

**1. Create DataDog Account**
- Visit https://www.datadoghq.com
- Free trial: 14 days full features

**2. Install DataDog Agent**
```bash
# Install agent on your server or use Fly.io integration
flyctl ext datadog create
```

**3. Configure APM**
- Application name: `synckairos`
- Service: `api`
- Environment: `staging` / `production`

**4. Create dashboards similar to Grafana**

**5. Set up alerts and notifications**

---

### Afternoon: End-to-End Validation (4 hours)

**1. Deploy Application with Full Infrastructure (1 hour)**

```bash
# Ensure all secrets are set
flyctl secrets list --app synckairos-staging

# Should include:
# - JWT_SECRET
# - NODE_ENV
# - PORT
# - LOG_LEVEL
# - REDIS_URL  ← NEW
# - DATABASE_URL  ← NEW

# Deploy
./scripts/deploy.sh synckairos-staging staging
```

**2. Smoke Tests (1 hour)**

**Create smoke test script:** `scripts/smoke-test.sh`
```bash
#!/bin/bash
set -e

APP_URL="${1:-https://synckairos-staging.fly.dev}"

echo "Running smoke tests against $APP_URL"

# Test health endpoint
echo "Testing /health..."
curl -f "$APP_URL/health" || exit 1
echo "✓ Health check passed"

# Test ready endpoint
echo "Testing /ready..."
curl -f "$APP_URL/ready" || exit 1
echo "✓ Ready check passed"

# Test metrics endpoint
echo "Testing /metrics..."
curl -f "$APP_URL/metrics" | grep -q "synckairos_active_sessions" || exit 1
echo "✓ Metrics endpoint working"

# Test session creation
echo "Testing POST /v1/sessions..."
SESSION_ID=$(uuidgen)
curl -f -X POST "$APP_URL/v1/sessions" \
  -H "Content-Type: application/json" \
  -d "{
    \"session_id\": \"$SESSION_ID\",
    \"sync_mode\": \"per_participant\",
    \"participants\": [
      {\"participant_id\": \"$(uuidgen)\", \"participant_index\": 0, \"total_time_ms\": 60000}
    ]
  }" || exit 1
echo "✓ Session creation passed"

# Test session retrieval
echo "Testing GET /v1/sessions/$SESSION_ID..."
curl -f "$APP_URL/v1/sessions/$SESSION_ID" | grep -q "$SESSION_ID" || exit 1
echo "✓ Session retrieval passed"

echo ""
echo "✓ All smoke tests passed!"
```

**Run smoke tests:**
```bash
chmod +x scripts/smoke-test.sh
./scripts/smoke-test.sh https://synckairos-staging.fly.dev
```

**3. Monitor Metrics (1 hour)**

**Check Grafana dashboards:**
- Are metrics flowing?
- Is latency acceptable?
- Are error rates normal?

**Check application logs:**
```bash
flyctl logs --app synckairos-staging -f
```

**Check resource usage:**
```bash
flyctl status --app synckairos-staging
flyctl vm status --app synckairos-staging
```

**4. Load Testing (Optional) (1 hour)**

**Run baseline k6 test:**
```bash
# Update BASE_URL in test
K6_BASE_URL=https://synckairos-staging.fly.dev \
  k6 run tests/load/scenarios/01-baseline.js
```

**Monitor during test:**
- Grafana dashboards
- Application logs
- Resource usage

---

## Acceptance Checklist

### Redis Complete
- [ ] Upstash/Redis Cloud account created
- [ ] Redis database created
- [ ] Connection string added to secrets
- [ ] Redis connection tested
- [ ] Settings configured (TLS, eviction policy, backups)

### PostgreSQL Complete
- [ ] Supabase/Neon account created
- [ ] PostgreSQL database created
- [ ] Connection string added to secrets
- [ ] Migrations run successfully
- [ ] PostgreSQL connection tested
- [ ] Settings configured (connection pooling, backups)

### Monitoring Complete
- [ ] Grafana Cloud/DataDog account created
- [ ] 3 dashboards created (latency, throughput, errors)
- [ ] 3 alerts configured (latency, error rate, queue backup)
- [ ] Notification channels configured (email/Slack)
- [ ] Metrics flowing to monitoring platform

### Validation Complete
- [ ] Application deployed with full infrastructure
- [ ] All smoke tests passing
- [ ] Metrics visible in dashboards
- [ ] Logs streaming correctly
- [ ] Resource usage acceptable

---

## Files to Create

**Test Scripts:**
- `scripts/test-redis.js` - Redis connection test
- `scripts/test-postgres.js` - PostgreSQL connection test
- `scripts/smoke-test.sh` - End-to-end smoke tests

**Configuration:**
- `grafana-agent.yaml` - Grafana Agent config (optional)
- `.env.production` - Complete environment variables

**Documentation:**
- `docs/deployment/INFRASTRUCTURE.md` - Infrastructure setup guide
- `docs/deployment/MONITORING.md` - Monitoring and alerts guide

---

## Troubleshooting

### Redis Issues

**"Connection refused"**
- Check TLS is enabled (`rediss://` not `redis://`)
- Verify firewall rules allow connection
- Check Redis URL format is correct

**"Too many connections"**
- Increase max connections in Redis settings
- Check for connection leaks in application

### PostgreSQL Issues

**"SSL required"**
- Add `?sslmode=require` to connection string
- Or use `ssl: { rejectUnauthorized: false }` in pg config

**"Connection pool exhausted"**
- Increase max connections
- Use connection pooling (pgBouncer)
- Check for query leaks

**"Migrations fail"**
- Check PostgreSQL version compatibility
- Verify user has CREATE TABLE permissions
- Check SQL syntax

### Monitoring Issues

**"Metrics not appearing"**
- Check `/metrics` endpoint is accessible
- Verify Grafana Agent is running
- Check remote write credentials

**"Alerts not firing"**
- Verify alert conditions are correct
- Check notification channels configured
- Test with manual alert trigger

---

## Cost Summary

### Free Tier Recommended Setup

**Upstash Redis:**
- Free tier: 10k commands/day, 256MB
- Cost when exceeding: ~$10/month for moderate usage

**Supabase PostgreSQL:**
- Free tier: 500MB storage, 2GB bandwidth/month
- Cost when exceeding: ~$25/month for 8GB

**Grafana Cloud:**
- Free tier: 10k metrics series, 14-day retention
- Cost when exceeding: ~$50/month for extended retention

**Total estimated monthly cost:** $0-85/month depending on usage

### Production-Grade Alternative

**Redis Cloud:**
- 256MB database with HA: ~$20/month
- 1GB database with HA: ~$40/month

**Neon PostgreSQL:**
- Pro plan: $19/month + compute usage
- With branches: ~$30-50/month

**DataDog:**
- 5 hosts: ~$75/month
- APM: ~$36/host/month

**Total production cost:** ~$130-200/month

---

## Next Steps

After Component 4.3 completion:
1. Verify all infrastructure is operational
2. Run comprehensive smoke tests
3. Move to Component 4.4 (Production Validation)
4. Deploy to production
5. **🚀 LAUNCH!**

---

**Last Updated:** 2025-10-22
**Status:** ⚪ Pending - Ready after Component 4.2
