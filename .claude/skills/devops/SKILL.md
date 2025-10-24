---
name: devops
description: DevOps and infrastructure management skill for SyncKairos v2.0. Use this skill when managing infrastructure (Upstash Redis, Supabase PostgreSQL), deploying to environments (local, staging, production), troubleshooting deployment issues, setting up Docker Compose, managing Fly.io deployments, handling environment variables, or resolving database connection problems. Triggers on requests like "deploy to staging", "setup local environment", "fix database connection", "migrate infrastructure to new region", or "troubleshoot health checks".
---

# SyncKairos DevOps

Comprehensive DevOps workflow for SyncKairos v2.0, covering infrastructure setup, environment management, deployment, and troubleshooting.

## Overview

This skill provides automated workflows and troubleshooting guidance for managing SyncKairos across three environments:
- **Local:** Development with Docker Compose (Redis + PostgreSQL)
- **Staging:** Pre-production on Fly.io with managed services (Upstash + Supabase)
- **Production:** Live deployment on Fly.io with managed services (Upstash + Supabase)

Use this skill for infrastructure setup, deployment automation, environment configuration, connection troubleshooting, and operational tasks.

ℹ️ **Note**: SyncKairos uses **Zod schemas with OpenAPI metadata** ([src/api/schemas/session.ts](../../../src/api/schemas/session.ts)) as the single source of truth for API contracts. OpenAPI spec auto-generates from schemas and is served at `/api-docs` endpoint - no manual API docs needed. See [ARCHITECTURE.md](../../../docs/design/ARCHITECTURE.md#api-contract---single-source-of-truth).

## Workflow Decision Tree

Choose the appropriate workflow based on the task:

1. **Setting up infrastructure** → Infrastructure Setup Workflow
2. **Deploying application** → Deployment Workflow
3. **Troubleshooting issues** → Troubleshooting Workflow
4. **Managing environments** → Environment Management Workflow
5. **Testing health/connectivity** → Health Check Workflow

## Infrastructure Setup Workflow

### When to Use
When setting up Upstash Redis, Supabase PostgreSQL, or migrating infrastructure to a new region.

### Process

1. **Read infrastructure reference:**
   ```bash
   # Load detailed setup guide
   cat ~/.claude/skills/devops/references/infrastructure.md
   ```

2. **Create managed services:**
   - Upstash Redis: Choose region (Sydney for NZ), get REDIS_URL
   - Supabase PostgreSQL: Choose region (Sydney for NZ), get DATABASE_URL
   - **IMPORTANT:** URL-encode special characters in DATABASE_URL password (# → %23, & → %26)

3. **Test connections:**
   ```bash
   # Test Redis
   node ~/.claude/skills/devops/scripts/test-redis.js "rediss://default:***@***.upstash.io:6379"

   # Test PostgreSQL
   node ~/.claude/skills/devops/scripts/test-postgres.js "postgresql://postgres:***@***.supabase.co:5432/postgres"
   ```

4. **Update environment configuration:**
   - Add URLs to `.env.production`
   - Set Fly.io secrets (if deploying)
   - Ensure regional consistency (all services in Sydney for NZ)

5. **Run migrations:**
   ```bash
   DATABASE_URL="postgresql://postgres:***@***" node scripts/direct-migrate.js
   ```

### Key Points
- Always use Sydney region for New Zealand deployments (lowest latency ~30-50ms)
- URL-encode passwords before adding to DATABASE_URL
- Use `rediss://` (double s) for Upstash TLS connections
- Test connections before deploying

## Local Development Setup Workflow

### When to Use
When setting up local development environment with Docker Compose.

### Process

1. **Run automated setup script:**
   ```bash
   bash ~/.claude/skills/devops/scripts/setup-local-env.sh
   ```

   This script:
   - Removes old containers
   - Starts Redis (port 6379) and PostgreSQL (port 5433)
   - Waits for services to be ready
   - Runs database migrations
   - Verifies .env configuration

2. **Alternatively, manual setup:**
   ```bash
   # Start services
   docker compose up -d

   # Run migrations
   DATABASE_URL="postgresql://postgres:postgres@localhost:5433/synckairos?sslmode=disable" \
     node scripts/direct-migrate.js

   # Build and start application
   pnpm build
   pnpm start
   ```

3. **Validate setup:**
   ```bash
   bash ~/.claude/skills/devops/scripts/check-health.sh
   ```

### Common Issues

**PostgreSQL port 5432 conflict:**
- Docker Compose uses port 5433 externally to avoid conflict
- Update DATABASE_URL: `postgresql://postgres:postgres@localhost:5433/synckairos`

**Credential mismatch:**
- Docker Compose uses `postgres:postgres`
- Verify .env has matching credentials

**Container name conflict:**
```bash
docker rm -f synckairos-redis synckairos-postgres
docker compose up -d
```

## Deployment Workflow

### When to Use
When deploying to Fly.io staging or production environments.

### Process

1. **Validate environment configuration:**
   ```bash
   bash ~/.claude/skills/devops/scripts/validate-env.sh .env.production
   ```

2. **Ensure Fly.io secrets are set:**
   ```bash
   # View existing secrets
   flyctl secrets list --app synckairos-staging

   # Set required secrets
   flyctl secrets set \
     REDIS_URL="rediss://default:***@***.upstash.io:6379" \
     DATABASE_URL="postgresql://postgres:***@***.supabase.co:5432/postgres" \
     JWT_SECRET="***" \
     --app synckairos-staging
   ```

3. **Deploy application:**
   ```bash
   # Staging
   flyctl deploy --app synckairos-staging

   # Production
   flyctl deploy --app synckairos-production --config fly.production.toml
   ```

4. **Run migrations (if needed):**
   ```bash
   flyctl ssh console --app synckairos-staging
   node scripts/direct-migrate.js
   exit
   ```

5. **Validate deployment:**
   ```bash
   # Check health endpoints
   bash ~/.claude/skills/devops/scripts/check-health.sh https://synckairos-staging.fly.dev

   # Monitor logs
   flyctl logs --app synckairos-staging
   ```

### Deployment Checklist
- [ ] Secrets configured in Fly.io
- [ ] Infrastructure in correct region (Sydney for NZ)
- [ ] Migrations run successfully
- [ ] Health checks passing (/health and /ready)
- [ ] WebSocket connectivity tested
- [ ] Logs show no errors

## Troubleshooting Workflow

### When to Use
When encountering deployment issues, connection errors, health check failures, or unexpected behavior.

### Process

1. **Read troubleshooting guide:**
   ```bash
   cat ~/.claude/skills/devops/references/troubleshooting.md
   ```

2. **Identify the issue category:**
   - Database connection errors → Check credentials, URL encoding, SSL settings
   - Port conflicts → Use alternative ports (5433 for PostgreSQL)
   - Health check failures → Validate Redis/PostgreSQL connectivity
   - High latency → Verify regional configuration
   - Environment variable issues → Run validation script

3. **Use diagnostic scripts:**
   ```bash
   # Test Redis connection
   node ~/.claude/skills/devops/scripts/test-redis.js

   # Test PostgreSQL connection
   node ~/.claude/skills/devops/scripts/test-postgres.js

   # Check application health
   bash ~/.claude/skills/devops/scripts/check-health.sh [url]

   # Validate environment variables
   bash ~/.claude/skills/devops/scripts/validate-env.sh .env
   ```

4. **Common Quick Fixes:**

   **Password authentication failed:**
   ```bash
   # Check DATABASE_URL has URL-encoded password
   # Example: 4NC#&v3FQqhG&cd → 4NC%23%26v3FQqhG%26cd
   ```

   **SSL connection error (local):**
   ```bash
   # Add ?sslmode=disable to local DATABASE_URL
   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/synckairos?sslmode=disable
   ```

   **Port conflict:**
   ```bash
   # Use port 5433 for PostgreSQL
   # Update docker-compose.yml and DATABASE_URL
   ```

   **Container issues:**
   ```bash
   # Remove and restart containers
   docker rm -f synckairos-redis synckairos-postgres
   docker compose up -d
   ```

5. **Verify fix:**
   ```bash
   bash ~/.claude/skills/devops/scripts/check-health.sh
   ```

### Troubleshooting Decision Matrix

| Symptom | Most Likely Cause | First Action |
|---------|-------------------|--------------|
| `password authentication failed` | Wrong credentials or encoding | Check DATABASE_URL, URL-encode password |
| `SSL connection error` | SSL mismatch | Add `?sslmode=disable` (local) or enable SSL (remote) |
| `Connection refused` | Service not running | Check docker ps, restart containers |
| `Port already allocated` | Port conflict | Use alternative port (5433) |
| `/ready returns not_ready` | Redis/PostgreSQL issue | Run test scripts, check connections |
| High query latency (>100ms) | Wrong region | Verify all services in Sydney region |
| Environment not loading | Wrong .env file | Check NODE_ENV, verify .env file path |

## Environment Management Workflow

### When to Use
When managing multiple environments or switching between local/staging/production.

### Process

1. **Read environment reference:**
   ```bash
   cat ~/.claude/skills/devops/references/environments.md
   ```

2. **Understand environment differences:**
   - **Local:** Docker Compose, `postgres:postgres`, port 5433
   - **Staging:** Fly.io, Upstash Sydney, Supabase Sydney
   - **Production:** Fly.io, Upstash Sydney (paid), Supabase Sydney (paid)

3. **Use correct .env file:**
   ```bash
   .env              # Local development (default)
   .env.local        # Local development (explicit)
   .env.staging      # Staging (not committed)
   .env.production   # Production (not committed, never use locally!)
   ```

4. **Validate environment configuration:**
   ```bash
   # Check which environment is active
   echo $NODE_ENV

   # Validate .env file
   bash ~/.claude/skills/devops/scripts/validate-env.sh .env

   # Verify connections match environment
   curl http://localhost:3000/ready | jq .
   ```

5. **Environment-specific considerations:**

   **Local:**
   - Use simple secrets (not production secrets!)
   - PostgreSQL port 5433 (not 5432)
   - SSL disabled for PostgreSQL

   **Staging:**
   - Strong secrets (can be shared with team)
   - URL-encode passwords
   - All services in Sydney region

   **Production:**
   - Unique, rotated secrets
   - Restricted access
   - Paid tiers recommended for performance

## Health Check Workflow

### When to Use
When validating deployment, testing connectivity, or diagnosing application health.

### Process

1. **Run health check script:**
   ```bash
   # Local
   bash ~/.claude/skills/devops/scripts/check-health.sh

   # Staging
   bash ~/.claude/skills/devops/scripts/check-health.sh https://synckairos-staging.fly.dev

   # Production
   bash ~/.claude/skills/devops/scripts/check-health.sh https://synckairos-production.fly.dev
   ```

2. **Understand health endpoints:**

   - **`/health`** (Liveness):
     - Purpose: Verifies application process is running
     - Returns: `{"status": "ok"}`
     - Used by: Kubernetes/Fly.io liveness probes
     - 200 = healthy, anything else = unhealthy

   - **`/ready`** (Readiness):
     - Purpose: Verifies Redis and PostgreSQL connectivity
     - Returns: `{"status": "ready"}` or `{"status": "not_ready", "error": "..."}`
     - Used by: Kubernetes/Fly.io readiness probes
     - 200 = ready, 503 = not ready

   - **`/metrics`** (Prometheus):
     - Purpose: Exposes Prometheus metrics
     - Returns: Prometheus-formatted metrics
     - Used by: Monitoring systems

3. **Interpret results:**

   ```bash
   # ✅ All healthy
   /health → 200 {"status": "ok"}
   /ready → 200 {"status": "ready"}
   /metrics → 200 (metrics data)

   # ⚠️ Running but not ready (common during startup or DB issues)
   /health → 200 {"status": "ok"}
   /ready → 503 {"status": "not_ready", "error": "..."}

   # ❌ Application down
   /health → Connection refused or timeout
   ```

4. **Troubleshoot failures:**
   - `/health` fails → Application not running or wrong URL
   - `/ready` fails → Run test-redis.js and test-postgres.js
   - `/metrics` fails → Check Prometheus configuration

## Regional Migration Workflow

### When to Use
When migrating infrastructure from one region to another (e.g., US → Sydney for NZ).

### Process

1. **Prepare new infrastructure:**
   - Create Upstash Redis in new region (Sydney)
   - Create Supabase PostgreSQL in new region (Sydney)
   - Get new REDIS_URL and DATABASE_URL
   - URL-encode DATABASE_URL password

2. **Test new infrastructure:**
   ```bash
   node ~/.claude/skills/devops/scripts/test-redis.js "rediss://default:***@***.upstash.io:6379"
   node ~/.claude/skills/devops/scripts/test-postgres.js "postgresql://postgres:***@***.supabase.co:5432/postgres"
   ```

3. **Run migrations on new database:**
   ```bash
   DATABASE_URL="postgresql://postgres:***@***.supabase.co:5432/postgres" \
     node scripts/direct-migrate.js
   ```

4. **Update Fly.io configuration:**
   ```toml
   # fly.toml
   primary_region = 'syd'  # Changed from 'sjc' (US) to 'syd' (Sydney)
   ```

5. **Update Fly.io secrets:**
   ```bash
   flyctl secrets set \
     REDIS_URL="rediss://default:***@***.upstash.io:6379" \
     DATABASE_URL="postgresql://postgres:***@***.supabase.co:5432/postgres" \
     --app synckairos-staging
   ```

6. **Deploy and validate:**
   ```bash
   flyctl deploy --app synckairos-staging
   bash ~/.claude/skills/devops/scripts/check-health.sh https://synckairos-staging.fly.dev
   ```

7. **Verify latency improvement:**
   ```bash
   # Run test-postgres.js to check latency
   # Expected: US ~150-200ms → Sydney ~30-50ms (5x improvement)
   ```

8. **Delete old infrastructure** (after confirming new infrastructure works)

## Resources

This skill includes comprehensive resources for SyncKairos DevOps:

### scripts/

Executable scripts for automated testing and setup:

- **test-redis.js:** Test Redis connection with 7 comprehensive checks (connection, PING, SET/GET, server info, memory, eviction policy, latency)
- **test-postgres.js:** Test PostgreSQL connection with detailed diagnostics (connection, version, latency, tables, write test, connection pool)
- **check-health.sh:** Test all health endpoints (/health, /ready, /metrics) with detailed reporting
- **setup-local-env.sh:** One-command local environment setup (starts Docker Compose, runs migrations, validates configuration)
- **validate-env.sh:** Validate .env file completeness, format, and security (required variables, URL formats, secret strength)

Usage:
```bash
# Run from SyncKairos project root or standalone
node ~/.claude/skills/devops/scripts/test-redis.js [redis-url]
node ~/.claude/skills/devops/scripts/test-postgres.js [database-url]
bash ~/.claude/skills/devops/scripts/check-health.sh [base-url]
bash ~/.claude/skills/devops/scripts/setup-local-env.sh
bash ~/.claude/skills/devops/scripts/validate-env.sh [env-file]
```

### references/

Detailed documentation for infrastructure and troubleshooting:

- **infrastructure.md:** Complete Upstash Redis and Supabase PostgreSQL setup guide (account creation, regional selection, configuration, testing, Fly.io integration, cost summary)
- **troubleshooting.md:** Comprehensive troubleshooting guide with common issues and solutions (database connections, Docker issues, migrations, health checks, Fly.io deployment, performance, quick diagnostic commands)
- **environments.md:** Environment configuration matrix (local/staging/production comparison, infrastructure details, setup commands, security considerations, troubleshooting)

Load when needed:
```bash
cat ~/.claude/skills/devops/references/infrastructure.md
cat ~/.claude/skills/devops/references/troubleshooting.md
cat ~/.claude/skills/devops/references/environments.md
```

### assets/

Template files for environment and infrastructure setup:

- **.env.template:** Complete environment variable template with all required/optional variables, comments explaining each, and example values
- **docker-compose.template.yml:** Recommended Docker Compose configuration for local development (Redis, PostgreSQL, optional SyncKairos app container)

Usage:
```bash
# Copy template to create .env file
cp ~/.claude/skills/devops/assets/.env.template .env

# Copy template for docker-compose.yml
cp ~/.claude/skills/devops/assets/docker-compose.template.yml docker-compose.yml
```

## Best Practices

1. **Always validate before deploying:**
   ```bash
   bash ~/.claude/skills/devops/scripts/validate-env.sh .env.production
   ```

2. **Test connections individually:**
   ```bash
   node ~/.claude/skills/devops/scripts/test-redis.js
   node ~/.claude/skills/devops/scripts/test-postgres.js
   ```

3. **Use regional co-location:**
   - All services (Fly.io, Upstash, Supabase) in same region
   - Sydney for New Zealand deployments

4. **URL-encode passwords:**
   - Always encode special characters in DATABASE_URL
   - Common: # → %23, & → %26, @ → %40

5. **Monitor after deployment:**
   ```bash
   flyctl logs --app synckairos-staging
   bash ~/.claude/skills/devops/scripts/check-health.sh https://synckairos-staging.fly.dev
   ```

6. **Use environment-specific configuration:**
   - Never use production secrets locally
   - Use .env.local for local, .env.production for production
   - Keep secrets in Fly.io, not in code

7. **Validate health endpoints:**
   - Both /health (liveness) and /ready (readiness) must pass
   - 200 status code indicates success

8. **Local port management:**
   - Use port 5433 for PostgreSQL to avoid conflicts
   - Use port 6379 for Redis (standard)

## Quick Reference

```bash
# Local Setup
bash ~/.claude/skills/devops/scripts/setup-local-env.sh

# Test Connections
node ~/.claude/skills/devops/scripts/test-redis.js
node ~/.claude/skills/devops/scripts/test-postgres.js

# Health Checks
bash ~/.claude/skills/devops/scripts/check-health.sh [url]

# Validate Environment
bash ~/.claude/skills/devops/scripts/validate-env.sh .env

# Deploy to Fly.io
flyctl deploy --app synckairos-staging

# View Logs
flyctl logs --app synckairos-staging

# Troubleshoot
cat ~/.claude/skills/devops/references/troubleshooting.md
```
