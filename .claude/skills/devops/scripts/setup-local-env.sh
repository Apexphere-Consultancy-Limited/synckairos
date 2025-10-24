#!/bin/bash

##
# Local Environment Setup Script for SyncKairos
# Starts Docker Compose services and runs migrations
# Usage: ./setup-local-env.sh
##

set -e

echo "🚀 Setting up SyncKairos Local Environment"
echo ""

# Check prerequisites
echo "Checking prerequisites..."
if ! command -v docker &> /dev/null; then
  echo "❌ Docker not found. Please install Docker first."
  exit 1
fi

if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
  echo "❌ Docker Compose not found. Please install Docker Compose first."
  exit 1
fi

if [ ! -f "docker-compose.yml" ]; then
  echo "❌ docker-compose.yml not found. Run this from the project root."
  exit 1
fi

echo "✅ Prerequisites met"
echo ""

# Step 1: Stop and remove old containers
echo "Step 1: Cleaning up old containers..."
docker rm -f synckairos-redis synckairos-postgres 2>/dev/null || true
echo "✅ Old containers removed"
echo ""

# Step 2: Start Docker Compose services
echo "Step 2: Starting Docker Compose services..."
if docker compose version &> /dev/null; then
  docker compose up -d
else
  docker-compose up -d
fi
echo "✅ Services started"
echo ""

# Step 3: Wait for services to be ready
echo "Step 3: Waiting for services to be ready..."
sleep 5

# Check Redis
echo "Checking Redis..."
if docker exec synckairos-redis redis-cli ping &> /dev/null; then
  echo "✅ Redis is ready"
else
  echo "⚠️  Redis not responding yet, waiting..."
  sleep 3
  if docker exec synckairos-redis redis-cli ping &> /dev/null; then
    echo "✅ Redis is ready"
  else
    echo "❌ Redis failed to start"
    exit 1
  fi
fi

# Check PostgreSQL
echo "Checking PostgreSQL..."
if docker exec synckairos-postgres pg_isready -U postgres &> /dev/null; then
  echo "✅ PostgreSQL is ready"
else
  echo "⚠️  PostgreSQL not responding yet, waiting..."
  sleep 5
  if docker exec synckairos-postgres pg_isready -U postgres &> /dev/null; then
    echo "✅ PostgreSQL is ready"
  else
    echo "❌ PostgreSQL failed to start"
    exit 1
  fi
fi
echo ""

# Step 4: Run migrations
echo "Step 4: Running database migrations..."
if [ -f "scripts/direct-migrate.js" ]; then
  DATABASE_URL="postgresql://postgres:postgres@localhost:5433/synckairos?sslmode=disable" node scripts/direct-migrate.js
  echo "✅ Migrations completed"
else
  echo "⚠️  Migration script not found at scripts/direct-migrate.js"
  echo "   You may need to run migrations manually"
fi
echo ""

# Step 5: Verify .env file
echo "Step 5: Verifying environment configuration..."
if [ -f ".env" ]; then
  if grep -q "DATABASE_URL=postgresql://postgres:postgres@localhost:5433" .env; then
    echo "✅ .env configured for local development"
  else
    echo "⚠️  .env may need updating for local development"
    echo "   Expected: DATABASE_URL=postgresql://postgres:postgres@localhost:5433/synckairos"
  fi
else
  echo "⚠️  .env file not found"
  echo "   Copy .env.local or .env.template to .env"
fi
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Local environment setup complete!"
echo ""
echo "Services running:"
echo "  - Redis:      localhost:6379"
echo "  - PostgreSQL: localhost:5433"
echo ""
echo "Next steps:"
echo "  1. Build the application: pnpm build"
echo "  2. Start the server:      pnpm start"
echo "  3. Check health:          ./scripts/check-health.sh"
echo ""
echo "To stop services:"
if docker compose version &> /dev/null; then
  echo "  docker compose down"
else
  echo "  docker-compose down"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
