#!/bin/bash

##
# Environment Variable Validation Script
# Validates .env file completeness and format
# Usage: ./validate-env.sh [env-file]
##

ENV_FILE="${1:-.env}"

if [ ! -f "$ENV_FILE" ]; then
  echo "❌ File not found: $ENV_FILE"
  exit 1
fi

echo "🔍 Validating Environment Configuration"
echo "File: $ENV_FILE"
echo ""

# Required variables
REQUIRED_VARS=(
  "NODE_ENV"
  "PORT"
  "REDIS_URL"
  "DATABASE_URL"
  "JWT_SECRET"
  "LOG_LEVEL"
)

# Optional but recommended variables
RECOMMENDED_VARS=(
  "REDIS_PASSWORD"
  "DATABASE_POOL_MIN"
  "DATABASE_POOL_MAX"
  "RATE_LIMIT_WINDOW_MS"
  "RATE_LIMIT_MAX_REQUESTS"
)

ERRORS=0
WARNINGS=0

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "REQUIRED VARIABLES"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

for VAR in "${REQUIRED_VARS[@]}"; do
  if grep -q "^${VAR}=" "$ENV_FILE"; then
    VALUE=$(grep "^${VAR}=" "$ENV_FILE" | cut -d'=' -f2-)
    if [ -z "$VALUE" ]; then
      echo "⚠️  $VAR - defined but empty"
      ((WARNINGS++))
    else
      # Mask sensitive values
      if [[ "$VAR" == *"SECRET"* ]] || [[ "$VAR" == *"PASSWORD"* ]] || [[ "$VAR" == *"URL"* ]]; then
        echo "✅ $VAR - set (masked)"
      else
        echo "✅ $VAR - $VALUE"
      fi
    fi
  else
    echo "❌ $VAR - MISSING"
    ((ERRORS++))
  fi
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "RECOMMENDED VARIABLES"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

for VAR in "${RECOMMENDED_VARS[@]}"; do
  if grep -q "^${VAR}=" "$ENV_FILE"; then
    VALUE=$(grep "^${VAR}=" "$ENV_FILE" | cut -d'=' -f2-)
    if [ -z "$VALUE" ]; then
      echo "ℹ️  $VAR - defined but empty"
    else
      if [[ "$VAR" == *"SECRET"* ]] || [[ "$VAR" == *"PASSWORD"* ]]; then
        echo "✅ $VAR - set (masked)"
      else
        echo "✅ $VAR - $VALUE"
      fi
    fi
  else
    echo "⚠️  $VAR - not set (using defaults)"
  fi
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "VALIDATION CHECKS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check Redis URL format
if grep -q "^REDIS_URL=" "$ENV_FILE"; then
  REDIS_URL=$(grep "^REDIS_URL=" "$ENV_FILE" | cut -d'=' -f2-)
  if [[ "$REDIS_URL" =~ ^redis:// ]] || [[ "$REDIS_URL" =~ ^rediss:// ]]; then
    echo "✅ REDIS_URL format valid"
  else
    echo "❌ REDIS_URL format invalid (should start with redis:// or rediss://)"
    ((ERRORS++))
  fi
fi

# Check DATABASE_URL format
if grep -q "^DATABASE_URL=" "$ENV_FILE"; then
  DATABASE_URL=$(grep "^DATABASE_URL=" "$ENV_FILE" | cut -d'=' -f2-)
  if [[ "$DATABASE_URL" =~ ^postgres:// ]] || [[ "$DATABASE_URL" =~ ^postgresql:// ]]; then
    echo "✅ DATABASE_URL format valid"

    # Check for special characters that need encoding
    if [[ "$DATABASE_URL" =~ [:#&@] ]]; then
      if [[ "$DATABASE_URL" =~ %23 ]] || [[ "$DATABASE_URL" =~ %26 ]]; then
        echo "✅ DATABASE_URL appears to have URL-encoded special characters"
      else
        echo "⚠️  DATABASE_URL may contain unencoded special characters"
        echo "   Tip: # → %23, & → %26"
        ((WARNINGS++))
      fi
    fi
  else
    echo "❌ DATABASE_URL format invalid (should start with postgresql://)"
    ((ERRORS++))
  fi
fi

# Check NODE_ENV value
if grep -q "^NODE_ENV=" "$ENV_FILE"; then
  NODE_ENV=$(grep "^NODE_ENV=" "$ENV_FILE" | cut -d'=' -f2-)
  if [[ "$NODE_ENV" == "development" ]] || [[ "$NODE_ENV" == "staging" ]] || [[ "$NODE_ENV" == "production" ]]; then
    echo "✅ NODE_ENV value valid: $NODE_ENV"
  else
    echo "⚠️  NODE_ENV value unusual: $NODE_ENV (expected: development, staging, or production)"
    ((WARNINGS++))
  fi
fi

# Check JWT_SECRET strength
if grep -q "^JWT_SECRET=" "$ENV_FILE"; then
  JWT_SECRET=$(grep "^JWT_SECRET=" "$ENV_FILE" | cut -d'=' -f2-)
  if [ ${#JWT_SECRET} -lt 32 ]; then
    echo "⚠️  JWT_SECRET is short (${#JWT_SECRET} chars). Recommended: 32+ characters"
    ((WARNINGS++))
  else
    echo "✅ JWT_SECRET length adequate"
  fi

  if [[ "$JWT_SECRET" == "your-secret-key-here" ]] || [[ "$JWT_SECRET" == "changeme" ]]; then
    echo "❌ JWT_SECRET is using default/placeholder value - SECURITY RISK"
    ((ERRORS++))
  fi
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "VALIDATION SUMMARY"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
  echo "✅ Environment configuration is valid!"
  exit 0
elif [ $ERRORS -eq 0 ]; then
  echo "⚠️  Environment configuration has $WARNINGS warning(s)"
  echo "   Review warnings above and fix if needed"
  exit 0
else
  echo "❌ Environment configuration has $ERRORS error(s) and $WARNINGS warning(s)"
  echo "   Fix errors before proceeding"
  exit 1
fi
