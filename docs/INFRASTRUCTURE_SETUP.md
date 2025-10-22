# Infrastructure Setup Guide

**Component:** 4.3 - Managed Infrastructure
**Services:** Upstash Redis + Supabase PostgreSQL
**Date:** 2025-10-22

---

## 1. Upstash Redis Setup

### Step 1: Create Account
1. Visit https://upstash.com/
2. Sign up with GitHub (fastest) or email
3. Verify your email if using email signup

### Step 2: Create Redis Database
1. Click **"Create Database"** in the dashboard
2. Configure database:
   - **Name:** `synckairos-staging`
   - **Type:** Regional (lower latency)
   - **Region:** US West (Oregon) or US West (N. California)
     - Match closest to Fly.io `sjc` region
   - **Plan:** Free (10k commands/day, 256MB)
   - **TLS:** Enabled (required for production)
   - **Eviction:** Enabled (recommended)
3. Click **"Create"**

### Step 3: Get Connection URL
1. On the database details page, scroll to **"REST API"** or **"Connection"** section
2. Copy **REDIS_URL** (format: `rediss://default:***@***.upstash.io:6379`)
3. Keep this URL secure - you'll add it to `.env.production`

### Features Included (Free Tier)
- ✅ 10,000 commands per day
- ✅ 256 MB storage
- ✅ TLS encryption
- ✅ Global replication (optional)
- ✅ 99.99% SLA
- ✅ Redis 7.x compatible

---

## 2. Supabase PostgreSQL Setup

### Step 1: Create Account
1. Visit https://supabase.com/
2. Sign in with GitHub (fastest) or email
3. Complete onboarding

### Step 2: Create Project
1. Click **"New Project"**
2. Configure project:
   - **Organization:** Create new or use existing
   - **Name:** `synckairos-staging`
   - **Database Password:** Generate strong password (save securely!)
   - **Region:** West US (Oregon) - matches Fly.io and Upstash
   - **Plan:** Free (500MB database, 2GB bandwidth/month)
   - **Pricing:** $0/month
3. Click **"Create new project"**
4. Wait 2-3 minutes for provisioning

### Step 3: Get Connection URL
1. In project dashboard, click **"Project Settings"** (gear icon)
2. Navigate to **"Database"** in left sidebar
3. Scroll to **"Connection string"** section
4. Select **"URI"** tab
5. Copy the connection string (format: `postgresql://postgres:[YOUR-PASSWORD]@***.supabase.co:5432/postgres`)
6. Replace `[YOUR-PASSWORD]` with the password you set in Step 2
7. Keep this URL secure - you'll add it to `.env.production`

### Step 4: Run Migrations
After getting the DATABASE_URL, run migrations:
```bash
# Set environment variable
export DATABASE_URL="postgresql://postgres:***@***.supabase.co:5432/postgres"

# Run migrations (will be available after Phase 1 schema is finalized)
pnpm run migrate:production
```

### Features Included (Free Tier)
- ✅ 500 MB database storage
- ✅ 2 GB bandwidth per month
- ✅ Up to 10,000 rows in real-time tables
- ✅ 50 MB file storage
- ✅ SSL connections
- ✅ Automatic backups (7 days)
- ✅ PostgreSQL 15+

---

## 3. Environment Configuration

### Create `.env.production`
Create a `.env.production` file in project root (never commit this!):

```bash
# Node environment
NODE_ENV=production
PORT=3000
LOG_LEVEL=info

# Authentication
JWT_SECRET=gslCblK3Bu94NiOZlIPhdTdBxYZOsnDx6J3lzKSancA=

# Upstash Redis
REDIS_URL=rediss://default:***@***.upstash.io:6379

# Supabase PostgreSQL
DATABASE_URL=postgresql://postgres:***@***.supabase.co:5432/postgres
```

### Add to `.gitignore`
Ensure `.env.production` is in `.gitignore`:
```bash
echo ".env.production" >> .gitignore
```

---

## 4. Testing Infrastructure

### Test Redis Connection
```bash
node scripts/test-redis.js
```

Expected output:
```
✅ Test 1: Connection - PING: PONG
✅ Test 2: SET/GET - success
✅ Test 3: Hash Operations - HSET/HGETALL
✅ Test 4: List Operations - LPUSH/LRANGE
✅ Test 5: TTL Operations - 60s remaining
✅ Test 6: Pub/Sub - message received
✅ Test 7: Server Info - Redis 7.x
✅ All Redis tests passed!
```

### Test PostgreSQL Connection
```bash
node scripts/test-postgres.js
```

Expected output:
```
✅ Test 1: Connection - timestamp + version
✅ Test 2: Schema Validation - 4 tables found
✅ Test 3: Basic CRUD - INSERT/SELECT/UPDATE/DELETE
✅ Test 4: Connection Pool - status ok
✅ Test 5: Query Performance - <50ms
✅ All PostgreSQL tests passed!
```

---

## 5. Configure Fly.io Secrets

### Add Infrastructure URLs to Fly.io
```bash
# Set Redis URL
flyctl secrets set REDIS_URL="rediss://default:***@***.upstash.io:6379" --app synckairos-staging

# Set PostgreSQL URL
flyctl secrets set DATABASE_URL="postgresql://postgres:***@***.supabase.co:5432/postgres" --app synckairos-staging
```

### Verify Secrets
```bash
flyctl secrets list --app synckairos-staging
```

Expected output:
```
NAME          DIGEST
DATABASE_URL  ***
JWT_SECRET    ***
LOG_LEVEL     ***
NODE_ENV      ***
PORT          ***
REDIS_URL     ***
```

---

## 6. Monitoring Setup (Day 2)

### Option A: Grafana Cloud (Recommended)
- Free tier: 10k metrics, 50GB logs, 14-day retention
- Setup guide: [docs/MONITORING_SETUP.md](MONITORING_SETUP.md)

### Option B: Datadog
- Free tier: 5 hosts, 1-day retention
- Higher costs for production

---

## Cost Summary

| Service | Free Tier | Production Tier |
|---------|-----------|-----------------|
| **Upstash Redis** | $0 (10k cmds/day) | $10/month (1M cmds/day) |
| **Supabase PostgreSQL** | $0 (500MB) | $25/month (8GB) |
| **Fly.io** | $0 (3 machines stopped) | $15-30/month (2-10 instances) |
| **Grafana Cloud** | $0 (10k metrics) | $50/month (production) |
| **Total** | **$0/month** | **$100-115/month** |

---

## Troubleshooting

### Redis Connection Issues
- **Error: ECONNREFUSED** - Check TLS enabled (use `rediss://` not `redis://`)
- **Error: Authentication failed** - Verify password in REDIS_URL
- **Error: Timeout** - Check firewall rules, network connectivity

### PostgreSQL Connection Issues
- **Error: ECONNREFUSED** - Verify DATABASE_URL format, check SSL settings
- **Error: password authentication failed** - Check password in connection string
- **Error: database does not exist** - Verify database name (usually `postgres`)
- **Error: SSL required** - Ensure SSL is enabled in connection options

### Migration Issues
- **Error: relation does not exist** - Run migrations first: `pnpm run migrate:production`
- **Error: permission denied** - Check user has CREATE/ALTER permissions

---

## Security Checklist

- [ ] ✅ `.env.production` added to `.gitignore`
- [ ] ✅ Strong passwords generated (min 32 characters)
- [ ] ✅ TLS/SSL enabled for all connections
- [ ] ✅ Secrets stored in Fly.io (not in code)
- [ ] ✅ Connection strings never logged
- [ ] ✅ Database backups enabled (Supabase automatic)
- [ ] ✅ IP allowlists configured (if needed)

---

## Next Steps

1. ✅ Complete Upstash Redis setup
2. ✅ Complete Supabase PostgreSQL setup
3. ✅ Run test scripts to validate connectivity
4. ✅ Add secrets to Fly.io
5. ⏭️ Return to Component 4.2 and complete staging deployment
6. ⏭️ Set up monitoring (Component 4.3 Day 2)
7. ⏭️ Production deployment and validation (Component 4.4)

---

**Last Updated:** 2025-10-22
**Status:** Ready for setup
