# SyncKairos Architecture v3.0 - Extensible Design

**Version:** 3.0 (Proposal)
**Date:** 2025-10-20
**Status:** Design Phase - Extensible Architecture

---

## Executive Summary

This document proposes a **redesigned architecture (v3.0)** that incorporates extensibility and decoupling principles from the ground up. The v2.0 design is solid but tightly coupled. By introducing **interface-based abstractions**, **plugin architecture**, and **protocol versioning** now, we avoid technical debt later.

**Key Improvements over v2.0:**
- ✅ Storage-agnostic (swap Redis/DynamoDB/etc without code changes)
- ✅ Message broker-agnostic (Redis/Kafka/NATS)
- ✅ Extensible sync modes via plugins
- ✅ Protocol versioning for backward compatibility
- ✅ Event-driven architecture for extensibility
- ✅ Configuration-driven (no code changes for deployment variations)
- ✅ Multi-tenancy ready

---

## Core Design Principles

### 1. Dependency Inversion Principle

**OLD (v2.0):**
```
SyncEngine → RedisStateManager → Redis
         (depends on concrete implementation)
```

**NEW (v3.0):**
```
SyncEngine → IStateManager (interface) ← RedisStateManager
                                      ← DynamoDBStateManager
                                      ← MemoryStateManager
         (depends on abstraction, not implementation)
```

### 2. Plugin-First Architecture

**OLD (v2.0):**
```typescript
// Adding new sync mode requires modifying core
sync_mode: 'per_participant' | 'per_cycle' | ...
```

**NEW (v3.0):**
```typescript
// Sync modes are plugins - add new ones without core changes
interface ISyncModePlugin {
  name: string
  onCycleSwitch(state: SyncState): void
  onTimeout(state: SyncState): TimeoutAction
}
```

### 3. Protocol Versioning from Day 1

**OLD (v2.0):**
```json
{ "type": "STATE_UPDATE", "payload": {...} }
```

**NEW (v3.0):**
```json
{ "v": 1, "type": "STATE_UPDATE", "payload": {...} }
```

---

## Layered Architecture

```
┌──────────────────────────────────────────────────────────┐
│              API Layer (Protocol Adapters)               │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐   │
│  │REST v1/v2│  │WebSocket│  │ gRPC    │  │GraphQL  │   │
│  │         │  │  v1/v2  │  │ (future)│  │(future) │   │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘   │
└───────┼───────────┼─────────────┼──────────────┼───────┘
        │           │             │              │
        └───────────┴─────────────┴──────────────┘
                    │
┌───────────────────┴──────────────────────────────────────┐
│            Application Layer (Use Cases)                 │
│  ┌──────────────────────────────────────────────────┐   │
│  │            SessionService                        │   │
│  │  - CreateSession  - SwitchCycle                  │   │
│  │  - StartSession   - PauseSession                 │   │
│  └────────────────┬────────────────────────────────┘   │
└───────────────────┼──────────────────────────────────────┘
                    │
┌───────────────────┴──────────────────────────────────────┐
│           Domain Layer (Business Logic)                  │
│  ┌─────────────────┐  ┌──────────────────────────────┐  │
│  │  SyncEngine     │  │   Plugin Registry            │  │
│  │  - Time Calc    │  │   - Per-Participant Plugin   │  │
│  │  - Validation   │  │   - Per-Cycle Plugin         │  │
│  │  - Orchestration│  │   - Custom Plugins           │  │
│  └─────────────────┘  └──────────────────────────────┘  │
│                                                           │
│  ┌─────────────────────────────────────────────────┐    │
│  │              Event Bus                          │    │
│  │  session.created → [Analytics, Metrics, ...]   │    │
│  └─────────────────────────────────────────────────┘    │
└───────────────────┬──────────────────────────────────────┘
                    │
┌───────────────────┴──────────────────────────────────────┐
│      Infrastructure Layer (Implementations)              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │IStateManager │  │IMessageBroker│  │IAuditStore   │  │
│  ├──────────────┤  ├──────────────┤  ├──────────────┤  │
│  │Redis Impl    │  │Redis Pub/Sub │  │PostgreSQL    │  │
│  │DynamoDB Impl │  │Kafka Impl    │  │MongoDB       │  │
│  │Memory Impl   │  │NATS Impl     │  │S3 (archive)  │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
└──────────────────────────────────────────────────────────┘
```

**Key Points:**
- Each layer only depends on layers below (no circular dependencies)
- Business logic doesn't know about Redis, Kafka, or HTTP
- Infrastructure is pluggable via interfaces
- Can swap any layer without affecting others

---

## Core Interfaces

### 1. State Management

```typescript
// src/domain/interfaces/IStateManager.ts

export interface SessionIdentifier {
  sessionId: string
  tenantId?: string  // For multi-tenancy
}

export interface IStateManager {
  // CRUD operations
  getSession(id: SessionIdentifier): Promise<SyncState | null>
  saveSession(id: SessionIdentifier, state: SyncState, options?: SaveOptions): Promise<void>
  deleteSession(id: SessionIdentifier): Promise<void>

  // Batch operations (performance)
  getSessions(ids: SessionIdentifier[]): Promise<Array<SyncState | null>>
  saveSessions(entries: Array<{ id: SessionIdentifier; state: SyncState }>): Promise<void>

  // Query operations
  listActiveSessions(tenantId?: string, limit?: number): Promise<SessionIdentifier[]>
  countSessions(filter?: SessionFilter): Promise<number>

  // Optimistic locking
  compareAndSwap(
    id: SessionIdentifier,
    expected: SyncState,
    updated: SyncState
  ): Promise<{ success: boolean; current?: SyncState }>

  // Lifecycle
  close(): Promise<void>
}

export interface SaveOptions {
  ttl?: number  // Time-to-live in seconds
  expectedVersion?: number  // For optimistic locking
  skipAudit?: boolean  // For performance-critical paths
}

export interface SessionFilter {
  status?: SessionStatus[]
  createdAfter?: Date
  tenantId?: string
}
```

**Implementations:**
- `RedisStateManager` - Production (hot data)
- `DynamoDBStateManager` - Multi-region (warm data)
- `CompositeStateManager` - Redis + DynamoDB fallback
- `InMemoryStateManager` - Testing/development
- `CachedStateManager` - Decorator for caching layer

---

### 2. Message Broker

```typescript
// src/domain/interfaces/IMessageBroker.ts

export interface Message<T = any> {
  id: string
  version: number  // Protocol version
  type: string
  topic: string
  payload: T
  timestamp: number
  metadata?: {
    tenantId?: string
    traceId?: string
    retryCount?: number
  }
}

export interface IMessageBroker {
  // Publish
  publish<T>(topic: string, message: Omit<Message<T>, 'id' | 'timestamp'>): Promise<void>
  publishBatch<T>(messages: Array<Omit<Message<T>, 'id' | 'timestamp'>>): Promise<void>

  // Subscribe
  subscribe<T>(
    topic: string,
    handler: (message: Message<T>) => Promise<void>,
    options?: SubscribeOptions
  ): Promise<Subscription>

  subscribePattern<T>(
    pattern: string,
    handler: (message: Message<T>) => Promise<void>
  ): Promise<Subscription>

  // Lifecycle
  close(): Promise<void>
}

export interface SubscribeOptions {
  group?: string  // Consumer group (for Kafka)
  deadLetterTopic?: string  // Failed messages go here
  maxRetries?: number
  backoff?: BackoffStrategy
}

export interface Subscription {
  unsubscribe(): Promise<void>
  pause(): void
  resume(): void
}

export interface BackoffStrategy {
  type: 'fixed' | 'exponential' | 'linear'
  initialDelay: number
  maxDelay?: number
}
```

**Implementations:**
- `RedisPubSubBroker` - Simple, fast, no guarantees
- `KafkaBroker` - Guaranteed delivery, replay, ordering
- `NATSBroker` - Lightweight, fast, at-most-once
- `InMemoryBroker` - Testing
- `HybridBroker` - Redis for speed, Kafka for audit

---

### 3. Sync Mode Plugin System

```typescript
// src/domain/interfaces/ISyncModePlugin.ts

export interface ISyncModePlugin {
  // Metadata
  readonly name: string  // 'per_participant', 'per_cycle', etc.
  readonly version: string
  readonly description: string

  // Lifecycle hooks
  onSessionCreate(config: SessionConfig): SessionCreateResult
  onSessionStart(state: SyncState): SessionStartResult
  onCycleSwitch(context: CycleSwitchContext): CycleSwitchResult
  onTimeout(context: TimeoutContext): TimeoutAction
  onSessionComplete(state: SyncState): SessionCompleteResult

  // Validation
  validateConfig(config: any): ValidationResult
  validateState(state: SyncState): ValidationResult

  // State extensions (optional)
  getCustomFields?(): Record<string, any>
  setCustomFields?(state: SyncState, fields: Record<string, any>): void

  // Time calculation (optional override)
  calculateTimeRemaining?(
    participant: Participant,
    now: Date,
    state: SyncState
  ): number
}

export interface CycleSwitchContext {
  state: SyncState
  fromParticipantId?: string
  toParticipantId?: string
  now: Date
  reason: 'manual' | 'timeout' | 'auto'
}

export interface CycleSwitchResult {
  updatedState: SyncState
  actions: Action[]  // Side effects (notifications, etc.)
  metadata?: any
}

export interface TimeoutAction {
  type: 'skip_cycle' | 'auto_action' | 'end_session' | 'custom'
  action?: string
  metadata?: any
}

export interface ValidationResult {
  valid: boolean
  errors?: Array<{ field: string; message: string }>
}
```

**Built-in Plugins:**
- `PerParticipantPlugin` - Each participant has own timer
- `PerCyclePlugin` - Fixed time per turn
- `PerGroupPlugin` - Team-based timers
- `GlobalPlugin` - Single countdown
- `CountUpPlugin` - Stopwatch mode

**Custom Plugin Example:**
```typescript
class TournamentPlugin implements ISyncModePlugin {
  name = 'tournament'
  version = '1.0.0'
  description = 'Chess tournament with Fischer time control'

  onCycleSwitch(context: CycleSwitchContext): CycleSwitchResult {
    // Custom logic: increment only after move 40
    const { state, fromParticipantId } = context
    const participant = state.participants.find(p => p.participant_id === fromParticipantId)

    if (participant && participant.cycle_count >= 40) {
      participant.total_time_ms += state.increment_ms
    }

    return { updatedState: state, actions: [] }
  }

  onTimeout(context: TimeoutContext): TimeoutAction {
    return { type: 'end_session', action: 'loss_by_timeout' }
  }

  validateConfig(config: any): ValidationResult {
    if (!config.increment_ms || config.increment_ms < 0) {
      return { valid: false, errors: [{ field: 'increment_ms', message: 'Must be positive' }] }
    }
    return { valid: true }
  }
}
```

---

### 4. Event System

```typescript
// src/domain/interfaces/IEventBus.ts

export interface DomainEvent {
  id: string
  version: number  // Event schema version
  type: string
  aggregateId: string  // sessionId
  aggregateType: 'session'
  timestamp: Date
  data: any
  metadata?: {
    tenantId?: string
    userId?: string
    traceId?: string
  }
}

export interface IEventBus {
  // Publish events
  publish(event: DomainEvent): Promise<void>
  publishBatch(events: DomainEvent[]): Promise<void>

  // Subscribe to events
  subscribe(
    eventType: string | string[],
    handler: IEventHandler
  ): Subscription

  // Lifecycle
  close(): Promise<void>
}

export interface IEventHandler {
  handle(event: DomainEvent): Promise<void>

  // Optional: Handle errors
  onError?(event: DomainEvent, error: Error): Promise<void>
}
```

**Event Types:**
```typescript
// Domain events (business-level)
type DomainEventType =
  | 'session.created'
  | 'session.started'
  | 'session.paused'
  | 'session.resumed'
  | 'session.completed'
  | 'session.cancelled'
  | 'cycle.switched'
  | 'participant.expired'
  | 'participant.added'
  | 'participant.removed'
```

**Event Handlers:**
```typescript
// Analytics
class AnalyticsEventHandler implements IEventHandler {
  async handle(event: DomainEvent): Promise<void> {
    // Send to analytics service (Mixpanel, Amplitude, etc.)
  }
}

// Metrics
class MetricsEventHandler implements IEventHandler {
  async handle(event: DomainEvent): Promise<void> {
    // Update Prometheus counters
    sessionCreatedCounter.inc()
  }
}

// Notifications
class NotificationEventHandler implements IEventHandler {
  async handle(event: DomainEvent): Promise<void> {
    if (event.type === 'participant.expired') {
      // Send push notification
    }
  }
}

// Custom business logic
class CustomWorkflowHandler implements IEventHandler {
  async handle(event: DomainEvent): Promise<void> {
    // User-defined logic
  }
}
```

---

### 5. Time Calculator

```typescript
// src/domain/interfaces/ITimeCalculator.ts

export interface ITimeCalculator {
  /**
   * Calculate elapsed time between two timestamps
   */
  calculateElapsed(started: Date, now: Date): number

  /**
   * Calculate remaining time for a participant
   */
  calculateRemaining(
    participant: Participant,
    state: SyncState,
    now: Date
  ): number

  /**
   * Apply time increment (e.g., Fischer increment)
   */
  applyIncrement(
    participant: Participant,
    increment: number
  ): void

  /**
   * Check if time has expired
   */
  hasExpired(participant: Participant): boolean

  /**
   * Get server time (for time synchronization)
   */
  getServerTime(): Date
}
```

**Implementations:**
- `StandardTimeCalculator` - System clock
- `MonotonicTimeCalculator` - Monotonic clock (doesn't go backward)
- `PauseableTimeCalculator` - Supports pause/resume
- `MockTimeCalculator` - For testing (controllable time)

---

## State Schema with Versioning

```typescript
// src/domain/models/SyncState.ts

// Base interface (common across versions)
export interface BaseSyncState {
  version: number  // Schema version
  sessionId: string
  tenantId?: string
  status: SessionStatus
  createdAt: Date
  updatedAt: Date
}

// Version 1 (current)
export interface SyncStateV1 extends BaseSyncState {
  version: 1
  syncMode: string  // Plugin name
  syncModeVersion: string
  participants: ParticipantV1[]
  activeParticipantId?: string
  activeGroupId?: string
  cycleStartedAt?: Date
  config: SessionConfigV1
  metadata: Record<string, any>
}

export interface ParticipantV1 {
  participantId: string
  groupId?: string
  participantIndex: number
  totalTimeMs: number
  timeUsedMs: number
  cycleCount: number
  isActive: boolean
  hasExpired: boolean
}

export interface SessionConfigV1 {
  timePerCycleMs?: number
  incrementMs: number
  maxTimeMs?: number
  actionOnTimeout?: TimeoutAction
  autoAdvance: boolean
}

// Version 2 (future - with extensions)
export interface SyncStateV2 extends BaseSyncState {
  version: 2
  syncMode: string
  syncModeVersion: string
  participants: ParticipantV2[]
  activeParticipantId?: string
  cycleStartedAt?: Date
  config: SessionConfigV2

  // NEW: Plugin-specific extensions
  extensions: {
    [pluginName: string]: any
  }

  // NEW: Audit trail
  history: StateChangeEvent[]
}

export interface ParticipantV2 extends ParticipantV1 {
  // NEW: Additional fields
  joinedAt: Date
  lastActiveAt: Date
  connectionStatus: 'connected' | 'disconnected'
}

export interface SessionConfigV2 extends SessionConfigV1 {
  // NEW: Additional config
  timezone?: string
  pausePolicy?: 'allow' | 'deny' | 'auto-pause'
}

// Type union for all versions
export type SyncState = SyncStateV1 | SyncStateV2

// Schema migration
export class StateMigrator {
  migrate(state: any): SyncState {
    if (!state.version || state.version === 1) {
      return state as SyncStateV1
    }

    if (state.version === 2) {
      return state as SyncStateV2
    }

    throw new Error(`Unsupported state version: ${state.version}`)
  }

  migrateV1ToV2(state: SyncStateV1): SyncStateV2 {
    return {
      ...state,
      version: 2,
      extensions: {},
      history: [],
      participants: state.participants.map(p => ({
        ...p,
        joinedAt: state.createdAt,
        lastActiveAt: state.updatedAt,
        connectionStatus: 'connected' as const
      }))
    }
  }
}
```

---

## Protocol Versioning

### WebSocket Protocol

```typescript
// Client → Server: Connection request
{
  "v": 1,  // Protocol version
  "type": "CONNECT",
  "sessionId": "uuid",
  "capabilities": ["reconnect", "compression", "state-sync"],
  "clientVersion": "1.5.0"
}

// Server → Client: Connection acknowledgment
{
  "v": 1,
  "type": "CONNECT_ACK",
  "features": ["reconnect", "state-sync"],  // Features server supports
  "serverVersion": "3.0.0",
  "minClientVersion": "1.0.0",
  "deprecationWarning": null
}

// Server → Client: State update
{
  "v": 1,
  "type": "STATE_UPDATE",
  "sessionId": "uuid",
  "timestamp": 1729435805123,
  "stateVersion": 1,  // State schema version
  "state": { ... }
}

// Client → Server: Reconnection with state sync
{
  "v": 1,
  "type": "RECONNECT",
  "sessionId": "uuid",
  "lastKnownVersion": 42,  // Optimistic locking version
  "reconnectAttempt": 3
}

// Server → Client: Full state sync
{
  "v": 1,
  "type": "STATE_SYNC",
  "sessionId": "uuid",
  "stateVersion": 1,
  "state": { ... }
}
```

### REST API Versioning

**URL-based:**
```
/v1/sessions
/v2/sessions
```

**Header-based:**
```
Accept: application/vnd.synckairos.v1+json
Content-Type: application/vnd.synckairos.v1+json
```

**Response with deprecation:**
```json
{
  "data": { ... },
  "meta": {
    "version": "v1",
    "deprecation": {
      "deprecated": true,
      "sunsetDate": "2026-01-01",
      "upgradeUrl": "https://docs.synckairos.io/migration/v1-to-v2"
    }
  }
}
```

---

## Configuration-Driven Architecture

```yaml
# config/production.yaml

# Server
server:
  port: 3000
  host: 0.0.0.0
  shutdownTimeout: 15000

# Storage configuration
storage:
  type: redis  # redis | dynamodb | composite | memory
  primary:
    type: redis
    url: ${REDIS_URL}
    ttl: 3600
    keyPrefix: "sk:"

  fallback:  # Optional
    type: dynamodb
    table: synckairos-sessions
    region: us-east-1

# Message broker
messaging:
  type: redis  # redis | kafka | nats | hybrid
  config:
    url: ${REDIS_URL}
    retries: 3
    backoff: exponential

# Audit store
audit:
  type: postgresql
  async: true
  queueName: db-writes
  retries: 5
  batchSize: 100

# Sync mode plugins
plugins:
  syncModes:
    - name: per_participant
      enabled: true
      default: true

    - name: per_cycle
      enabled: true

    - name: tournament
      enabled: true
      path: ./plugins/tournament.js
      config:
        minIncrementMs: 1000

  eventHandlers:
    - name: analytics
      enabled: true
      path: ./plugins/analytics.js

    - name: metrics
      enabled: true
      builtin: true

# Features
features:
  sessionRecovery: true
  optimisticLocking: true
  multiTenancy: false
  compression: true

  rateLimiting:
    enabled: true
    perSession:
      switchCycle: 10  # per second
    perUser:
      createSession: 5  # per minute

  timeSync:
    enabled: true
    samples: 5
    maxLatency: 500
    clockSkewThreshold: 60000

# Monitoring
monitoring:
  metrics:
    enabled: true
    port: 9091
    path: /metrics

  tracing:
    enabled: true
    serviceName: synckairos
    endpoint: ${JAEGER_ENDPOINT}

# Multi-tenancy (future)
tenancy:
  enabled: false
  isolation: database  # database | schema | row
```

---

## Dependency Injection Container

```typescript
// src/container.ts

import { Container } from 'inversify'
import { Config } from './config'

export function createContainer(config: Config): Container {
  const container = new Container()

  // Configuration
  container.bind<Config>(TYPES.Config).toConstantValue(config)

  // Infrastructure layer
  container.bind<IStateManager>(TYPES.StateManager)
    .toDynamicValue((context) => {
      const cfg = context.container.get<Config>(TYPES.Config)

      switch (cfg.storage.type) {
        case 'redis':
          return new RedisStateManager(cfg.storage.primary)
        case 'dynamodb':
          return new DynamoDBStateManager(cfg.storage.primary)
        case 'composite':
          return new CompositeStateManager(
            new RedisStateManager(cfg.storage.primary),
            new DynamoDBStateManager(cfg.storage.fallback!)
          )
        case 'memory':
          return new InMemoryStateManager()
        default:
          throw new Error(`Unknown storage type: ${cfg.storage.type}`)
      }
    })
    .inSingletonScope()

  container.bind<IMessageBroker>(TYPES.MessageBroker)
    .toDynamicValue((context) => {
      const cfg = context.container.get<Config>(TYPES.Config)

      switch (cfg.messaging.type) {
        case 'redis':
          return new RedisPubSubBroker(cfg.messaging.config)
        case 'kafka':
          return new KafkaBroker(cfg.messaging.config)
        case 'nats':
          return new NATSBroker(cfg.messaging.config)
        default:
          throw new Error(`Unknown broker type: ${cfg.messaging.type}`)
      }
    })
    .inSingletonScope()

  // Domain layer
  container.bind<SyncModeRegistry>(TYPES.SyncModeRegistry)
    .toDynamicValue((context) => {
      const cfg = context.container.get<Config>(TYPES.Config)
      const registry = new SyncModeRegistry()

      // Load enabled plugins
      cfg.plugins.syncModes
        .filter(p => p.enabled)
        .forEach(p => {
          const plugin = loadPlugin(p)
          registry.register(plugin)
        })

      return registry
    })
    .inSingletonScope()

  container.bind<IEventBus>(TYPES.EventBus)
    .to(EventBus)
    .inSingletonScope()

  container.bind<ITimeCalculator>(TYPES.TimeCalculator)
    .to(StandardTimeCalculator)
    .inSingletonScope()

  // Application layer
  container.bind<SessionService>(TYPES.SessionService)
    .to(SessionService)
    .inSingletonScope()

  container.bind<SyncEngine>(TYPES.SyncEngine)
    .to(SyncEngine)
    .inSingletonScope()

  return container
}
```

---

## Testing Strategy

### Contract Testing for Interfaces

```typescript
// tests/contracts/IStateManager.contract.test.ts

export function testIStateManagerContract(
  createManager: () => IStateManager,
  cleanup?: () => Promise<void>
) {
  let manager: IStateManager

  beforeEach(async () => {
    manager = createManager()
  })

  afterEach(async () => {
    await manager.close()
    if (cleanup) await cleanup()
  })

  describe('IStateManager Contract', () => {
    test('getSession returns null for non-existent session', async () => {
      const result = await manager.getSession({ sessionId: 'non-existent' })
      expect(result).toBeNull()
    })

    test('saveSession and getSession roundtrip', async () => {
      const state: SyncStateV1 = {
        version: 1,
        sessionId: 'test-123',
        syncMode: 'per_participant',
        // ... full state
      }

      await manager.saveSession({ sessionId: 'test-123' }, state)
      const retrieved = await manager.getSession({ sessionId: 'test-123' })

      expect(retrieved).toEqual(state)
    })

    test('compareAndSwap succeeds with correct version', async () => {
      // ... test optimistic locking
    })

    test('compareAndSwap fails with wrong version', async () => {
      // ... test conflict detection
    })

    // ... 30+ tests defining the contract
  })
}

// Test each implementation
describe('RedisStateManager', () => {
  testIStateManagerContract(
    () => new RedisStateManager(testRedisUrl),
    async () => { /* cleanup Redis */ }
  )
})

describe('DynamoDBStateManager', () => {
  testIStateManagerContract(
    () => new DynamoDBStateManager(testConfig),
    async () => { /* cleanup DynamoDB */ }
  )
})

describe('InMemoryStateManager', () => {
  testIStateManagerContract(
    () => new InMemoryStateManager()
  )
})
```

### Plugin Testing

```typescript
// tests/plugins/syncMode.test.ts

export function testISyncModePluginContract(plugin: ISyncModePlugin) {
  describe(`${plugin.name} Plugin Contract`, () => {
    test('has required metadata', () => {
      expect(plugin.name).toBeTruthy()
      expect(plugin.version).toMatch(/^\d+\.\d+\.\d+$/)
      expect(plugin.description).toBeTruthy()
    })

    test('validateConfig accepts valid config', () => {
      const validConfig = { /* ... */ }
      const result = plugin.validateConfig(validConfig)
      expect(result.valid).toBe(true)
    })

    test('validateConfig rejects invalid config', () => {
      const invalidConfig = { /* ... */ }
      const result = plugin.validateConfig(invalidConfig)
      expect(result.valid).toBe(false)
      expect(result.errors).toBeDefined()
    })

    // ... more contract tests
  })
}

// Test each plugin
describe('PerParticipantPlugin', () => {
  testISyncModePluginContract(new PerParticipantPlugin())
})

describe('TournamentPlugin', () => {
  testISyncModePluginContract(new TournamentPlugin())
})
```

---

## Migration from v2.0 to v3.0

### Phase 1: Add Interfaces (Backward Compatible)

```typescript
// Old code still works
const engine = new SyncEngine(new RedisStateManager(url))

// New code (recommended)
const stateManager: IStateManager = new RedisStateManager(url)
const engine = new SyncEngine(stateManager)
```

### Phase 2: Introduce Adapters

```typescript
// Adapter for backward compatibility
class LegacyRedisStateManager extends RedisStateManager implements IStateManager {
  // Implements new interface while maintaining old behavior
}
```

### Phase 3: Deprecation Warnings

```typescript
// @deprecated Use IStateManager interface instead
class RedisStateManager {
  constructor() {
    console.warn('DEPRECATED: Use factory or DI container instead of direct instantiation')
  }
}
```

### Phase 4: Remove Legacy (v4.0)

After 6 months deprecation period, remove old APIs.

---

## Benefits Summary

### Immediate (Week 1)
✅ Clean architecture from the start
✅ Easy to test (mock interfaces)
✅ No technical debt

### Short-term (Month 1-3)
✅ Add new sync modes without core changes
✅ Swap storage backends for testing/development
✅ Plugin ecosystem for extensibility

### Medium-term (Month 4-12)
✅ Multi-tenancy without rewrite
✅ Support Kafka for guaranteed delivery
✅ GraphQL/gRPC alongside REST
✅ Cost optimization (different storage tiers)

### Long-term (Year 2+)
✅ Plugin marketplace
✅ Zero-downtime schema migrations
✅ Multi-region active-active
✅ Third-party integrations

---

## Comparison: v2.0 vs v3.0

| Aspect | v2.0 (Current) | v3.0 (Proposed) |
|--------|----------------|-----------------|
| Storage | Hard-coded Redis | Interface (any backend) |
| Messaging | Hard-coded Redis Pub/Sub | Interface (Kafka/NATS/etc) |
| Sync Modes | Enum (5 modes) | Plugin system (unlimited) |
| Extensibility | Fork required | Plugin system |
| Protocol | No versioning | Versioned from day 1 |
| Testing | Requires Redis | Fully mockable |
| Configuration | Env vars only | Config-driven (YAML) |
| Multi-tenancy | Not supported | Ready for multi-tenancy |
| Migration | Breaking changes | Backward compatible |
| Time to market | 4-6 weeks | 6-8 weeks (+33%) |
| Technical debt | Moderate | Minimal |
| Future changes | Costly refactors | Cheap extensions |

---

## Recommendation

**Adopt v3.0 architecture before writing any code.**

**Why:**
1. ✅ Only +2 weeks of design time
2. ✅ Saves months of refactoring later
3. ✅ Enables features impossible in v2.0
4. ✅ Professional, enterprise-grade architecture
5. ✅ Easy to test and maintain

**ROI:**
- 2 weeks investment now
- Saves 3-6 months refactoring in year 1
- **ROI: 6x-12x**

---

## Next Steps

1. **Review & Approve** v3.0 proposal
2. **Update Documentation** (ARCHITECTURE.md, IMPLEMENTATION.md)
3. **Start Implementation** with interfaces first
4. **Build Core Plugins** (5 sync modes)
5. **Implement Infrastructure** (Redis, Kafka options)
6. **Testing** (contract tests, integration tests)
7. **Deployment** (PaaS with config management)

**Estimated Timeline:**
- Design finalization: 1 week
- Interface implementation: 2 weeks
- Plugin system: 2 weeks
- Infrastructure: 2 weeks
- Testing & docs: 1 week
- **Total: 8 weeks**

vs. v2.0 implementation (6 weeks) + future refactor (12 weeks) = **18 weeks total**

**v3.0 saves 10 weeks over the lifetime of the project.**
