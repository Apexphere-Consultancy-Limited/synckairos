# Data Flow - Phase 1

## Session State Flow

```
Client Request
     │
     ▼
┌─────────────┐
│  Instance   │──────▶ Redis GET session:id (1ms)
└─────────────┘         │
     │                  │
     │◀─────────────────┘
     │
     │──────▶ Redis SET session:id (1ms)
     │        PUBLISH session-updates
     │
     └──────▶ BullMQ.add (async, non-blocking)
                  │
                  ▼
              PostgreSQL (audit only)
```

## Multi-Instance Communication

```
Instance 1                Instance 2                Instance 3
    │                         │                         │
    │ updateSession()         │                         │
    ├──▶ Redis SET            │                         │
    ├──▶ PUBLISH ─────────────┼─────────────────────────┤
    │    session-updates      │                         │
    │                         │                         │
    │                    ┌────▼────┐               ┌────▼────┐
    │                    │callback │               │callback │
    │                    │executed │               │executed │
    │                    └─────────┘               └─────────┘
```

## Write Path

```
updateSession(id, state)
    │
    ├─▶ Redis GET (check version)
    ├─▶ Redis SET (version++)
    ├─▶ Redis PUBLISH
    └─▶ BullMQ add ──▶ Worker ──▶ PostgreSQL
        (async)         (retry 5x)
```

## Read Path

```
getSession(id)
    │
    └─▶ Redis GET session:id
            │
            ├─▶ Found: return (1ms)
            └─▶ Not found: null
```

## State Lifecycle

```
createSession()
    ├─▶ Redis SET (TTL 1hr)
    └─▶ BullMQ add

updateSession()
    ├─▶ Redis SET (TTL refresh)
    └─▶ BullMQ add

[1 hour no activity]
    └─▶ Redis TTL expires
        └─▶ Auto-deleted

deleteSession()
    ├─▶ Redis DEL
    └─▶ PUBLISH (deleted=true)
```

## Critical Paths

**Hot Path** (must be <5ms):
- `getSession()`: Redis GET only
- `updateSession()`: Redis GET + SET + PUBLISH
- `broadcastToSession()`: Redis PUBLISH

**Cold Path** (async, no latency impact):
- PostgreSQL writes via BullMQ
- Audit trail
- Analytics queries
