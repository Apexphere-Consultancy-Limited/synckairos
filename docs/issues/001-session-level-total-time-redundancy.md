# Issue #001: Session-level total_time_ms Redundancy in per_participant Mode

**Status:** Open
**Priority:** High
**Component:** API Schema Validation
**Reported:** 2025-10-31
**Affects:** v2.0.0

## Summary

The `CreateSessionSchema` requires both participant-level AND session-level `total_time_ms` fields, which is redundant and confusing for `per_participant` sync mode. This causes validation errors when clients only provide participant-level time allocations.

## Issue Details

### Current Behavior

When creating a session with `sync_mode: "per_participant"`, the API requires:

```json
{
  "session_id": "123e4567-e89b-12d3-a456-426614174000",
  "sync_mode": "per_participant",
  "participants": [
    {
      "participant_id": "223e4567-e89b-12d3-a456-426614174001",
      "participant_index": 0,
      "total_time_ms": 600000  // ✅ Participant-level time
    }
  ],
  "total_time_ms": 600000  // ❌ Session-level time (currently required!)
}
```

### Error Reproduced

```bash
curl -X POST http://localhost:3000/v1/sessions \
  -H 'Content-Type: application/json' \
  -d '{
    "session_id": "223e4567-e89b-12d3-a456-426614174000",
    "sync_mode": "per_participant",
    "participants": [{
      "participant_id": "323e4567-e89b-12d3-a456-426614174001",
      "participant_index": 0,
      "total_time_ms": 600000
    }]
  }'

# Response:
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [{
      "field": "total_time_ms",
      "message": "Invalid input: expected number, received undefined",
      "code": "invalid_type"
    }]
  }
}
```

### Expected Behavior

For `per_participant` mode, the session-level `total_time_ms` should be:
1. **Optional** (clients can omit it), OR
2. **Auto-calculated** from participant time allocations, OR
3. **Removed entirely** for this mode

## Client Impact

**High** - Clients are experiencing validation errors and confusion:
- Error message doesn't clearly explain that BOTH fields are needed
- Unclear semantic meaning: what does session-level total represent when each participant has their own time bank?
- API documentation doesn't clearly show this requirement

## Root Cause

Schema definition in `src/api/schemas/session.ts`:

```typescript
// Line 25-33: Participant-level total_time_ms (inside ParticipantSchema)
export const ParticipantSchema = z.object({
  // ...
  total_time_ms: z.number()
    .int('Total time must be an integer')
    .min(1000, 'Total time must be at least 1000ms (1 second)')
    .max(86400000, 'Total time cannot exceed 86400000ms (24 hours)')
  // ...
})

// Line 84-92: Session-level total_time_ms (inside CreateSessionSchema)
export const CreateSessionSchema = z.object({
  // ...
  total_time_ms: z.number()  // ❌ NOT marked as .optional()
    .int('Total time must be an integer')
    .min(1000, 'Total time must be at least 1000ms (1 second)')
    .max(86400000, 'Total time cannot exceed 86400000ms (24 hours)')
  // ...
})
```

## Schema Analysis by Sync Mode

| Sync Mode | Participant `total_time_ms` | Session `total_time_ms` | Semantics |
|-----------|----------------------------|------------------------|-----------|
| `per_participant` | ✅ Required | ❓ Redundant? | Each participant has own time bank |
| `per_cycle` | ✅ Required | ❓ Unclear | Fixed time per cycle |
| `per_group` | ✅ Required | ❓ Unclear | Groups share time |
| `global` | ❌ Likely ignored | ✅ Required | One shared time pool |
| `count_up` | ❌ Likely ignored | ❌ Uses `max_time_ms` | Counts up to max |

## Proposed Solutions

### Option 1: Make Session-level Optional (Quick Fix)
```typescript
total_time_ms: z.number()
  .int('Total time must be an integer')
  .min(1000, 'Total time must be at least 1000ms (1 second)')
  .max(86400000, 'Total time cannot exceed 86400000ms (24 hours)')
  .optional()  // ✅ Add this
  .openapi({
    description: 'Total time for the session. Optional for per_participant mode.',
    example: 120000,
  })
```

**Pros:**
- Minimal code change
- Backward compatible (existing clients still work)

**Cons:**
- Doesn't clarify semantic meaning
- Still unclear when to provide vs omit

### Option 2: Conditional Schema Based on Sync Mode (Robust)
```typescript
export const CreateSessionSchema = z.discriminatedUnion('sync_mode', [
  // per_participant mode: session-level total_time_ms is optional
  z.object({
    sync_mode: z.literal('per_participant'),
    total_time_ms: z.number().optional(),
    // ... other fields
  }),

  // global mode: session-level total_time_ms is required
  z.object({
    sync_mode: z.literal('global'),
    total_time_ms: z.number(),
    // ... other fields
  }),

  // ... other modes
])
```

**Pros:**
- Clear semantics per sync mode
- Enforces correct usage
- Better validation errors

**Cons:**
- Larger refactor
- More complex schema maintenance

### Option 3: Auto-calculate Session Total (Smart Default)
```typescript
// In SyncEngine or validation middleware
if (input.sync_mode === 'per_participant' && !input.total_time_ms) {
  input.total_time_ms = input.participants.reduce(
    (sum, p) => sum + p.total_time_ms,
    0
  )
}
```

**Pros:**
- Client doesn't need to calculate
- Clear semantic: session total = sum of participant times
- No breaking changes

**Cons:**
- Implicit behavior (less transparent)
- What if client provides different value?

## Recommended Action

**Immediate (v2.0.1 patch):**
- Implement **Option 1** - make `total_time_ms` optional
- Update OpenAPI documentation to clarify when to use it
- Add validation warning if omitted for modes where it might be needed

**Future (v2.1):**
- Implement **Option 2** - conditional schemas per sync mode
- Document clear semantics for each mode
- Add integration tests for all mode combinations

## Related Files

- `src/api/schemas/session.ts` (lines 84-92, 25-33)
- `src/api/openapi.ts` (lines 123-156)
- `docs/guides/USE_CASES.md` (example code may need updating)

## Testing Checklist

- [ ] Test `per_participant` without session-level `total_time_ms`
- [ ] Test `global` mode requiring session-level `total_time_ms`
- [ ] Test `count_up` mode with `max_time_ms` instead
- [ ] Verify OpenAPI spec reflects changes
- [ ] Update client SDK examples

## Client Workaround (Until Fixed)

Clients must provide **both** fields:

```typescript
await fetch('http://localhost:3000/v1/sessions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    session_id: uuidv4(),
    sync_mode: 'per_participant',
    participants: [{
      participant_id: uuidv4(),
      participant_index: 0,
      total_time_ms: 600000  // Participant time
    }],
    total_time_ms: 600000  // ⚠️ Must also provide session-level time
  })
})
```

## Deep Dive Analysis

### Root Cause Assessment

After analyzing the codebase, **this is NOT a bug** - it's a **design decision that lacks clarity**. The session-level `total_time_ms` field serves a legitimate purpose across different sync modes, but its semantic meaning is poorly documented.

#### Implementation Evidence

**[SyncEngine.ts:18-31](../../src/engine/SyncEngine.ts#L18-L31)** - Engine interface requires both:
```typescript
export interface CreateSessionConfig {
  participants: Array<{
    total_time_ms: number  // Participant-level
  }>
  total_time_ms: number      // Session-level (REQUIRED)
}
```

**[test-utils.ts:66](../../tests/e2e/test-utils.ts#L66)** - Tests auto-calculate session total:
```typescript
const totalTime = options?.total_time_ms ??
  participants.reduce((sum, p) => sum + p.total_time_ms, 0)
```

This proves the **intended design**: session-level total = sum of participant times for `per_participant` mode.

#### Semantic Meaning by Sync Mode

| Sync Mode | Participant `total_time_ms` | Session `total_time_ms` | **Actual Purpose** |
|-----------|----------------------------|------------------------|-------------------|
| `per_participant` | Individual time bank | Sum of all participant times | **Validation boundary** - ensures total doesn't exceed system limits |
| `per_cycle` | Not used | Total session budget | **Hard limit** - session ends when total exhausted |
| `global` | Not used | Shared time pool | **Primary timer** - everyone shares this |
| `count_up` | Not used | Maximum allowed time | **Ceiling** - session expires at max |

**Key insight**: Session-level `total_time_ms` serves **different purposes** depending on mode, but the schema doesn't reflect this.

#### Design Issues

**Problem 1: One Schema Fits All**
- Current `CreateSessionSchema` uses same validation for all 5 sync modes
- Semantics are fundamentally different per mode

**Problem 2: Broken Documentation**
- [USE_CASES.md:50-61](../guides/USE_CASES.md#L50-L61) chess example is **invalid** (missing session-level total)
- All example code would fail validation
- This directly caused client confusion

**Problem 3: Test Utils Hide Complexity**
- `createSessionPayload()` auto-calculates session total
- All internal tests bypass the issue
- Client-facing problem was masked

### Impact Assessment

**Severity:** HIGH
- ❌ Blocking frontend integration
- ❌ Confusing error messages
- ❌ All documentation examples are invalid
- ❌ Every new client will hit this issue

**Scope:**
- All example code in USE_CASES.md is broken
- OpenAPI spec doesn't explain dual requirement
- No validation hints about what value to provide
- Internal tests work (use auto-calculation helper)

## Strategic Recommendations

### Phase 1: Immediate Hotfix (v2.0.1) - 3 hours

**Goal:** Unblock clients immediately with backward-compatible fix

#### 1.1 Make Session-level `total_time_ms` Optional
**File:** `src/api/schemas/session.ts:84-92`

```typescript
total_time_ms: z
  .number()
  .int('Total time must be an integer')
  .min(1000, 'Total time must be at least 1000ms')
  .max(86400000, 'Total time cannot exceed 86400000ms')
  .optional()  // ✅ ADD THIS
  .openapi({
    description: `Total time for the session (milliseconds).

    - For per_participant mode: Optional. Defaults to sum of participant times.
    - For global/per_cycle modes: Required. Represents the shared time pool.
    - For count_up mode: Use max_time_ms instead.`,
    example: 120000,
  })
```

#### 1.2 Add Smart Default in Session Creation
**File:** `src/api/routes/sessions.ts` or create middleware

```typescript
// Before validation, auto-calculate for per_participant mode
if (req.body.sync_mode === 'per_participant' && !req.body.total_time_ms) {
  req.body.total_time_ms = req.body.participants.reduce(
    (sum, p) => sum + p.total_time_ms,
    0
  )
}
```

#### 1.3 Fix Documentation Examples
**File:** `docs/guides/USE_CASES.md`

Update ALL examples to include session-level `total_time_ms`:

```typescript
// Chess example (fixed)
await syncClient.createSession({
  session_id: "chess-game-123",
  sync_mode: "per_participant",
  participants: [
    { participant_id: "white-player", participant_index: 0, total_time_ms: 600000 },
    { participant_id: "black-player", participant_index: 1, total_time_ms: 600000 }
  ],
  total_time_ms: 1200000,  // ✅ ADD THIS (sum of participant times)
  increment_ms: 3000
})
```

Or add note: "Session-level `total_time_ms` will be auto-calculated if omitted."

#### 1.4 Improve Error Messages
**File:** Error handling middleware

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "total_time_ms is required for 'global' sync mode",
    "details": [{
      "field": "total_time_ms",
      "hint": "For 'per_participant' mode, this field is optional and will be auto-calculated from participant times. For 'global'/'per_cycle' modes, you must provide this value."
    }]
  }
}
```

**Deliverables:**
- [ ] Schema change (optional field)
- [ ] Auto-calculation middleware
- [ ] Fix all USE_CASES.md examples
- [ ] Update OpenAPI descriptions
- [ ] Better error messages
- [ ] Deploy as v2.0.1 hotfix

**Timeline:** 3 hours
**Risk:** LOW (backward compatible)

---

### Phase 2: Proper Schema Design (v2.1) - 2.5 days

**Goal:** Type-safe, mode-specific schemas with clear semantics

#### 2.1 Discriminated Union Schema
**File:** `src/api/schemas/session.ts`

```typescript
// Base schema with common fields
const BaseSessionSchema = z.object({
  session_id: z.string().uuid(),
  participants: z.array(ParticipantSchema).min(1).max(1000),
  metadata: z.record(z.string(), z.any()).optional(),
})

// Per-participant mode: participant times required, session total optional
const PerParticipantSessionSchema = BaseSessionSchema.extend({
  sync_mode: z.literal('per_participant'),
  total_time_ms: z.number().int().min(1000).optional(), // Auto-calculated
  increment_ms: z.number().int().min(0).optional(),
})

// Global mode: session total required, participant times ignored
const GlobalSessionSchema = BaseSessionSchema.extend({
  sync_mode: z.literal('global'),
  total_time_ms: z.number().int().min(1000), // Required!
  time_per_cycle_ms: z.number().int().min(1000).optional(),
})

// Count-up mode: uses max_time_ms instead
const CountUpSessionSchema = BaseSessionSchema.extend({
  sync_mode: z.literal('count_up'),
  max_time_ms: z.number().int().min(1000), // Required!
  increment_ms: z.number().int().min(0).optional(),
})

// Discriminated union
export const CreateSessionSchema = z.discriminatedUnion('sync_mode', [
  PerParticipantSessionSchema,
  GlobalSessionSchema,
  CountUpSessionSchema,
  // ... per_cycle, per_group
])
```

**Benefits:**
- ✅ Type-safe per mode
- ✅ Clear validation errors specific to each mode
- ✅ Self-documenting code
- ✅ OpenAPI auto-generates correct schemas per mode

#### 2.2 Mode-Specific Integration Tests

```typescript
describe('Session Creation - Mode-Specific Validation', () => {
  test('per_participant: auto-calculates session total', async () => {
    const res = await request(app).post('/v1/sessions').send({
      session_id: uuidv4(),
      sync_mode: 'per_participant',
      participants: [
        { participant_id: uuidv4(), participant_index: 0, total_time_ms: 300000 },
        { participant_id: uuidv4(), participant_index: 1, total_time_ms: 300000 }
      ]
      // No total_time_ms - should auto-calculate to 600000
    })

    expect(res.status).toBe(201)
    expect(res.body.data.total_time_ms).toBe(600000)
  })

  test('global: requires session total', async () => {
    const res = await request(app).post('/v1/sessions').send({
      session_id: uuidv4(),
      sync_mode: 'global',
      participants: [
        { participant_id: uuidv4(), participant_index: 0, total_time_ms: 0 }
      ]
      // Missing total_time_ms - should fail
    })

    expect(res.status).toBe(400)
    expect(res.body.error.details[0].field).toBe('total_time_ms')
  })

  test('per_participant: can override auto-calculated total', async () => {
    const res = await request(app).post('/v1/sessions').send({
      session_id: uuidv4(),
      sync_mode: 'per_participant',
      participants: [
        { participant_id: uuidv4(), participant_index: 0, total_time_ms: 300000 }
      ],
      total_time_ms: 1000000  // Override with larger budget
    })

    expect(res.status).toBe(201)
    expect(res.body.data.total_time_ms).toBe(1000000)
  })
})
```

#### 2.3 Decision Tree Documentation
**File:** Create `docs/guides/SYNC_MODE_DECISION_TREE.md`

```markdown
# Sync Mode Decision Tree

## Which sync mode should I use?

### Decision Flow

┌─ Each player has own time bank? (Chess, Poker)
│  └─→ **per_participant**
│     ├─ Required: participant.total_time_ms for each player
│     └─ Optional: session.total_time_ms (auto-calculated as sum)
│
├─ Fixed time per round/question? (Quiz, Auction)
│  └─→ **per_cycle**
│     ├─ Required: time_per_cycle_ms
│     └─ Required: session.total_time_ms (total budget)
│
├─ One shared timer for everyone? (Exam, Meditation)
│  └─→ **global**
│     ├─ Required: session.total_time_ms
│     └─ Note: participant.total_time_ms is ignored
│
└─ Counting UP like a stopwatch? (Speedrun)
   └─→ **count_up**
      ├─ Required: max_time_ms
      └─ Note: session.total_time_ms is not used

### Field Requirements Matrix

| Field | per_participant | per_cycle | per_group | global | count_up |
|-------|----------------|-----------|-----------|--------|----------|
| `participant.total_time_ms` | ✅ Required | ❌ Ignored | ✅ Required | ❌ Ignored | ❌ Ignored |
| `session.total_time_ms` | 🟡 Auto-calc | ✅ Required | ✅ Required | ✅ Required | ❌ Not used |
| `time_per_cycle_ms` | ❌ Optional | ✅ Required | ❌ Optional | 🟡 Optional | ❌ Not used |
| `max_time_ms` | ❌ Not used | ❌ Not used | ❌ Not used | ❌ Not used | ✅ Required |
| `increment_ms` | 🟡 Optional | ❌ Not used | 🟡 Optional | ❌ Not used | 🟡 Optional |
```

**Deliverables:**
- [ ] Discriminated union schemas
- [ ] Mode-specific integration tests
- [ ] Decision tree documentation
- [ ] Migration guide for clients
- [ ] Updated OpenAPI spec

**Timeline:** 2.5 days
**Risk:** MEDIUM (requires careful testing)

---

### Phase 3: Long-term Improvements (v2.2+)

#### 3.1 Client SDK with TypeScript Types
Generate type-safe client SDK from discriminated schemas:

```typescript
// Client gets perfect autocomplete per mode
const session = await client.createSession({
  sync_mode: 'per_participant',
  // TypeScript knows: total_time_ms is optional here
  participants: [...]
})

const globalSession = await client.createSession({
  sync_mode: 'global',
  // TypeScript enforces: total_time_ms is required
  total_time_ms: 3600000
})
```

#### 3.2 Interactive Schema Validator
Add to Swagger UI - let developers test their payloads before coding.

---

## Recommended Execution Plan

### **Do Now (This Sprint):**
✅ **Phase 1** - Immediate hotfix (3 hours)
1. Make `total_time_ms` optional
2. Add auto-calculation middleware
3. Fix all USE_CASES.md examples
4. Update OpenAPI descriptions
5. Deploy as v2.0.1 hotfix

**Why:** Unblocks clients immediately, zero risk

### **Do Next (Next Sprint):**
✅ **Phase 2** - Proper schema design (2.5 days)
1. Discriminated union schemas
2. Comprehensive mode-specific tests
3. Decision tree documentation

**Why:** Long-term maintainability, better DX

### **Do Later (Backlog):**
🔵 **Phase 3** - Advanced tooling
1. Type-safe client SDK
2. Interactive schema validator

**Why:** Nice-to-have, not blocking

---

## Why NOT Other Alternatives?

**❌ Leave as-is (require both fields):**
- Clients are already blocked
- Documentation is broken
- Poor developer experience

**❌ Remove session-level field entirely:**
- Breaks validation for global/per_cycle modes
- Loses budget/limit functionality
- Would need alternative design

**❌ Rush discriminated union now:**
- Too risky for immediate hotfix
- Requires extensive testing
- Could break existing integrations

---

## Final Assessment

### Issue Classification
**Type:** Design Issue + Documentation Gap
**Severity:** HIGH (blocking clients)
**Complexity:** MEDIUM (schema refactor + docs)

### Verdict
The session-level `total_time_ms` has **legitimate uses**:
1. **Validation**: Prevents absurdly large sessions
2. **Budgeting**: For shared time pools (global mode)
3. **Limits**: Maximum time for count-up mode

**However**, the implementation is confusing because:
- ❌ Documentation shows invalid examples
- ❌ Schema doesn't explain mode-specific semantics
- ❌ Error messages provide no guidance
- ❌ No auto-calculation for obvious case (per_participant sum)

### Solution Path
1. **Short-term:** Optional + auto-calc (Phase 1) ✅ Low risk, high impact
2. **Long-term:** Discriminated schemas (Phase 2) ✅ Proper fix, better DX

---

## Notes

- This issue was discovered during frontend integration testing
- Multiple clients reported confusion about the error message
- The Swagger UI at `http://localhost:3000/api-docs/` shows `total_time_ms` as required but doesn't explain the dual requirement
- Internal test suite masked the issue by using helper function with auto-calculation
- Chess example in USE_CASES.md is currently **invalid** and would fail API validation
