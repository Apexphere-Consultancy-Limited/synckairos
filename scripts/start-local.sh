#!/bin/bash

##
# Quick Local Development Startup Script
# Spins up SyncKairos local instance with one command
# Usage: ./dev
##

set -e

echo "🚀 Starting SyncKairos Local Development Environment"
echo ""

# Check if Docker is running
echo "🔍 Checking Docker..."
if ! docker info &> /dev/null; then
  echo "❌ Docker is not running!"
  echo ""
  echo "Please start Docker Desktop and try again."
  echo "You can check Docker status with: docker ps"
  exit 1
fi
echo "✅ Docker is running"
echo ""

# Kill any process using port 3000
if lsof -ti:3000 &> /dev/null; then
  echo "⚠️  Port 3000 is in use, clearing..."
  lsof -ti:3000 | xargs kill -9 2>/dev/null || true
  sleep 1
  echo "✅ Port 3000 cleared"
  echo ""
fi

# Step 1: Start Docker Compose services (detached)
echo "📦 Starting Docker services (Redis + PostgreSQL)..."
if docker compose version &> /dev/null; then
  docker compose up -d redis postgres
else
  docker-compose up -d redis postgres
fi

echo "⏳ Waiting for services to be ready..."
sleep 3

# Step 2: Check if services are healthy
echo "🔍 Checking service health..."
if docker exec synckairos-redis redis-cli ping > /dev/null 2>&1; then
  echo "✅ Redis is ready"
else
  echo "⚠️  Redis not ready, waiting..."
  sleep 2
fi

if docker exec synckairos-postgres pg_isready -U postgres > /dev/null 2>&1; then
  echo "✅ PostgreSQL is ready"
else
  echo "⚠️  PostgreSQL not ready, waiting..."
  sleep 3
fi

# Step 3: Run migrations if needed
if [ ! -f ".migrations-done" ]; then
  echo "🔄 Running database migrations..."
  DATABASE_URL="postgresql://postgres:postgres@localhost:5433/synckairos?sslmode=disable" node scripts/direct-migrate.js
  touch .migrations-done
  echo "✅ Migrations complete"
else
  echo "✅ Migrations already run (delete .migrations-done to re-run)"
fi

# Step 4: Build if needed (check if dist exists and is newer than src)
if [ ! -d "dist" ] || [ "$(find src -newer dist 2>/dev/null | wc -l)" -gt 0 ]; then
  echo "🔨 Building application..."
  pnpm build
  echo "✅ Build complete"
else
  echo "✅ Build up to date"
fi

# Step 5: Start the application
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎉 Starting SyncKairos..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📍 Application: http://localhost:3000"
echo "📍 Health:      http://localhost:3000/health"
echo "📍 Ready:       http://localhost:3000/ready"
echo "📍 Metrics:     http://localhost:3000/metrics"
echo "📍 WebSocket:   ws://localhost:3000/ws"
echo ""
echo "🛑 Press Ctrl+C to stop"
echo ""

NODE_ENV=development node dist/index.js
