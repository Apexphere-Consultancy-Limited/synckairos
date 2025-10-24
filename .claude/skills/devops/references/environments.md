# Environment Configuration Matrix

SyncKairos supports three environments: Local, Staging, and Production.

## Environment Overview

| Aspect | Local | Staging | Production |
|--------|-------|---------|------------|
| **Purpose** | Development & testing | Pre-production validation | Live production |
| **Infrastructure** | Docker Compose | Fly.io + Upstash + Supabase | Fly.io + Upstash + Supabase |
| **Redis** | Local container (6379) | Upstash (Sydney) | Upstash (Sydney) |
| **PostgreSQL** | Local container (5433) | Supabase (Sydney) | Supabase (Sydney) |
| **Scaling** | Single instance | 2-10 instances | 2-10+ instances |
| **Monitoring** | Logs only | Prometheus + logs | Prometheus + Grafana + alerts |
| **Cost** | $0 | $0 (free tiers) | $50-65/month |

## Local Environment

### Purpose
Development and testing on local machine.

### Infrastructure
- **Redis:** Docker container (port 6379)
- **PostgreSQL:** Docker container (port 5433)
- **Application:** Node.js process (port 3000)

### Configuration (.env or .env.local)
```bash
# Server
NODE_ENV=development
PORT=3000
LOG_LEVEL=debug

# Redis (Docker Compose)
REDIS_URL=redis://localhost:6379

# PostgreSQL (Docker Compose)
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/synckairos

# JWT Authentication
JWT_SECRET=local-dev-jwt-secret-not-for-production

# Database Pool
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=10
DATABASE_SSL=false

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
```

### Setup Commands
```bash
# Start infrastructure
bash ~/.claude/skills/devops/scripts/setup-local-env.sh

# Or manually:
docker compose up -d
node scripts/direct-migrate.js
pnpm build
pnpm start

# Validate
bash ~/.claude/skills/devops/scripts/check-health.sh
```

### When to Use
- Feature development
- Unit testing
- Integration testing
- Debugging issues
- Quick iterations

## Staging Environment

### Purpose
Pre-production validation and testing in production-like environment.

### Infrastructure
- **Fly.io:** synckairos-staging app (Sydney region)
- **Redis:** Upstash (Australia/Sydney)
- **PostgreSQL:** Supabase (Australia/Sydney)

### Configuration (.env.staging)
```bash
# Server
NODE_ENV=staging
PORT=3000
LOG_LEVEL=info

# Redis (Upstash Sydney)
REDIS_URL=rediss://default:***@***.upstash.io:6379

# PostgreSQL (Supabase Sydney - URL-encode password!)
DATABASE_URL=postgresql://postgres:***@***.supabase.co:5432/postgres

# JWT Authentication (strong secret)
JWT_SECRET=*** (32+ characters)

# Database Pool
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=20
DATABASE_SSL=true

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100

# Monitoring
PROMETHEUS_PORT=9090
```

### Fly.io Configuration (fly.toml)
```toml
app = 'synckairos-staging'
primary_region = 'syd'

[build]
  dockerfile = 'Dockerfile'

[env]
  NODE_ENV = 'staging'
  PORT = '3000'
  LOG_LEVEL = 'info'

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = 'stop'
  auto_start_machines = true
  min_machines_running = 0
  processes = ['app']

  [http_service.concurrency]
    type = 'requests'
    hard_limit = 250
    soft_limit = 200

[[http_service.checks]]
  grace_period = '10s'
  interval = '30s'
  method = 'GET'
  timeout = '5s'
  path = '/health'

[[http_service.checks]]
  grace_period = '15s'
  interval = '30s'
  method = 'GET'
  timeout = '5s'
  path = '/ready'

[[vm]]
  memory = '1gb'
  cpu_kind = 'shared'
  cpus = 1
```

### Setup Commands
```bash
# Configure secrets
flyctl secrets set \
  REDIS_URL="rediss://default:***@***.upstash.io:6379" \
  DATABASE_URL="postgresql://postgres:***@***.supabase.co:5432/postgres" \
  JWT_SECRET="***" \
  --app synckairos-staging

# Deploy
flyctl deploy --app synckairos-staging

# Run migrations
flyctl ssh console --app synckairos-staging
node scripts/direct-migrate.js
exit

# Validate
bash ~/.claude/skills/devops/scripts/check-health.sh https://synckairos-staging.fly.dev
```

### When to Use
- Final validation before production
- Load testing
- Integration testing with production-like data
- Stakeholder demos
- Breaking changes testing

## Production Environment

### Purpose
Live production serving real users.

### Infrastructure
- **Fly.io:** synckairos-production app (Sydney region)
- **Redis:** Upstash (Australia/Sydney, paid tier recommended)
- **PostgreSQL:** Supabase (Australia/Sydney, paid tier recommended)
- **Monitoring:** Grafana Cloud (optional)

### Configuration (.env.production)
```bash
# Server
NODE_ENV=production
PORT=3000
LOG_LEVEL=warn

# Redis (Upstash Sydney - paid tier for higher limits)
REDIS_URL=rediss://default:***@***.upstash.io:6379

# PostgreSQL (Supabase Sydney - paid tier for performance)
DATABASE_URL=postgresql://postgres:***@***.supabase.co:5432/postgres

# JWT Authentication (strong secret, rotate regularly)
JWT_SECRET=*** (64+ characters)

# Database Pool
DATABASE_POOL_MIN=5
DATABASE_POOL_MAX=50
DATABASE_SSL=true

# Rate Limiting (stricter)
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=60

# Monitoring
PROMETHEUS_PORT=9090
SENTRY_DSN=https://***@***.ingest.sentry.io/***

# Performance
WS_HEARTBEAT_INTERVAL=30000
SESSION_CLEANUP_INTERVAL=300000
```

### Fly.io Configuration (fly.production.toml)
```toml
app = 'synckairos-production'
primary_region = 'syd'

[build]
  dockerfile = 'Dockerfile'

[env]
  NODE_ENV = 'production'
  PORT = '3000'
  LOG_LEVEL = 'warn'

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = 'suspend'
  auto_start_machines = true
  min_machines_running = 2
  processes = ['app']

  [http_service.concurrency]
    type = 'requests'
    hard_limit = 500
    soft_limit = 400

[[http_service.checks]]
  grace_period = '10s'
  interval = '15s'
  method = 'GET'
  timeout = '3s'
  path = '/health'

[[http_service.checks]]
  grace_period = '15s'
  interval = '15s'
  method = 'GET'
  timeout = '5s'
  path = '/ready'

[[vm]]
  memory = '2gb'
  cpu_kind = 'shared'
  cpus = 2

[metrics]
  port = 9090
  path = "/metrics"
```

### Setup Commands
```bash
# Create production app
flyctl apps create synckairos-production

# Configure secrets
flyctl secrets set \
  REDIS_URL="rediss://default:***@***.upstash.io:6379" \
  DATABASE_URL="postgresql://postgres:***@***.supabase.co:5432/postgres" \
  JWT_SECRET="***" \
  SENTRY_DSN="https://***@***.ingest.sentry.io/***" \
  --app synckairos-production

# Deploy
flyctl deploy --app synckairos-production --config fly.production.toml

# Run migrations
flyctl ssh console --app synckairos-production
node scripts/direct-migrate.js
exit

# Validate
bash ~/.claude/skills/devops/scripts/check-health.sh https://synckairos-production.fly.dev

# Monitor for 1 hour
flyctl logs --app synckairos-production
```

### When to Use
- Live production traffic
- Real user sessions
- Mission-critical operations

## Environment Switching

### Switching Between Environments

1. **Local → Staging:**
   ```bash
   # Validate local changes
   pnpm test
   pnpm build

   # Deploy to staging
   flyctl deploy --app synckairos-staging

   # Validate staging
   bash ~/.claude/skills/devops/scripts/check-health.sh https://synckairos-staging.fly.dev
   ```

2. **Staging → Production:**
   ```bash
   # Final staging validation
   # Run load tests, integration tests

   # Deploy to production
   flyctl deploy --app synckairos-production --config fly.production.toml

   # Monitor closely for 1 hour
   flyctl logs --app synckairos-production
   ```

3. **Production → Local (for debugging):**
   ```bash
   # DO NOT copy production secrets to local!
   # Use sanitized/anonymized data

   # Export schema only (no data)
   flyctl ssh console --app synckairos-production
   pg_dump --schema-only > schema.sql
   exit

   # Import to local
   psql postgresql://postgres:postgres@localhost:5433/synckairos < schema.sql
   ```

## Security Considerations

### Secret Management

- **Local:** Use simple/default secrets (NOT production secrets!)
- **Staging:** Use strong secrets, can be shared with team
- **Production:** Use unique, rotated secrets, restrict access

### Access Control

| Environment | Who Has Access |
|-------------|----------------|
| **Local** | All developers |
| **Staging** | All developers + QA |
| **Production** | Senior developers + DevOps only |

### Data Handling

- **Local:** Use test/mock data only
- **Staging:** Use sanitized production data or realistic test data
- **Production:** Real user data - strict GDPR/privacy compliance

## Troubleshooting

### Wrong Environment Being Used

**Symptom:** Application behaves unexpectedly, wrong database.

**Solution:**
```bash
# Check NODE_ENV
echo $NODE_ENV
# or in code:
console.log('Environment:', process.env.NODE_ENV)

# Verify .env file
cat .env | head -n 5

# Check which databases are connected
curl http://localhost:3000/ready | jq .
```

### Environment Variables Not Loading

**Solution:**
```bash
# Validate .env file
bash ~/.claude/skills/devops/scripts/validate-env.sh .env

# Check dotenv is loading
node -e "require('dotenv').config(); console.log(process.env.NODE_ENV)"

# Restart application (environment is loaded at startup)
```

### Mixed Environment Configuration

**Symptom:** Some services in staging, others in production.

**Solution:**
Use environment-specific files:
```bash
.env.local       # Local development
.env.staging     # Staging (not committed)
.env.production  # Production (not committed, never local!)
```

Then load explicitly:
```bash
# Staging
NODE_ENV=staging node -r dotenv/config dist/index.js dotenv_config_path=.env.staging

# Production
NODE_ENV=production node -r dotenv/config dist/index.js dotenv_config_path=.env.production
```
