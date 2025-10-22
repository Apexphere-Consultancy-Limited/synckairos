#!/bin/bash
set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
APP_NAME="${1:-synckairos-staging}"
ENVIRONMENT="${2:-staging}"

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  SyncKairos Deployment Script${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${BLUE}App:${NC} $APP_NAME"
echo -e "${BLUE}Environment:${NC} $ENVIRONMENT"
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

print_info() {
  echo -e "${BLUE}ℹ${NC} $1"
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
print_info "Validating fly.toml configuration..."
if flyctl config validate --app "$APP_NAME" 2>/dev/null; then
  print_status "fly.toml is valid"
else
  print_warning "fly.toml validation skipped (app may not exist yet)"
fi

# Build Docker image locally (optional - for testing)
echo ""
print_info "Building Docker image locally..."
if docker build -t "$APP_NAME:latest" . >/dev/null 2>&1; then
  print_status "Docker build successful"
else
  print_error "Docker build failed"
  exit 1
fi

# Run pre-deployment checks
echo ""
print_info "Running pre-deployment checks..."

# Check if secrets are set
echo ""
print_info "Checking required secrets..."
REQUIRED_SECRETS=("JWT_SECRET" "NODE_ENV" "PORT")
MISSING_SECRETS=()

# Check if app exists
if flyctl apps list 2>/dev/null | grep -q "$APP_NAME"; then
  for secret in "${REQUIRED_SECRETS[@]}"; do
    if ! flyctl secrets list --app "$APP_NAME" 2>/dev/null | grep -q "$secret"; then
      MISSING_SECRETS+=("$secret")
    fi
  done

  if [ ${#MISSING_SECRETS[@]} -ne 0 ]; then
    print_warning "Missing required secrets: ${MISSING_SECRETS[*]}"
    print_info "These will need to be set after app creation"
  else
    print_status "Required secrets configured"
  fi
else
  print_warning "App $APP_NAME does not exist yet - will be created during deployment"
fi

# Check for Redis and PostgreSQL URLs
echo ""
if flyctl secrets list --app "$APP_NAME" 2>/dev/null | grep -q "REDIS_URL"; then
  print_status "REDIS_URL configured"
else
  print_warning "REDIS_URL not set (will be added in Component 4.3)"
fi

if flyctl secrets list --app "$APP_NAME" 2>/dev/null | grep -q "DATABASE_URL"; then
  print_status "DATABASE_URL configured"
else
  print_warning "DATABASE_URL not set (will be added in Component 4.3)"
fi

# Confirm deployment
echo ""
echo -e "${YELLOW}═══════════════════════════════════════${NC}"
echo -e "${YELLOW}  Ready to deploy to $ENVIRONMENT${NC}"
echo -e "${YELLOW}═══════════════════════════════════════${NC}"
echo ""
read -p "Continue with deployment? (y/N) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  print_warning "Deployment cancelled"
  exit 0
fi

# Deploy to Fly.io
echo ""
print_info "Deploying to Fly.io..."
echo ""

if flyctl deploy --app "$APP_NAME" --strategy rolling --ha=false; then
  print_status "Deployment successful"
else
  print_error "Deployment failed"
  print_info "Check logs: flyctl logs --app $APP_NAME"
  exit 1
fi

# Wait for health checks
echo ""
print_info "Waiting for health checks..."
sleep 10

if flyctl status --app "$APP_NAME" 2>/dev/null | grep -q "started"; then
  print_status "Application is running"
else
  print_warning "Application may not be fully started yet"
fi

# Get app info
echo ""
print_info "Retrieving application info..."
APP_INFO=$(flyctl info --app "$APP_NAME" --json 2>/dev/null || echo '{}')
APP_HOSTNAME=$(echo "$APP_INFO" | grep -o '"Hostname":"[^"]*"' | cut -d'"' -f4 || echo "$APP_NAME.fly.dev")

# Verify health endpoint
echo ""
print_info "Verifying health endpoint..."
if curl -f "https://$APP_HOSTNAME/health" >/dev/null 2>&1; then
  print_status "Health endpoint responding"
else
  print_warning "Health endpoint not responding yet (may still be starting)"
fi

# Display deployment info
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Deployment Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${BLUE}Application URL:${NC} https://$APP_HOSTNAME"
echo -e "${BLUE}WebSocket URL:${NC} wss://$APP_HOSTNAME/ws"
echo -e "${BLUE}Metrics URL:${NC} https://$APP_HOSTNAME/metrics"
echo -e "${BLUE}Health Check:${NC} https://$APP_HOSTNAME/health"
echo ""
echo -e "${BLUE}Useful commands:${NC}"
echo "  flyctl logs --app $APP_NAME -f      # Stream logs"
echo "  flyctl status --app $APP_NAME        # Check status"
echo "  flyctl ssh console --app $APP_NAME   # SSH into container"
echo "  flyctl scale count 3 --app $APP_NAME # Scale to 3 instances"
echo ""
print_status "Deployment successful!"
