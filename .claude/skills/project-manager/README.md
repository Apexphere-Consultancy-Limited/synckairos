# Project Manager Skill - Quick Reference

**Purpose:** AI project manager for SyncKairos development with deep knowledge of the v2.0 architecture and 4-week roadmap.

---

## What It Does

Provides 5 key capabilities:

1. **Sprint Planning** - Break down phases into actionable tasks with estimates
2. **Progress Tracking** - Monitor status, identify blockers, recommend next actions
3. **Dependency Analysis** - Visualize what depends on what, find critical path
4. **Technical Debt** - Decide ship vs refactor, align with v2.0 strategy
5. **Risk Assessment** - Identify risks, suggest mitigations

---

## How to Use

### Sprint Planning
```
"Help me plan the next sprint"
"Break down Phase 1 into tasks"
"What are the Week 1 goals?"
```

### Progress Tracking
```
"What should I work on next?"
"What's the current status?"
"Are we on track for Week 1?"
```

### Dependencies
```
"Show me the dependency graph for RedisStateManager"
"What tasks can I work on in parallel?"
"What's blocking the WebSocket implementation?"
```

### Technical Decisions
```
"Should I use Prisma or raw SQL?"
"Should I refactor now or ship first?"
"Is this good enough for v2.0?"
```

### Risk Management
```
"What are the biggest risks?"
"How do we validate performance targets?"
"What should I test before deploying?"
```

---

## Project Context

### Architecture
- **Tech:** Node.js 20 + TypeScript, Redis, PostgreSQL, Express, WebSocket
- **Performance:** <50ms cycle switch, <100ms WebSocket delivery, 10k+ sessions
- **Components:** RedisStateManager → SyncEngine → REST API → WebSocketServer

### Roadmap
- **Week 1:** Core Architecture (RedisStateManager, SyncEngine)
- **Week 2:** API & WebSocket
- **Week 3:** Testing & Monitoring
- **Week 4:** Deployment

### Strategy
**v2.0:** Ship fast, validate market
**v3.0:** Add extensibility later

### Critical Path
```
RedisStateManager → SyncEngine → REST API → WebSocket → Load Testing → Deploy
```

---

## Key Principle

> **"Ship fast, iterate based on feedback, then refactor for extensibility"**

When in doubt:
- ✅ Simple over clever
- ✅ Ship over perfect
- ✅ Document debt, don't block on it
- ✅ Test performance early (Week 3)

---

## Files

```
project-manager/
├── SKILL.md                    # Workflows and instructions
└── references/
    ├── architecture.md         # Full architecture details
    └── roadmap.md              # 4-week detailed roadmap
```

---

## Version

**v1.0** (2025-10-21) - Initial release
