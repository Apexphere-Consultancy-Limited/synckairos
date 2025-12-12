# Future Tech Stack Roadmap & Risk Mitigation

This document outlines architectural risks identified in Phase 1 and the roadmap for mitigating them in future phases.

## 1. Data Loss Risk (Audit Gap) -- *Medium Risk*
**Scenario**: Server crash after Redis write but before Async Queue write.
**Current State**: Fire-and-forget `asyncDBWrite`.
**Mitigation Strategy (Phase 2/3)**:
- **Option A (Robust)**: Use Redis Stream for the event log *instead* of fire-and-forget. The worker reads from the Stream reliably.
- **Option B (Simple)**: Wrap both Redis State write and Queue add in a Lua script or transaction (though complex with different Redis instances if separated).
- **Recommended**: Move to **Redis Streams** for the audit trail. `RedisStateManager` appends to Stream; Worker consumes Stream.

## 2. Redis Memory Limit -- *High Risk at Scale*
**Scenario**: Active sessions exceed configured `maxmemory` (256MB).
**Current State**: `allkeys-lru` eviction policy. Redis will delete active sessions to make space.
**Mitigation Strategy (Phase 3)**:
- **Scaling**: Increase memory limit (vertical scaling).
- **Sharding**: Implement client-side sharding or use Redis Cluster to distribute sessions across nodes.
- **Eviction Policy**: Ensure `volatile-lru` or similar is used if keys have TTLs, but "true" state storage shouldn't rely on eviction.
- **Storage Tiering**: Offload "cold" sessions to disk/Postgres earlier if not active.

## 3. Single Point of Failure -- *Infrastructure Risk*
**Scenario**: Single Redis instance outage.
**Current State**: Standalone Redis in Docker.
**Mitigation Strategy (Phase 3/Production)**:
- **High Availability**: Deploy Redis Sentinel or Redis Cluster.
- **Client Config**: Configure `ioredis` to handle Sentinel/Cluster failover automatically.

## 4. Write-Behind Queue Backpressure
**Scenario**: Postgres goes down or writes are too slow; Queue fills up memory.
**Current State**: BullMQ in Redis.
**Mitigation**:
- Monitoring on Queue length (already implemented).
- Spill-over strategy or "Circuit Breaker" to stop accepting new sessions if queue is dangerously full.
