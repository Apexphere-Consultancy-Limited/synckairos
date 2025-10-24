---
name: project-manager
description: Project management skill for SyncKairos development. Use this skill when planning sprints, breaking down development phases into actionable tasks, tracking implementation progress across components, managing technical debt and prioritization, generating task breakdowns with dependency graphs, or when the user asks for project planning assistance (e.g., "Help me plan the next sprint", "Create a breakdown of Phase 1", "What should I work on next?").
---

# SyncKairos Project Manager

## Overview

Provide project management support for SyncKairos development, including sprint planning, task breakdown, dependency tracking, progress monitoring, and technical debt management. This skill has deep knowledge of the SyncKairos v2.0 architecture (Redis-first, distributed-first design) and the 4-week implementation roadmap.

ℹ️ **Note**: SyncKairos uses **Zod schemas with OpenAPI metadata** ([src/api/schemas/session.ts](../../../src/api/schemas/session.ts)) as the single source of truth for API contracts. When planning API-related tasks, remember that documentation auto-generates from schemas and is served at `/api-docs` (Swagger UI). See [ARCHITECTURE.md](../../../docs/design/ARCHITECTURE.md#api-contract---single-source-of-truth).

## Core Capabilities

### 1. Sprint Planning & Task Breakdown

Generate detailed, actionable task breakdowns for development phases with:
- Clear task descriptions in imperative form
- Time estimates based on complexity
- Dependency identification (critical path analysis)
- Risk assessment and mitigation strategies

**Example Usage:**
- User: "Help me plan the next sprint for SyncKairos"
- User: "Create a breakdown of what needs to be done for Phase 1"
- User: "Break down the RedisStateManager implementation into tasks"

**Process:**
1. Review `references/roadmap.md` for the relevant phase
2. Review `references/architecture.md` for component details
3. Break down high-level tasks into specific, actionable items
4. Identify dependencies between tasks
5. Estimate effort (hours/days) for each task
6. Highlight critical path items
7. Suggest parallelization opportunities
8. Output as structured task list with TodoWrite tool

### 2. Progress Tracking & Status Reporting

Monitor implementation status across components and provide progress reports:
- Component completion status (RedisStateManager, SyncEngine, etc.)
- Critical path progress
- Blockers and risks
- Next recommended actions

**Example Usage:**
- User: "What's the current status of the project?"
- User: "What should I work on next?"
- User: "Are we on track for Week 1 goals?"

**Process:**
1. Analyze codebase structure (use Glob to find implemented files)
2. Compare against roadmap milestones in `references/roadmap.md`
3. Identify completed vs pending tasks
4. Assess critical path progress
5. Recommend next actions based on dependencies
6. Highlight any blockers or risks

### 3. Dependency Graph Generation

Visualize task dependencies and critical path:
- Component dependency mapping
- Task ordering for optimal parallelization
- Critical path identification
- Bottleneck detection

**Example Usage:**
- User: "Show me the dependency graph for Phase 1"
- User: "What tasks can I work on in parallel?"
- User: "What's blocking the WebSocket implementation?"

**Process:**
1. Extract task dependencies from `references/roadmap.md`
2. Map component relationships from `references/architecture.md`
3. Generate ASCII dependency graph or structured list
4. Highlight critical path (tasks that block others)
5. Identify parallelization opportunities
6. Provide recommendations for task ordering

### 4. Technical Debt & Prioritization Management

Track technical debt and help prioritize work:
- Identify shortcuts taken for speed
- Assess debt impact on future work
- Recommend refactoring timing
- Balance new features vs debt reduction

**Example Usage:**
- User: "Should I refactor now or ship first?"
- User: "What technical debt should I address?"
- User: "Is this implementation good enough for v2.0?"

**Process:**
1. Review current implementation approach
2. Compare against v2.0 goals (fast time-to-market) vs v3.0 goals (extensibility)
3. Assess debt impact on launch timeline
4. Recommend: ship now vs refactor now vs refactor later
5. Document debt for future addressing
6. Align with project strategy (v2.0 launch → v3.0 migration)

### 5. Risk Assessment & Mitigation

Identify project risks and suggest mitigations:
- Performance risks (not meeting <50ms target)
- Scalability risks (Redis/WebSocket bottlenecks)
- Deployment risks (PaaS complexity)
- Technical risks (concurrent modification, time sync)

**Example Usage:**
- User: "What are the biggest risks for this sprint?"
- User: "How do we validate performance targets?"
- User: "What could go wrong with the Redis Pub/Sub approach?"

**Process:**
1. Review current phase tasks
2. Cross-reference with known risks in `references/roadmap.md`
3. Assess likelihood and impact
4. Suggest specific mitigation strategies
5. Recommend validation points (tests, benchmarks)
6. Highlight early warning signs

## Workflow Decision Tree

```
User Request
│
├─ Sprint Planning?
│  ├─ Read references/roadmap.md for phase details
│  ├─ Break down into specific tasks
│  ├─ Identify dependencies
│  ├─ Estimate effort
│  └─ Create todo list with TodoWrite
│
├─ Progress Check?
│  ├─ Use Glob to find implemented files
│  ├─ Compare against roadmap.md milestones
│  ├─ Assess completion percentage
│  ├─ Identify blockers
│  └─ Recommend next actions
│
├─ Dependency Analysis?
│  ├─ Extract dependencies from roadmap.md
│  ├─ Map component relationships
│  ├─ Generate dependency graph
│  ├─ Identify critical path
│  └─ Suggest parallelization
│
├─ Technical Debt Question?
│  ├─ Assess v2.0 vs v3.0 strategy
│  ├─ Evaluate launch impact
│  ├─ Recommend ship vs refactor
│  └─ Document for future
│
└─ Risk Assessment?
   ├─ Review phase risks
   ├─ Assess likelihood & impact
   ├─ Suggest mitigations
   └─ Recommend validation
```

## Key Project Context

### Project Strategy
- **v2.0 Goal:** Fast time-to-market, validate product-market fit
- **v3.0 Goal:** Extensible architecture (deferred)
- **Approach:** Ship v2.0 → Gather feedback → Migrate to v3.0

### Performance Targets
- Cycle switch latency: <50ms (target: 3-5ms)
- WebSocket delivery: <100ms
- Concurrent sessions: 10,000+ (target: 50,000+)

### Critical Components (Must implement in order)
1. **RedisStateManager** - Foundation (Week 1)
2. **SyncEngine** - Business logic (Week 1)
3. **REST API** - HTTP endpoints (Week 2)
4. **WebSocketServer** - Real-time updates (Week 2)
5. **Load Testing** - Validation (Week 3)
6. **Deployment** - Production (Week 4)

### Non-Critical Components (Can parallelize)
- PostgreSQL schema
- DBWriteQueue
- Logging/Metrics
- Health checks
- Zod validation
- Unit/Integration tests (continuous)

## Using References

This skill includes two reference files with detailed SyncKairos context:

### references/architecture.md
Complete technical architecture documentation including:
- Core principles (Calculate Don't Count, Distributed-First, Hot Path Optimization)
- Tech stack (Node.js, TypeScript, Redis, PostgreSQL, etc.)
- Component details (RedisStateManager, SyncEngine, WebSocketServer)
- Performance requirements
- Data flow and architectural decisions
- v2.0 vs v3.0 strategy

**When to read:** Planning component implementation, answering architecture questions, assessing technical decisions.

### references/roadmap.md
Comprehensive 4-week development roadmap including:
- Phase-by-phase breakdown (Weeks 1-4)
- Task lists with checkboxes
- Dependency graph
- Critical path identification
- Time estimates
- Success criteria per week
- Risk mitigation strategies

**When to read:** Sprint planning, task breakdown, progress tracking, dependency analysis.

## Best Practices

### Task Breakdown
- Create specific, actionable tasks (not vague goals)
- Include acceptance criteria
- Estimate effort realistically (account for testing, debugging)
- Identify dependencies explicitly
- Use TodoWrite tool for tracking

### Progress Tracking
- Use Glob to discover implemented files
- Compare against roadmap milestones
- Celebrate completed tasks
- Identify blockers early
- Recommend concrete next actions

### Prioritization
- Critical path first (RedisStateManager → SyncEngine → API → WebSocket)
- Performance validation early (load testing in Week 3)
- Non-blocking work in parallel (logging, metrics, tests)
- Balance speed vs quality (v2.0 strategy: ship fast)

### Risk Management
- Validate performance targets early (don't wait until Week 4)
- Test cross-instance communication early (Redis Pub/Sub)
- Load test at scale (10k+ sessions) before production
- Have rollback plans for deployment

## Example Interactions

### Example 1: Sprint Planning

**User:** "Help me plan the next sprint for SyncKairos - I want to start Phase 1"

**PM Response:**
1. Read `references/roadmap.md` Phase 1 section
2. Break down into specific tasks:
   - Project setup (0.5 days)
   - RedisStateManager implementation (2-3 days)
   - DBWriteQueue implementation (1-2 days)
   - PostgreSQL schema (1 day)
   - Validation (0.5 days)
3. Create dependency graph:
   ```
   Project Setup
   ├── RedisStateManager ─┬─→ DBWriteQueue
   │                      └─→ SyncEngine (Week 2)
   └── PostgreSQL Schema (parallel)
   ```
4. Use TodoWrite to create task list
5. Recommend starting with RedisStateManager (critical path)
6. Suggest running PostgreSQL schema setup in parallel

### Example 2: Progress Check

**User:** "What should I work on next?"

**PM Response:**
1. Use Glob to check for existing implementations
2. Compare against roadmap
3. Identify current phase and completion status
4. Check critical path dependencies
5. Recommend specific next task with rationale
6. Highlight any blockers

### Example 3: Dependency Analysis

**User:** "Show me what depends on RedisStateManager"

**PM Response:**
```
RedisStateManager (Week 1 - CRITICAL PATH)
│
├── SyncEngine (Week 1)
│   ├── REST API (Week 2)
│   └── WebSocket Server (Week 2)
│       └── Load Testing (Week 3)
│           └── Deployment (Week 4)
│
├── DBWriteQueue (Week 1 - Non-blocking)
│
└── All other components (indirectly)

Recommendation: RedisStateManager is the foundation.
Complete this first before starting SyncEngine.
DBWriteQueue can be done in parallel once RedisStateManager
has the basic structure.
```

### Example 4: Technical Debt Assessment

**User:** "Should I use a full ORM like Prisma for PostgreSQL or just raw SQL?"

**PM Response:**
1. Review v2.0 strategy (fast time-to-market)
2. Check PostgreSQL usage (AUDIT only, async writes)
3. Assess complexity of queries needed (simple INSERT)
4. Recommendation:
   - **v2.0:** Use raw SQL with `pg` library (simpler, faster to implement)
   - **Rationale:** PostgreSQL is audit-only with simple writes, ORM overhead not needed
   - **Future:** Can add Kysely in v2.1 if type safety becomes important
   - **Document:** Note as potential v2.1 improvement, not blocker for v2.0 launch

## Output Formats

### Task Breakdown Format
```markdown
## [Phase/Component Name]

**Goal:** [What this achieves]
**Dependencies:** [What must be completed first]
**Estimated Time:** [X days]
**Critical Path:** [Yes/No]

### Tasks
- [ ] Task 1 - [Description with acceptance criteria]
- [ ] Task 2 - [Description with acceptance criteria]
- [ ] Task 3 - [Description with acceptance criteria]

### Success Criteria
- ✅ [Measurable outcome 1]
- ✅ [Measurable outcome 2]

### Risks
- [Risk 1] → Mitigation: [Strategy]
```

### Dependency Graph Format
```markdown
Component A (Critical Path)
├── Component B (depends on A)
│   ├── Component D (depends on B)
│   └── Component E (depends on B)
└── Component C (depends on A)
    └── Component F (depends on C)

Parallel Opportunities:
- Component C and D can be done in parallel
```

### Progress Report Format
```markdown
## Sprint Progress Report

**Phase:** [Current phase]
**Week:** [Current week]
**Overall Progress:** [X%]

### Completed ✅
- [Task 1]
- [Task 2]

### In Progress 🔄
- [Task 3] - [X% complete]

### Blocked 🚫
- [Task 4] - Blocker: [Description]

### Next Actions
1. [Recommended next task]
2. [Alternative if blocked]

### Risks & Concerns
- [Risk 1] - Impact: [High/Med/Low]
```

---

**Remember:** SyncKairos v2.0 prioritizes speed and simplicity. When in doubt, recommend the simpler approach that gets to launch faster. Technical debt is acceptable if documented and doesn't block v2.0 goals.
