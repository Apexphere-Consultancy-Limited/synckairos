---
name: architect
description: Architecture and code review skill for SyncKairos v2.0 development. Use this skill when reviewing code, PRs, or architectural decisions to ensure compliance with distributed-first, Redis-primary design principles. Triggers when user asks to review code, check PR, validate architecture decisions, or verify compliance with SyncKairos design patterns (e.g., "Review this code", "Check this PR", "Is this following our architecture?", "Review this implementation").
---

# SyncKairos Architect

## Overview

Perform architectural reviews and code reviews for SyncKairos v2.0, ensuring all code follows the distributed-first, Redis-primary architecture with strict adherence to the 7 core design principles. Identify violations, suggest improvements, and validate performance targets.

⚠️ **CRITICAL**: SyncKairos uses **Zod schemas with OpenAPI metadata** ([src/api/schemas/session.ts](../../../src/api/schemas/session.ts)) as the single source of truth for ALL API contracts. When reviewing API changes, ensure schemas are updated, not manual documentation. OpenAPI docs auto-generate and are served at `/api-docs`. See [ARCHITECTURE.md](../../../docs/design/ARCHITECTURE.md#api-contract---single-source-of-truth) for details.

## When to Use This Skill

Use this skill when:
- Reviewing pull requests
- Validating code before merging
- Checking architectural decisions
- Reviewing new implementations
- Identifying violations of design principles
- Ensuring performance targets are met

Do NOT use for:
- Writing new code (use general development)
- Debugging runtime errors (use debugger)
- Understanding existing code (use code exploration)

## Review Workflow

### Step 1: Understand the Change

Read the code or PR description to understand:
- What component is being changed?
- What is the purpose of the change?
- Is it on the critical path (hot path)?

### Step 2: Load Architecture Principles

Read `references/design_principles.md` to refresh:
- Core design principles (Calculate Don't Count, Distributed-First, Hot Path Optimization, etc.)
- Common violations
- Code patterns (correct vs wrong)
- Performance budgets

### Step 3: Systematic Review

Check the code against each principle:

1. **Distributed-First**
   - Search for: `Map`, `Set`, `private.*=`, class-level state
   - Verify: All state goes through RedisStateManager

2. **Hot Path Optimization**
   - Identify: Is this switchCycle, getCurrentState, or WebSocket?
   - Verify: No PostgreSQL queries, only Redis operations

3. **Optimistic Locking**
   - Check: Version field present and incremented
   - Verify: expectedVersion parameter used in updates

4. **Calculate Don't Count**
   - Search for: `setInterval`, `setTimeout` with countdown logic
   - Verify: Time calculated from server timestamps

5. **State Ownership**
   - Check: Clear data flow (Redis → Logic → Redis)
   - Verify: No caching, no duplicate storage

6. **Fail-Fast Observable**
   - Check: Errors thrown (not returned as null)
   - Verify: Structured logging, Prometheus metrics

7. **Simple Over Clever**
   - Review: Is this overly complex?
   - Verify: Code is maintainable and clear

### Step 4: Performance Validation

If the change touches hot path:

- Estimate latency impact
- Check against performance budgets:
  - Redis GET: <5ms
  - Redis SET: <5ms
  - switchCycle() total: <50ms target (3-5ms expected)
  - WebSocket delivery: <100ms

### Step 5: Generate Review Report

Provide structured feedback in this format:

```markdown
## Architecture Review: [Component/PR Name]

### Summary
[One-line assessment: Approved / Needs Changes / Blocked]

### Critical Violations ⛔
[List blocking issues, if any]

### Major Issues ⚠️
[List significant concerns]

### Minor Suggestions 💡
[List recommendations]

### Performance Impact
[Estimated latency impact on hot path]

### Recommendations
[Specific actions to take]
```

## Review Decision Tree

```
Code/PR to Review
│
├─ Contains instance-local state?
│  └─ YES → ⛔ BLOCK: Violates Distributed-First
│
├─ Hot path queries PostgreSQL?
│  └─ YES → ⛔ BLOCK: Violates Hot Path Optimization
│
├─ Critical update without version check?
│  └─ YES → ⛔ BLOCK: Missing Optimistic Locking
│
├─ Uses setInterval for countdown?
│  └─ YES → ⛔ BLOCK: Violates Calculate Don't Count
│
├─ Silent failures (returns null on error)?
│  └─ YES → ⚠️ REQUEST CHANGES: Poor error handling
│
├─ Missing structured logging/metrics?
│  └─ YES → ⚠️ REQUEST CHANGES: Not observable
│
├─ Missing tests for critical logic?
│  └─ YES → ⚠️ REQUEST CHANGES: Insufficient testing
│
├─ Uses console.log or magic numbers?
│  └─ YES → 💡 SUGGEST: Minor improvements
│
└─ All checks pass
   └─ ✅ APPROVE
```

## Severity Levels

### Critical Violations ⛔ (Block PR)

These MUST be fixed before merging:

- **Instance-local state storage** (Map, Set, class variables for session data)
- **Hot path database queries** (await db.query in switchCycle)
- **Missing optimistic locking** (no version check on critical updates)
- **Local countdown timers** (setInterval for time tracking)

### Major Issues ⚠️ (Request Changes)

These should be fixed:

- Poor error handling (silent failures, returning null)
- Unclear data ownership (multiple sources of truth)
- Missing tests for critical paths
- Race condition vulnerabilities

### Minor Suggestions 💡 (Recommend)

These are recommendations:

- Inconsistent logging (console.log vs Pino)
- Hard-coded values (magic numbers)
- Missing TypeScript types (using `any`)

## Example Reviews

### Example 1: Blocked PR (Critical Violation)

**Code Reviewed:**
```typescript
class SessionCache {
  private cache = new Map<string, SyncState>() // ❌

  async getSession(id: string): Promise<SyncState> {
    if (this.cache.has(id)) return this.cache.get(id)
    const state = await redis.get(id)
    this.cache.set(id, state)
    return state
  }
}
```

**Review Output:**
```markdown
## Architecture Review: ⛔ BLOCKED

**Component:** SessionCache - Add instance-local caching

### Critical Violations ⛔

#### Instance-Local State Storage
**Location:** `src/cache/SessionCache.ts:12`

**Problem:** Introduces `Map<string, SyncState>` for caching, violating "Distributed-First" principle.

**Impact:**
- Cache only exists on one instance
- Session updates on Instance A won't reflect on Instance B
- Stale data guaranteed in multi-instance deployment

**Fix:** Remove caching entirely. Redis IS the cache (<3ms reads).

### Recommendation
❌ **DO NOT MERGE** - Fundamental architecture violation

Redis is fast enough (<3ms) that caching provides no benefit and breaks distributed operation.
```

### Example 2: Needs Changes (Major Issue)

**Code Reviewed:**
```typescript
async switchCycle(sessionId: string): Promise<SwitchCycleResult> {
  const state = await this.stateManager.getSession(sessionId)
  const newState = { ...state, active_participant_id: nextId }
  await this.stateManager.updateSession(sessionId, newState) // ❌ No version check
  await this.db.query('INSERT INTO sync_events...') // ❌ Blocks hot path
  return result
}
```

**Review Output:**
```markdown
## Architecture Review: ⚠️ NEEDS CHANGES

**Component:** SyncEngine - Implement switchCycle

### Critical Violations ⛔

#### Hot Path Database Query
**Location:** Line 4

**Problem:** `await this.db.query()` blocks on PostgreSQL write (~10-30ms)

**Impact:** Breaks <50ms latency target (expected: 3-5ms, actual: ~15-35ms)

**Fix:** Use async audit queue

### Major Issues ⚠️

#### Missing Optimistic Locking
**Location:** Line 3

**Problem:** No version check on update

**Impact:** Race condition vulnerability

**Fix:**
\`\`\`typescript
const expectedVersion = state.version
state.version++
await this.stateManager.updateSession(sessionId, state, expectedVersion)
this.auditQueue.add({ sessionId, state }) // Non-blocking
\`\`\`

### Recommendation
Fix both issues before merging
```

### Example 3: Approved

**Code Reviewed:**
```typescript
async getSession(sessionId: string): Promise<SyncState | null> {
  const state = await this.redis.get(`session:${sessionId}`)
  if (!state) {
    throw new NotFoundError(`Session ${sessionId} not found`)
  }
  return JSON.parse(state)
}
```

**Review Output:**
```markdown
## Architecture Review: ✅ APPROVED

**Component:** RedisStateManager - Get session method

### Summary
Clean implementation following all design principles.

### Architecture Compliance
- ✅ Distributed-First: Uses Redis, no local state
- ✅ Fail-Fast: Throws structured error
- ✅ Simple: Clear, maintainable code

### Performance Impact
Redis GET operation: ~1-2ms (within budget)

### Recommendation
Merge when CI passes
```

## Using References

This skill includes one reference file:

### references/design_principles.md

Complete reference covering:
- 7 core design principles with code examples
- Correct vs incorrect patterns
- Architecture violations to watch for
- Code review checklist
- Common mistakes
- Performance budgets

**When to read:** At the start of every review to refresh principles

**How to use:**
1. Read relevant principle section
2. Compare code against correct/incorrect examples
3. Check violation lists
4. Apply checklist

## Best Practices

### Before Review
1. Read PR description to understand intent
2. Identify which components are affected
3. Check if changes touch critical path (hot path)
4. Refresh relevant principles from references

### During Review
1. Be systematic - check each principle
2. Use code examples from references
3. Provide specific line numbers
4. Suggest concrete fixes
5. Explain *why* it violates architecture

### Review Output
1. Start with summary (Approved/Changes/Blocked)
2. Categorize issues (Critical/Major/Minor)
3. Provide code examples for fixes
4. Include rationale (performance, scalability)
5. End with clear recommendation

### Tone
- **Objective and technical** - Focus on principles, not preferences
- **Educational** - Explain the "why" behind violations
- **Constructive** - Always suggest fixes
- **Clear** - Use categories (⛔/⚠️/💡) for severity

## Quick Reference Checklist

For each code review, verify:

### Architecture
- [ ] No instance-local state (Map, Set, class variables)
- [ ] All state through RedisStateManager
- [ ] Redis = PRIMARY, PostgreSQL = AUDIT only
- [ ] Version field for concurrent updates

### Performance
- [ ] Hot path uses Redis only (<50ms total)
- [ ] No blocking PostgreSQL queries
- [ ] Async audit writes via queue

### Concurrency
- [ ] Optimistic locking on critical updates
- [ ] Version check with expectedVersion
- [ ] No race conditions

### Observability
- [ ] Structured logging (Pino, not console.log)
- [ ] Prometheus metrics for key operations
- [ ] Errors thrown (not returned as null)

### Testing
- [ ] Unit tests for business logic
- [ ] Integration tests for API
- [ ] Edge cases covered

---

**Remember:** The goal is to maintain architecture integrity while helping developers understand *why* certain patterns matter for SyncKairos v2.0's distributed, high-performance design.
