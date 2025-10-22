#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

APP_NAME="${1:-synckairos-staging}"

echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}  SyncKairos Rollback Script${NC}"
echo -e "${YELLOW}========================================${NC}"
echo ""
echo -e "${BLUE}App:${NC} $APP_NAME"
echo ""

# Check if flyctl is installed
if ! command -v flyctl &> /dev/null; then
  echo -e "${RED}✗${NC} flyctl CLI not found"
  exit 1
fi

# Check if logged in
if ! flyctl auth whoami &> /dev/null; then
  echo -e "${RED}✗${NC} Not logged in to Fly.io"
  exit 1
fi

# Get release history
echo -e "${BLUE}ℹ${NC} Fetching release history..."
RELEASES=$(flyctl releases --app "$APP_NAME" --json 2>/dev/null)

if [ -z "$RELEASES" ] || [ "$RELEASES" = "[]" ]; then
  echo -e "${RED}✗${NC} No releases found for $APP_NAME"
  exit 1
fi

# Parse releases (get the current and previous)
CURRENT_VERSION=$(echo "$RELEASES" | grep -o '"Version":[0-9]*' | head -1 | cut -d':' -f2)
PREVIOUS_VERSION=$(echo "$RELEASES" | grep -o '"Version":[0-9]*' | head -2 | tail -1 | cut -d':' -f2)

if [ -z "$PREVIOUS_VERSION" ]; then
  echo -e "${RED}✗${NC} No previous version found to rollback to"
  exit 1
fi

echo ""
echo -e "${BLUE}Current version:${NC} v$CURRENT_VERSION"
echo -e "${BLUE}Previous version:${NC} v$PREVIOUS_VERSION"
echo ""
echo -e "${YELLOW}═══════════════════════════════════════${NC}"
echo -e "${YELLOW}  WARNING: Rollback Operation${NC}"
echo -e "${YELLOW}═══════════════════════════════════════${NC}"
echo ""
echo "This will rollback $APP_NAME from v$CURRENT_VERSION to v$PREVIOUS_VERSION"
echo ""
read -p "Are you sure? (y/N) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo -e "${YELLOW}⚠${NC} Rollback cancelled"
  exit 0
fi

# Perform rollback
echo ""
echo -e "${BLUE}ℹ${NC} Rolling back to v$PREVIOUS_VERSION..."

if flyctl releases rollback --app "$APP_NAME" --version "$PREVIOUS_VERSION" --yes; then
  echo -e "${GREEN}✓${NC} Rollback initiated"
else
  echo -e "${RED}✗${NC} Rollback failed"
  exit 1
fi

# Wait and verify
echo ""
echo -e "${BLUE}ℹ${NC} Waiting for rollback to complete..."
sleep 10

echo ""
echo -e "${BLUE}ℹ${NC} Checking application status..."
flyctl status --app "$APP_NAME"

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Rollback Complete${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${BLUE}Current version:${NC} v$PREVIOUS_VERSION"
echo ""
echo -e "${BLUE}Verify with:${NC}"
echo "  flyctl logs --app $APP_NAME -f"
echo "  curl https://$APP_NAME.fly.dev/health"
echo ""
echo -e "${GREEN}✓${NC} Rollback successful"
