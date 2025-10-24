# TODO: Fix E2E Test Schema Issues

## Problem Summary

The E2E tests were created using hallucinated Zod schemas in `src/types/api-contracts.ts` which don't match the actual implementation. The actual schemas are in `src/api/schemas/session.ts` and require:

1. **UUID format** for session_id and participant_id
2. **participant_index** field (number) for each participant
3. **total_time_ms** at root level (not just per-participant)
4. **Response structure** is `{ data: SyncState }` not just `SyncState`

## Files to Fix

### Deleted (Already Done)
- ✅ `src/types/api-contracts.ts` - Hallucinated schemas
- ✅ `src/api/openapi.ts` - Generated from wrong schemas

### E2E Tests to Update (8 files)
All these need UUID format and removal of Zod schema imports:

1. ✅ `tests/e2e/health.e2e.test.ts` - Fixed (simple case)
2. ⏳ `tests/e2e/session-lifecycle.e2e.test.ts`
3. ⏳ `tests/e2e/multi-client-websocket.e2e.test.ts`
4. ⏳ `tests/e2e/pause-resume.e2e.test.ts`
5. ⏳ `tests/e2e/delete-session.e2e.test.ts`
6. ⏳ `tests/e2e/edge-cases.e2e.test.ts`
7. ⏳ `tests/e2e/error-handling.e2e.test.ts`
8. ⏳ `tests/e2e/rate-limiting.e2e.test.ts`

### Contract Tests to Remove
- ⏳ `tests/contract/websocket-schemas.test.ts` - Testing non-existent Zod schemas

## Required Changes Per Test

### 1. Remove Zod Schema Imports

**Before:**
```typescript
import { SessionResponseSchema } from '../../src/types/api-contracts'
```

**After:**
```typescript
// No imports needed - use plain JSON assertions
```

### 2. Use UUID Format

**Before:**
```typescript
const sessionId = `e2e-lifecycle-${Date.now()}`
const participants = [
  { participant_id: 'p1', total_time_ms: 300000 },
  { participant_id: 'p2', total_time_ms: 300000 }
]
```

**After:**
```typescript
import { randomUUID } from 'crypto'

const sessionId = randomUUID()
const participants = [
  { participant_id: randomUUID(), participant_index: 0, total_time_ms: 300000 },
  { participant_id: randomUUID(), participant_index: 1, total_time_ms: 300000 }
]
```

### 3. Add Required Fields

**Before:**
```typescript
{
  session_id: sessionId,
  sync_mode: 'per_participant',
  participants: [...]
}
```

**After:**
```typescript
{
  session_id: sessionId,
  sync_mode: 'per_participant',
  participants: [...],
  total_time_ms: 600000  // Required at root level
}
```

### 4. Update Response Assertions

**Before:**
```typescript
const sessionData = await createRes.json()
const result = SessionResponseSchema.safeParse(sessionData)
expect(result.success).toBe(true)
const session = result.data!
expect(session.status).toBe('pending')
```

**After:**
```typescript
const response = await createRes.json()
expect(response).toHaveProperty('data')
expect(response.data.status).toBe('pending')
expect(response.data.session_id).toBe(sessionId)
```

### 5. WebSocket Tests - Use TypeScript Interfaces

**Before:**
```typescript
import { ServerMessageSchema } from '../../src/types/api-contracts'
const result = ServerMessageSchema.safeParse(raw)
```

**After:**
```typescript
import { ServerMessage } from '../../src/types/websocket'
const message = JSON.parse(data.toString()) as ServerMessage
if (message.type === 'STATE_UPDATE') {
  // Type-safe access
}
```

## Implementation Plan

1. Create UUID helper: `tests/e2e/helpers/uuid.ts` ✅
2. Update each test file with:
   - Remove Zod imports
   - Use `randomUUID()` for IDs
   - Add `participant_index` to participants
   - Add `total_time_ms` to root
   - Update assertions to check `{ data: ... }` structure
3. Delete `tests/contract/websocket-schemas.test.ts`
4. Run tests and verify they pass

## Example Complete Fix

See `tests/e2e/health.e2e.test.ts` for a simple example of the corrected pattern.

## OpenAPI Generation (Future)

For proper OpenAPI documentation generation, we need to:
1. Add OpenAPI metadata to actual schemas in `src/api/schemas/session.ts`
2. Create new OpenAPI generator using `@asteasolutions/zod-to-openapi`
3. Register routes with OpenAPI-enhanced schemas
4. Serve Swagger UI at `/api-docs`

This is separate from E2E testing and should be done after tests are fixed.
