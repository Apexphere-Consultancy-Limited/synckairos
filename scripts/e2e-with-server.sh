#!/bin/bash

##
# E2E Test Runner with Smart Server Management
# Checks if server is running, starts if needed, runs tests
##

set -e

# Function to check if server is running
check_server() {
  local response
  response=$(curl -s -w "%{http_code}" -o /dev/null --connect-timeout 2 --max-time 3 http://localhost:3000/health 2>/dev/null)
  [ "$response" = "200" ]
  return $?
}

echo "🧪 Preparing E2E Tests..."

# Check if server is already running
if check_server; then
  echo "✅ Server already running on port 3000"
  echo "   Reusing existing server instance"
  SERVER_WAS_RUNNING=true
else
  echo "🚀 Server not detected, starting server..."

  # Check if Docker is running
  if ! docker info &> /dev/null; then
    echo "❌ Docker is not running!"
    echo "Please start Docker Desktop and try again."
    exit 1
  fi

  # Start Docker services
  echo "📦 Starting Docker services..."
  if docker compose version &> /dev/null; then
    docker compose up -d redis postgres
  else
    docker-compose up -d redis postgres
  fi

  # Wait for services
  echo "⏳ Waiting for services..."
  sleep 3

  # Run migrations if needed
  if [ ! -f ".migrations-done" ]; then
    echo "🔄 Running migrations..."
    DATABASE_URL="postgresql://postgres:postgres@localhost:5433/synckairos?sslmode=disable" node scripts/direct-migrate.js
    touch .migrations-done
  fi

  # Start server in background
  echo "🚀 Starting server in background..."
  NODE_ENV=development tsx src/index.ts > /dev/null 2>&1 &
  SERVER_PID=$!

  # Wait for server to be ready
  echo "⏳ Waiting for server to be ready..."
  for i in {1..30}; do
    if check_server; then
      echo "✅ Server ready!"
      break
    fi
    if [ $i -eq 30 ]; then
      echo "❌ Server failed to start within 30 seconds"
      kill $SERVER_PID 2>/dev/null || true
      exit 1
    fi
    sleep 1
  done

  SERVER_WAS_RUNNING=false
fi

# Run the E2E tests with provided arguments
echo ""
echo "🧪 Running E2E tests..."
echo ""

# Pass all arguments to playwright
if E2E_ENV=local playwright test "$@"; then
  TEST_EXIT_CODE=0
else
  TEST_EXIT_CODE=$?
fi

# Cleanup: Kill server only if we started it
if [ "$SERVER_WAS_RUNNING" = false ]; then
  echo ""
  echo "🛑 Stopping server (started by this script)..."
  kill $SERVER_PID 2>/dev/null || true
  # Also kill by port in case PID changed
  lsof -ti:3000 | xargs kill -9 2>/dev/null || true
fi

exit $TEST_EXIT_CODE
