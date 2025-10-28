#!/bin/bash
# Script to add unique Redis prefixes to integration tests

# List of files to fix
files=(
  "tests/integration/api-concurrency.test.ts"
  "tests/integration/api-edge-cases.test.ts"
  "tests/integration/api-full-stack.test.ts"
  "tests/integration/api-multi-instance.test.ts"
  "tests/integration/api-performance.test.ts"
  "tests/integration/api-rate-limiting.test.ts"
  "tests/integration/api-response-format.test.ts"
  "tests/integration/api.test.ts"
  "tests/integration/websocket.test.ts"
  "tests/integration/multi-instance.test.ts"
)

for file in "${files[@]}"; do
  echo "Processing $file..."

  # Add unique prefix in beforeAll/beforeEach for single instance pattern
  # Pattern: stateManager = new RedisStateManager(redis, pubSub, dbQueue)
  sed -i.bak 's/stateManager = new RedisStateManager(redis, pubSub, dbQueue)/const uniquePrefix = `integration-test:${Date.now()}-${Math.random()}:`\n    stateManager = new RedisStateManager(redis, pubSub, dbQueue, uniquePrefix)/g' "$file"

  # Pattern: stateManager = new RedisStateManager(redis, pubSub)
  sed -i.bak2 's/stateManager = new RedisStateManager(redis, pubSub)$/const uniquePrefix = `integration-test:${Date.now()}-${Math.random()}:`\n    stateManager = new RedisStateManager(redis, pubSub, undefined, uniquePrefix)/g' "$file"

  # Clean up backup files
  rm -f "$file.bak" "$file.bak2"
done

echo "Done! Please review the changes."
