#!/bin/bash

##
# Health Check Script for SyncKairos
# Tests all health endpoints and validates deployment
# Usage: ./check-health.sh [base-url]
##

set -e

BASE_URL="${1:-http://localhost:3000}"

echo "🏥 Checking SyncKairos Health Endpoints"
echo "Base URL: $BASE_URL"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Test 1: /health (Liveness)
echo "Test 1: Liveness Check (/health)"
echo "Purpose: Verifies the application process is running"
HEALTH_RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" "$BASE_URL/health" || echo "FAILED")

if echo "$HEALTH_RESPONSE" | grep -q "HTTP_CODE:200"; then
  echo "✅ /health endpoint responding"
  echo "$HEALTH_RESPONSE" | grep -v "HTTP_CODE" | jq . 2>/dev/null || echo "$HEALTH_RESPONSE" | grep -v "HTTP_CODE"
else
  echo "❌ /health endpoint failed"
  echo "$HEALTH_RESPONSE"
  exit 1
fi
echo ""

# Test 2: /ready (Readiness)
echo "Test 2: Readiness Check (/ready)"
echo "Purpose: Verifies Redis and PostgreSQL connectivity"
READY_RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" "$BASE_URL/ready" || echo "FAILED")

if echo "$READY_RESPONSE" | grep -q "HTTP_CODE:200"; then
  echo "✅ /ready endpoint responding"
  echo "$READY_RESPONSE" | grep -v "HTTP_CODE" | jq . 2>/dev/null || echo "$READY_RESPONSE" | grep -v "HTTP_CODE"
else
  echo "⚠️  /ready endpoint not ready"
  echo "$READY_RESPONSE" | grep -v "HTTP_CODE" | jq . 2>/dev/null || echo "$READY_RESPONSE" | grep -v "HTTP_CODE"
  echo ""
  echo "💡 Common causes:"
  echo "   - Redis not connected"
  echo "   - PostgreSQL credentials incorrect"
  echo "   - Database migrations not run"
  echo ""
fi
echo ""

# Test 3: /metrics (Prometheus)
echo "Test 3: Metrics Endpoint (/metrics)"
echo "Purpose: Provides Prometheus metrics"
METRICS_RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" "$BASE_URL/metrics" || echo "FAILED")

if echo "$METRICS_RESPONSE" | grep -q "HTTP_CODE:200"; then
  echo "✅ /metrics endpoint responding"
  METRIC_COUNT=$(echo "$METRICS_RESPONSE" | grep -v "HTTP_CODE" | grep -c "^synckairos_" || echo "0")
  echo "   Found $METRIC_COUNT SyncKairos metrics"
else
  echo "⚠️  /metrics endpoint not available"
fi
echo ""

# Test 4: WebSocket (if base URL is http/https)
if [[ "$BASE_URL" == http* ]]; then
  WS_URL=$(echo "$BASE_URL" | sed 's/^http/ws/')/ws
  echo "Test 4: WebSocket Endpoint"
  echo "WebSocket URL: $WS_URL"
  echo "(Manual test required - automated WebSocket testing needs wscat)"
  echo ""
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Final verdict
if echo "$HEALTH_RESPONSE" | grep -q "HTTP_CODE:200" && echo "$READY_RESPONSE" | grep -q "HTTP_CODE:200"; then
  echo "✅ All critical health checks passed!"
  echo "SyncKairos is healthy and ready to serve traffic"
  exit 0
elif echo "$HEALTH_RESPONSE" | grep -q "HTTP_CODE:200"; then
  echo "⚠️  Application is running but not ready"
  echo "Review the /ready endpoint error above"
  exit 1
else
  echo "❌ Application health check failed"
  exit 1
fi
