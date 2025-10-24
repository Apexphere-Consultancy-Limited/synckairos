# Infrastructure Setup Reference

Complete guide for setting up SyncKairos managed infrastructure (Upstash Redis + Supabase PostgreSQL).

## 1. Upstash Redis Setup

### Step 1: Create Account
1. Visit https://upstash.com/
2. Sign up with GitHub or email
3. Verify email if needed

### Step 2: Create Redis Database
1. Click "Create Database"
2. Configure:
   - **Name:** `synckairos-[environment]` (e.g., `synckairos-staging`)
   - **Type:** Regional (lower latency)
   - **Region:** Australia (Sydney) or Asia-Pacific (Singapore) for New Zealand
   - **Plan:** Free (10k commands/day, 256MB)
   - **TLS:** Enabled (required)
   - **Eviction:** Enabled (recommended)
3. Click "Create"

### Step 3: Get Connection URL
1. On database details page, find "REST API" or "Connection" section
2. Copy REDIS_URL format: `rediss://default:***@***.upstash.io:6379`
3. Keep URL secure

### Free Tier Features
- 10,000 commands/day
- 256 MB storage
- TLS encryption
- Global replication (optional)
- 99.99% SLA
- Redis 7.x compatible

## 2. Supabase PostgreSQL Setup

### Step 1: Create Account
1. Visit https://supabase.com/
2. Sign in with GitHub or email
3. Complete onboarding

### Step 2: Create Project
1. Click "New Project"
2. Configure:
   - **Organization:** Create new or use existing
   - **Name:** `synckairos-[environment]`
   - **Database Password:** Generate strong password (save securely!)
   - **Region:** Australia (Sydney) or Asia Pacific (Singapore) - match Fly.io and Upstash
   - **Plan:** Free (500MB database, 2GB bandwidth/month)
3. Click "Create new project"
4. Wait 2-3 minutes for provisioning

### Step 3: Get Connection URL
1. In project dashboard: "Project Settings" (gear icon)
2. Navigate to "Database" in left sidebar
3. Scroll to "Connection string" section
4. Select "URI" tab
5. Copy connection string: `postgresql://postgres:[YOUR-PASSWORD]@***.supabase.co:5432/postgres`
6. Replace `[YOUR-PASSWORD]` with your actual password
7. **IMPORTANT:** URL-encode special characters in password:
   - `#` → `%23`
   - `&` → `%26`
   - `@` → `%40`
   - `=` → `%3D`

### Step 4: Run Migrations
```bash
# Set environment variable
export DATABASE_URL="postgresql://postgres:***@***.supabase.co:5432/postgres"

# Run migrations using direct-migrate script
node scripts/direct-migrate.js
```

### Free Tier Features
- 500 MB database storage
- 2 GB bandwidth/month
- Up to 10,000 rows in real-time tables
- 50 MB file storage
- SSL connections
- Automatic backups (7 days)
- PostgreSQL 17.6

## 3. Environment Configuration

### Create `.env.production`
```bash
# Node environment
NODE_ENV=production
PORT=3000
LOG_LEVEL=info

# Authentication
JWT_SECRET=gslCblK3Bu94NiOZlIPhdTdBxYZOsnDx6J3lzKSancA=

# Upstash Redis
REDIS_URL=rediss://default:***@***.upstash.io:6379

# Supabase PostgreSQL (with URL-encoded password)
DATABASE_URL=postgresql://postgres:***@***.supabase.co:5432/postgres
```

### Add to `.gitignore`
```bash
echo ".env.production" >> .gitignore
```

## 4. Testing Infrastructure

### Test Redis Connection
```bash
node ~/.claude/skills/devops/scripts/test-redis.js
```

### Test PostgreSQL Connection
```bash
node ~/.claude/skills/devops/scripts/test-postgres.js
```

## 5. Configure Fly.io Secrets

### Add Infrastructure URLs to Fly.io
```bash
# Set Redis URL
flyctl secrets set REDIS_URL="rediss://default:***@***.upstash.io:6379" --app synckairos-staging

# Set PostgreSQL URL (ensure password is URL-encoded!)
flyctl secrets set DATABASE_URL="postgresql://postgres:***@***.supabase.co:5432/postgres" --app synckairos-staging
```

### Verify Secrets
```bash
flyctl secrets list --app synckairos-staging
```

## Regional Recommendations

For **New Zealand** deployments:
1. **Primary:** Australia (Sydney)
   - Lowest latency (~30-50ms)
   - Best performance for NZ users
2. **Secondary:** Asia Pacific (Singapore)
   - Backup option if Sydney unavailable
   - Slightly higher latency (~100-120ms)

Ensure all services (Fly.io, Upstash, Supabase) are in the same region for optimal performance.

## Cost Summary

| Service | Free Tier | Production Tier |
|---------|-----------|-----------------|
| **Upstash Redis** | $0 (10k cmds/day) | $10/month (1M cmds/day) |
| **Supabase PostgreSQL** | $0 (500MB) | $25/month (8GB) |
| **Fly.io** | $0 (3 machines stopped) | $15-30/month (2-10 instances) |
| **Total** | **$0/month** | **$50-65/month** |

## Security Checklist

- [ ] `.env.production` added to `.gitignore`
- [ ] Strong passwords generated (min 32 characters)
- [ ] TLS/SSL enabled for all connections
- [ ] Secrets stored in Fly.io (not in code)
- [ ] Connection strings never logged
- [ ] Database backups enabled (Supabase automatic)
- [ ] Special characters in passwords URL-encoded
