# Task 4.2: PaaS Deployment Configuration

**Phase:** 4 - Deployment
**Component:** PaaS Configuration (Fly.io/Railway)
**Priority:** ⭐ **CRITICAL PATH**
**Estimated Time:** 2 days (16 hours)
**Status:** ⚪ Pending
**Dependencies:** Task 4.1 (Docker Configuration) ✅ Complete

---

## Objective

Configure Platform-as-a-Service (PaaS) deployment with auto-scaling, environment variables, and one-command deployment script. Enable production-ready deployment to Fly.io or Railway with minimal manual intervention.

**Key Focus:** Automated deployment pipeline with auto-scaling and health monitoring.

---

## Success Criteria

- [ ] ✅ PaaS account created and configured (Fly.io or Railway)
- [ ] ✅ Configuration file created (`fly.toml` or `railway.toml`)
- [ ] ✅ Auto-scaling configured (min: 2, max: 10 instances)
- [ ] ✅ Environment variables set securely
- [ ] ✅ Deployment script working (`./scripts/deploy.sh`)
- [ ] ✅ Health checks configured
- [ ] ✅ One-command deployment validated
- [ ] ✅ Staging environment deployed successfully

---

## Day 1: PaaS Setup & Configuration (8 hours)

### Morning: Fly.io Setup (4 hours)

#### 1. Install Fly CLI (15 minutes)

**macOS:**
```bash
brew install flyctl
```

**Linux:**
```bash
curl -L https://fly.io/install.sh | sh
```

**Verify installation:**
```bash
flyctl version
```

#### 2. Create Account & Login (15 minutes)

```bash
# Login to Fly.io
flyctl auth login

# Verify login
flyctl auth whoami
```

**Create organization (optional):**
```bash
flyctl orgs create synckairos
```

#### 3. Initialize Application (30 minutes)

```bash
# Initialize without deploying
flyctl launch --no-deploy --name synckairos-staging

# This creates fly.toml
```

**Review and edit `fly.toml`:**
```toml
# Application name
app = "synckairos-staging"
primary_region = "sjc"  # San Jose (closest to you)

# Build configuration
[build]

# HTTP service configuration
[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = false
  auto_start_machines = true
  min_machines_running = 2
  processes = ["app"]

# Health checks
[[http_service.checks]]
  grace_period = "10s"
  interval = "30s"
  method = "GET"
  timeout = "5s"
  path = "/health"

# VM configuration
[[vm]]
  cpu_kind = "shared"
  cpus = 1
  memory_mb = 512

# Scaling configuration
[scaling]
  min_machines = 2
  max_machines = 10

# Metrics configuration
[[metrics]]
  port = 3000
  path = "/metrics"
```

#### 4. Configure Secrets (Environment Variables) (45 minutes)

**Required secrets:**
```bash
# Generate JWT secret
JWT_SECRET=$(openssl rand -base64 32)

# Set secrets (don't deploy yet - we need Redis/PostgreSQL first)
flyctl secrets set JWT_SECRET="$JWT_SECRET" --app synckairos-staging
flyctl secrets set NODE_ENV=production --app synckairos-staging
flyctl secrets set PORT=3000 --app synckairos-staging
flyctl secrets set LOG_LEVEL=info --app synckairos-staging

# Redis URL (will be set after Component 4.3)
# flyctl secrets set REDIS_URL="redis://..." --app synckairos-staging

# PostgreSQL URL (will be set after Component 4.3)
# flyctl secrets set DATABASE_URL="postgresql://..." --app synckairos-staging
```

**View secrets (values are hidden):**
```bash
flyctl secrets list --app synckairos-staging
```

#### 5. Configure Auto-Scaling (45 minutes)

**Edit `fly.toml` to add auto-scaling rules:**

```toml
# Add to fly.toml

# Auto-scaling based on metrics
[[auto_scaling]]
  # Scale up when CPU > 70%
  metric = "cpu"
  target = 70
  min_machines = 2
  max_machines = 10

[[auto_scaling]]
  # Scale up when memory > 80%
  metric = "memory"
  target = 80
  min_machines = 2
  max_machines = 10

[[auto_scaling]]
  # Scale up when HTTP request rate high
  metric = "requests_per_second"
  target = 100
  min_machines = 2
  max_machines = 10

# Regional scaling (optional - add more regions if needed)
[regions]
  primary = "sjc"  # San Jose
  # secondary = ["lax", "sea"]  # Los Angeles, Seattle
```

**Test configuration validation:**
```bash
flyctl config validate --app synckairos-staging
```

#### 6. Configure Logging & Monitoring (45 minutes)

**Enable log shipping:**
```bash
# Fly.io logs are automatically available
flyctl logs --app synckairos-staging
```

**Configure log retention:**
```toml
# Add to fly.toml
[logging]
  level = "info"
  format = "json"
```

**Set up log streaming (optional):**
```bash
# Stream logs to stdout
flyctl logs --app synckairos-staging -f
```

### Afternoon: Deployment Script (4 hours)

#### 7. Create Deployment Script (2 hours)

**File:** `scripts/deploy.sh`

```bash
#!/bin/bash
set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
APP_NAME="${1:-synckairos-staging}"
ENVIRONMENT="${2:-staging}"

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  SyncKairos Deployment Script${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "App: $APP_NAME"
echo "Environment: $ENVIRONMENT"
echo ""

# Function to print status
print_status() {
  echo -e "${GREEN}✓${NC} $1"
}

print_error() {
  echo -e "${RED}✗${NC} $1"
}

print_warning() {
  echo -e "${YELLOW}⚠${NC} $1"
}

# Check if flyctl is installed
if ! command -v flyctl &> /dev/null; then
  print_error "flyctl CLI not found. Please install: brew install flyctl"
  exit 1
fi
print_status "flyctl CLI found"

# Check if logged in
if ! flyctl auth whoami &> /dev/null; then
  print_error "Not logged in to Fly.io. Run: flyctl auth login"
  exit 1
fi
print_status "Authenticated with Fly.io"

# Validate fly.toml
echo ""
echo "Validating fly.toml configuration..."
if flyctl config validate --app "$APP_NAME"; then
  print_status "fly.toml is valid"
else
  print_error "fly.toml validation failed"
  exit 1
fi

# Build Docker image locally (optional - for testing)
echo ""
echo "Building Docker image locally..."
if docker build -t "$APP_NAME:latest" .; then
  print_status "Docker build successful"
else
  print_error "Docker build failed"
  exit 1
fi

# Run pre-deployment checks
echo ""
echo "Running pre-deployment checks..."

# Check if secrets are set
echo "Checking required secrets..."
REQUIRED_SECRETS=("JWT_SECRET" "NODE_ENV" "PORT")
MISSING_SECRETS=()

for secret in "${REQUIRED_SECRETS[@]}"; do
  if ! flyctl secrets list --app "$APP_NAME" | grep -q "$secret"; then
    MISSING_SECRETS+=("$secret")
  fi
done

if [ ${#MISSING_SECRETS[@]} -ne 0 ]; then
  print_error "Missing required secrets: ${MISSING_SECRETS[*]}"
  print_warning "Redis and PostgreSQL URLs will be set in Component 4.3"
  echo ""
  echo "Set missing secrets with:"
  echo "  flyctl secrets set SECRET_NAME=value --app $APP_NAME"
  exit 1
fi
print_status "Required secrets configured"

# Confirm deployment
echo ""
echo -e "${YELLOW}Ready to deploy to $ENVIRONMENT${NC}"
read -p "Continue with deployment? (y/N) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  print_warning "Deployment cancelled"
  exit 0
fi

# Deploy to Fly.io
echo ""
echo "Deploying to Fly.io..."
if flyctl deploy --app "$APP_NAME" --strategy rolling; then
  print_status "Deployment successful"
else
  print_error "Deployment failed"
  exit 1
fi

# Wait for health checks
echo ""
echo "Waiting for health checks..."
sleep 10

if flyctl status --app "$APP_NAME" | grep -q "running"; then
  print_status "Application is running"
else
  print_error "Application health check failed"
  flyctl logs --app "$APP_NAME"
  exit 1
fi

# Verify health endpoint
echo ""
echo "Verifying health endpoint..."
APP_URL=$(flyctl info --app "$APP_NAME" --json | jq -r '.Hostname')

if curl -f "https://$APP_URL/health" > /dev/null 2>&1; then
  print_status "Health endpoint responding"
else
  print_error "Health endpoint not responding"
  exit 1
fi

# Display deployment info
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Deployment Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Application URL: https://$APP_URL"
echo "WebSocket URL: wss://$APP_URL/ws"
echo "Metrics: https://$APP_URL/metrics"
echo ""
echo "Useful commands:"
echo "  flyctl logs --app $APP_NAME -f    # Stream logs"
echo "  flyctl status --app $APP_NAME      # Check status"
echo "  flyctl ssh console --app $APP_NAME # SSH into container"
echo "  flyctl scale count 3 --app $APP_NAME  # Scale to 3 instances"
echo ""
print_status "Deployment successful!"
```

**Make executable:**
```bash
chmod +x scripts/deploy.sh
```

#### 8. Test Deployment Script (Dry Run) (1 hour)

**Create test checklist:**
- [ ] Script validation passes
- [ ] Docker build succeeds
- [ ] Secrets check works
- [ ] Confirmation prompt works
- [ ] Error handling works

**Test without actual deployment:**
```bash
# Test up to confirmation prompt (don't deploy yet)
./scripts/deploy.sh synckairos-staging staging
```

**Verify:**
- ✅ All checks pass
- ✅ Missing REDIS_URL and DATABASE_URL warnings appear (expected)
- ✅ Script prompts for confirmation

#### 9. Create Rollback Script (1 hour)

**File:** `scripts/rollback.sh`

```bash
#!/bin/bash
set -e

APP_NAME="${1:-synckairos-staging}"

echo "Rolling back $APP_NAME to previous version..."

# Get previous version
PREVIOUS_VERSION=$(flyctl releases --app "$APP_NAME" --json | jq -r '.[1].Version')

echo "Previous version: v$PREVIOUS_VERSION"
read -p "Rollback to v$PREVIOUS_VERSION? (y/N) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Rollback cancelled"
  exit 0
fi

# Rollback
flyctl releases rollback --app "$APP_NAME" --version "$PREVIOUS_VERSION"

echo "Rollback complete. Verifying..."
sleep 10

flyctl status --app "$APP_NAME"
```

**Make executable:**
```bash
chmod +x scripts/rollback.sh
```

---

## Day 2: Alternative Setup & Documentation (8 hours)

### Morning: Railway Alternative (Optional) (4 hours)

**If Fly.io is not suitable, use Railway as alternative:**

#### 1. Install Railway CLI (15 minutes)

```bash
npm install -g @railway/cli
railway login
```

#### 2. Create Project (30 minutes)

```bash
railway init
railway up
```

#### 3. Configure railway.toml (1 hour)

```toml
[build]
builder = "DOCKERFILE"
dockerfilePath = "Dockerfile"

[deploy]
startCommand = "node dist/index.js"
healthcheckPath = "/health"
restartPolicyType = "ON_FAILURE"

[scaling]
minReplicas = 2
maxReplicas = 10
```

#### 4. Set Environment Variables (1 hour)

```bash
railway variables set JWT_SECRET="..."
railway variables set NODE_ENV=production
railway variables set REDIS_URL="..."  # Set in Component 4.3
railway variables set DATABASE_URL="..."  # Set in Component 4.3
```

### Afternoon: Documentation & Testing (4 hours)

#### 10. Create Deployment Documentation (2 hours)

**File:** `docs/deployment/DEPLOYMENT_GUIDE.md`

Create comprehensive deployment guide with:
- Prerequisites
- Step-by-step deployment
- Environment variables reference
- Troubleshooting guide
- Scaling guide
- Monitoring setup

#### 11. Create Environment Variable Template (30 minutes)

**File:** `.env.production.example`

```bash
# SyncKairos Production Environment Variables
# Copy to .env.production and fill in values

# Application
NODE_ENV=production
PORT=3000
LOG_LEVEL=info

# Security
JWT_SECRET=<generate-with-openssl-rand-base64-32>

# Redis (Primary State Store) - Set in Component 4.3
REDIS_URL=redis://<host>:<port>

# PostgreSQL (Audit Store) - Set in Component 4.3
DATABASE_URL=postgresql://<user>:<password>@<host>:<port>/<database>

# Optional: Monitoring
SENTRY_DSN=<sentry-dsn>
```

#### 12. Test Complete Workflow (1.5 hours)

**Checklist:**
- [ ] Create staging app
- [ ] Set environment variables (except Redis/PostgreSQL)
- [ ] Run deployment script
- [ ] Verify deployment fails gracefully (missing Redis/PostgreSQL - expected)
- [ ] Test rollback script
- [ ] Document any issues

**Test commands:**
```bash
# Test staging deployment workflow
./scripts/deploy.sh synckairos-staging staging

# Verify it fails at Redis/PostgreSQL check (expected)
# This is correct - we'll add those in Component 4.3
```

---

## Acceptance Checklist

### Configuration Complete
- [ ] Fly.io account created and authenticated
- [ ] `fly.toml` configured with auto-scaling
- [ ] Secrets configured (JWT_SECRET, NODE_ENV, PORT, LOG_LEVEL)
- [ ] Health checks configured
- [ ] Logging enabled

### Scripts Complete
- [ ] `scripts/deploy.sh` created and tested
- [ ] `scripts/rollback.sh` created and tested
- [ ] Both scripts executable
- [ ] Error handling validated
- [ ] Confirmation prompts working

### Documentation Complete
- [ ] DEPLOYMENT_GUIDE.md created
- [ ] .env.production.example created
- [ ] Deployment workflow documented
- [ ] Troubleshooting guide included

### Validation
- [ ] One-command deployment working (up to Redis/PostgreSQL check)
- [ ] Graceful failure when Redis/PostgreSQL missing (expected)
- [ ] Rollback script tested
- [ ] Auto-scaling configuration validated

---

## Files to Create

**Configuration:**
- `fly.toml` - Fly.io configuration
- `.env.production.example` - Environment variables template

**Scripts:**
- `scripts/deploy.sh` - One-command deployment
- `scripts/rollback.sh` - Rollback to previous version

**Documentation:**
- `docs/deployment/DEPLOYMENT_GUIDE.md` - Comprehensive deployment guide
- `docs/deployment/SCALING_GUIDE.md` - Auto-scaling documentation
- `docs/deployment/TROUBLESHOOTING.md` - Common issues and fixes

---

## Troubleshooting

### Common Issues

**Issue: "flyctl not found"**
```bash
brew install flyctl
```

**Issue: "Authentication failed"**
```bash
flyctl auth login
```

**Issue: "fly.toml validation failed"**
```bash
# Check for syntax errors
flyctl config validate
```

**Issue: "Deployment failed - health check timeout"**
- Check `/health` endpoint is responding
- Increase health check grace period in `fly.toml`
- Check logs: `flyctl logs --app synckairos-staging`

**Issue: "Auto-scaling not working"**
- Verify auto-scaling configuration in `fly.toml`
- Check metrics endpoint is accessible: `curl https://app.fly.dev/metrics`
- Ensure min_machines >= 2

---

## Notes

### Important Considerations

1. **Regions:** Start with one region (sjc), add more after validation
2. **Scaling:** Start with 2-10 instances, adjust based on load testing
3. **Secrets:** Never commit secrets to git
4. **Health Checks:** 10s grace period, 30s interval
5. **Rollback:** Always test rollback before production deployment

### Cost Estimates (Fly.io)

**Staging Environment:**
- 2 instances × $0.0000022/sec × 512MB = ~$5/month
- Bandwidth: ~$0.02/GB

**Production Environment:**
- 2-10 instances (auto-scaling) = ~$10-50/month
- Bandwidth: variable

**Total estimated:** $15-60/month for staging + production

### Next Steps

After Component 4.2 completion:
1. Move to Component 4.3 (Infrastructure Setup)
2. Set up managed Redis (Upstash or Redis Cloud)
3. Set up managed PostgreSQL (Supabase or Neon)
4. Update secrets with Redis/PostgreSQL URLs
5. Complete full deployment

---

**Last Updated:** 2025-10-22
**Status:** ⚪ Pending - Ready to start after Component 4.1
