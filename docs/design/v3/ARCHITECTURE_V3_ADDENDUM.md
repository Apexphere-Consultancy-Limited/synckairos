# SyncKairos Architecture v3.0 - Design Addendum

**Version:** 3.0
**Date:** 2025-10-20
**Status:** Design Phase - Additional Considerations
**Related:** ARCHITECTURE_V3_PROPOSAL.md

---

## Executive Summary

This document addresses **critical considerations** missing from the v3.0 proposal that must be resolved before implementation. These are not flaws, but important design decisions that need explicit choices.

---

## 1. Transaction and Consistency Model

### Problem

The v3.0 proposal shows interfaces but doesn't specify the consistency model for distributed operations.

**Key Questions:**
- What happens if Redis write succeeds but Pub/Sub fails?
- What happens if a state update succeeds but event bus publish fails?
- How do we ensure atomicity across multiple state changes?
- What's our CAP theorem position? (Consistency vs Availability)

### Proposed Solution: Eventual Consistency with Compensating Actions

```typescript
// src/domain/interfaces/ITransactionCoordinator.ts

export interface TransactionResult<T> {
  success: boolean
  data?: T
  compensations?: CompensatingAction[]
  error?: Error
}

export interface CompensatingAction {
  name: string
  execute: () => Promise<void>
  maxRetries: number
}

export interface ITransactionCoordinator {
  /**
   * Execute operation with compensating actions on failure
   */
  executeWithCompensation<T>(
    operation: () => Promise<T>,
    compensations: CompensatingAction[]
  ): Promise<TransactionResult<T>>

  /**
   * Execute multiple operations as a saga
   */
  executeSaga<T>(steps: SagaStep<T>[]): Promise<TransactionResult<T>>
}

export interface SagaStep<T> {
  name: string
  forward: () => Promise<T>
  compensate: () => Promise<void>
}

// Example usage in SyncEngine
export class SyncEngine {
  constructor(
    private stateManager: IStateManager,
    private messageBroker: IMessageBroker,
    private eventBus: IEventBus,
    private coordinator: ITransactionCoordinator
  ) {}

  async switchCycle(sessionId: string, nextParticipantId: string): Promise<void> {
    const result = await this.coordinator.executeSaga([
      {
        name: 'update-state',
        forward: async () => {
          const state = await this.stateManager.getSession({ sessionId })
          // ... update logic
          await this.stateManager.saveSession({ sessionId }, updatedState)
          return updatedState
        },
        compensate: async () => {
          // Rollback to previous state
          await this.stateManager.saveSession({ sessionId }, previousState)
        }
      },
      {
        name: 'publish-message',
        forward: async () => {
          await this.messageBroker.publish('session-updates', {
            type: 'STATE_UPDATE',
            version: 1,
            payload: updatedState
          })
        },
        compensate: async () => {
          // Publish rollback event
          await this.messageBroker.publish('session-updates', {
            type: 'STATE_ROLLBACK',
            version: 1,
            payload: { sessionId }
          })
        }
      },
      {
        name: 'emit-event',
        forward: async () => {
          await this.eventBus.publish({
            id: uuid(),
            version: 1,
            type: 'cycle.switched',
            aggregateId: sessionId,
            aggregateType: 'session',
            timestamp: new Date(),
            data: { nextParticipantId }
          })
        },
        compensate: async () => {
          // Event bus compensations are typically logged only
          console.warn('Event bus compensation triggered')
        }
      }
    ])

    if (!result.success) {
      throw new Error(`Cycle switch failed: ${result.error}`)
    }
  }
}
```

**Decision Required:**
- [ ] Accept eventual consistency with sagas/compensations
- [ ] Require strong consistency (performance impact)
- [ ] Hybrid: strong consistency for state, eventual for events

---

## 2. Cross-Cutting Concerns

### Problem

v3.0 proposal doesn't address how cross-cutting concerns are handled.

**Missing Patterns:**
- Distributed tracing
- Structured logging
- Error handling strategy
- Retry policies
- Circuit breakers
- Request correlation

### Proposed Solution: Middleware/Interceptor Pattern

```typescript
// src/domain/interfaces/IMiddleware.ts

export interface ExecutionContext {
  operationName: string
  sessionId?: string
  tenantId?: string
  traceId: string
  startTime: Date
  metadata: Record<string, any>
}

export interface IMiddleware {
  readonly name: string
  readonly order: number  // Execution order (lower = earlier)

  before(context: ExecutionContext): Promise<void>
  after(context: ExecutionContext, result: any): Promise<void>
  onError(context: ExecutionContext, error: Error): Promise<void>
}

// Built-in middleware
export class TracingMiddleware implements IMiddleware {
  name = 'tracing'
  order = 1

  async before(context: ExecutionContext): Promise<void> {
    // Start span
    const span = tracer.startSpan(context.operationName, {
      traceId: context.traceId,
      tags: { sessionId: context.sessionId }
    })
    context.metadata.span = span
  }

  async after(context: ExecutionContext, result: any): Promise<void> {
    // End span
    context.metadata.span?.finish()
  }

  async onError(context: ExecutionContext, error: Error): Promise<void> {
    context.metadata.span?.setTag('error', true)
    context.metadata.span?.log({ event: 'error', message: error.message })
    context.metadata.span?.finish()
  }
}

export class LoggingMiddleware implements IMiddleware {
  name = 'logging'
  order = 2

  async before(context: ExecutionContext): Promise<void> {
    logger.info({
      operation: context.operationName,
      sessionId: context.sessionId,
      traceId: context.traceId,
      timestamp: context.startTime
    })
  }

  async after(context: ExecutionContext, result: any): Promise<void> {
    const duration = Date.now() - context.startTime.getTime()
    logger.info({
      operation: context.operationName,
      sessionId: context.sessionId,
      traceId: context.traceId,
      duration,
      status: 'success'
    })
  }

  async onError(context: ExecutionContext, error: Error): Promise<void> {
    const duration = Date.now() - context.startTime.getTime()
    logger.error({
      operation: context.operationName,
      sessionId: context.sessionId,
      traceId: context.traceId,
      duration,
      status: 'error',
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack
      }
    })
  }
}

export class MetricsMiddleware implements IMiddleware {
  name = 'metrics'
  order = 3

  async before(context: ExecutionContext): Promise<void> {
    operationCounter.inc({ operation: context.operationName })
  }

  async after(context: ExecutionContext, result: any): Promise<void> {
    const duration = Date.now() - context.startTime.getTime()
    operationDuration.observe({ operation: context.operationName }, duration)
  }

  async onError(context: ExecutionContext, error: Error): Promise<void> {
    operationErrors.inc({
      operation: context.operationName,
      errorType: error.constructor.name
    })
  }
}

export class CircuitBreakerMiddleware implements IMiddleware {
  name = 'circuit-breaker'
  order = 0  // Run first

  private breakers = new Map<string, CircuitBreaker>()

  async before(context: ExecutionContext): Promise<void> {
    const breaker = this.getBreaker(context.operationName)

    if (breaker.isOpen()) {
      throw new Error(`Circuit breaker open for ${context.operationName}`)
    }
  }

  async after(context: ExecutionContext, result: any): Promise<void> {
    this.getBreaker(context.operationName).recordSuccess()
  }

  async onError(context: ExecutionContext, error: Error): Promise<void> {
    this.getBreaker(context.operationName).recordFailure()
  }

  private getBreaker(key: string): CircuitBreaker {
    if (!this.breakers.has(key)) {
      this.breakers.set(key, new CircuitBreaker({ threshold: 5, timeout: 60000 }))
    }
    return this.breakers.get(key)!
  }
}

// Middleware executor
export class MiddlewareExecutor {
  private middlewares: IMiddleware[] = []

  use(middleware: IMiddleware): void {
    this.middlewares.push(middleware)
    this.middlewares.sort((a, b) => a.order - b.order)
  }

  async execute<T>(
    operationName: string,
    operation: (context: ExecutionContext) => Promise<T>,
    metadata?: Record<string, any>
  ): Promise<T> {
    const context: ExecutionContext = {
      operationName,
      traceId: uuid(),
      startTime: new Date(),
      metadata: { ...metadata }
    }

    try {
      // Before hooks
      for (const mw of this.middlewares) {
        await mw.before(context)
      }

      // Execute operation
      const result = await operation(context)

      // After hooks (reverse order)
      for (const mw of [...this.middlewares].reverse()) {
        await mw.after(context, result)
      }

      return result
    } catch (error) {
      // Error hooks (reverse order)
      for (const mw of [...this.middlewares].reverse()) {
        await mw.onError(context, error as Error)
      }

      throw error
    }
  }
}

// Usage in application
const executor = new MiddlewareExecutor()
executor.use(new CircuitBreakerMiddleware())
executor.use(new TracingMiddleware())
executor.use(new LoggingMiddleware())
executor.use(new MetricsMiddleware())

// Wrap operations
await executor.execute('switchCycle', async (context) => {
  context.metadata.sessionId = sessionId
  return await engine.switchCycle(sessionId, nextParticipantId)
})
```

**Decision Required:**
- [ ] Adopt middleware pattern for cross-cutting concerns
- [ ] Use decorator pattern instead
- [ ] Implement aspect-oriented programming (AOP)

---

## 3. Data Migration and Backward Compatibility

### Problem

v3.0 mentions migration but doesn't provide concrete strategy for:
- Zero-downtime deployments during schema changes
- Rolling back deployments if issues occur
- Supporting multiple versions in production simultaneously

### Proposed Solution: Blue-Green Deployment with Feature Flags

```typescript
// src/domain/interfaces/IFeatureFlag.ts

export interface IFeatureFlag {
  isEnabled(flagName: string, context?: FeatureFlagContext): Promise<boolean>
  getVariant(flagName: string, context?: FeatureFlagContext): Promise<string>
}

export interface FeatureFlagContext {
  tenantId?: string
  userId?: string
  sessionId?: string
  percentageRollout?: number
}

// Usage in code
export class SessionService {
  constructor(
    private stateManager: IStateManager,
    private featureFlags: IFeatureFlag
  ) {}

  async getSession(id: SessionIdentifier): Promise<SyncState | null> {
    const useV2Schema = await this.featureFlags.isEnabled('use-state-schema-v2', {
      tenantId: id.tenantId,
      percentageRollout: 10  // Gradual rollout to 10% of users
    })

    const state = await this.stateManager.getSession(id)

    if (!state) return null

    // Migrate on read if needed
    if (useV2Schema && state.version === 1) {
      return this.migrator.migrateV1ToV2(state as SyncStateV1)
    }

    return state
  }

  async saveSession(id: SessionIdentifier, state: SyncState): Promise<void> {
    const useV2Schema = await this.featureFlags.isEnabled('use-state-schema-v2', {
      tenantId: id.tenantId
    })

    // Write in new format only if feature enabled
    const stateToWrite = useV2Schema ? state : this.migrator.downgradeV2ToV1(state)

    await this.stateManager.saveSession(id, stateToWrite)
  }
}

// Deployment strategy
// Step 1: Deploy with feature flag OFF (0% rollout)
// Step 2: Enable for 1% of users
// Step 3: Monitor metrics, errors, performance
// Step 4: Gradually increase to 10%, 25%, 50%, 100%
// Step 5: Remove feature flag code after full rollout
```

**Migration Phases:**
```typescript
// config/production.yaml
features:
  stateSchemaV2:
    enabled: true
    rollout:
      strategy: percentage
      percentage: 10
      whitelist:
        - tenant-123
        - tenant-456
      blacklist:
        - tenant-789

  kafkaMessageBroker:
    enabled: false  # Not yet ready

  compositeStor:
    enabled: true
    rollout:
      strategy: tenant
      tenants:
        - enterprise-client-1
```

**Decision Required:**
- [ ] Adopt feature flags for gradual rollout
- [ ] Use canary deployments only
- [ ] Require full cutover (downtime required)

---

## 4. Error Handling and Recovery

### Problem

v3.0 doesn't specify error handling strategy:
- What errors are retryable vs fatal?
- How do we classify errors?
- How do we recover from partial failures?
- How do we communicate errors to clients?

### Proposed Solution: Typed Error Hierarchy

```typescript
// src/domain/errors/DomainErrors.ts

export abstract class DomainError extends Error {
  abstract readonly code: string
  abstract readonly statusCode: number
  abstract readonly retryable: boolean

  constructor(
    message: string,
    public readonly context?: Record<string, any>
  ) {
    super(message)
    this.name = this.constructor.name
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      context: this.context
    }
  }
}

// Business logic errors
export class SessionNotFoundError extends DomainError {
  code = 'SESSION_NOT_FOUND'
  statusCode = 404
  retryable = false
}

export class InvalidSessionStateError extends DomainError {
  code = 'INVALID_SESSION_STATE'
  statusCode = 400
  retryable = false
}

export class ConcurrentModificationError extends DomainError {
  code = 'CONCURRENT_MODIFICATION'
  statusCode = 409
  retryable = true  // Client should retry
}

export class ParticipantExpiredError extends DomainError {
  code = 'PARTICIPANT_EXPIRED'
  statusCode = 400
  retryable = false
}

// Infrastructure errors
export class StorageUnavailableError extends DomainError {
  code = 'STORAGE_UNAVAILABLE'
  statusCode = 503
  retryable = true
}

export class MessageBrokerError extends DomainError {
  code = 'MESSAGE_BROKER_ERROR'
  statusCode = 503
  retryable = true
}

export class NetworkTimeoutError extends DomainError {
  code = 'NETWORK_TIMEOUT'
  statusCode = 504
  retryable = true
}

// Rate limiting
export class RateLimitExceededError extends DomainError {
  code = 'RATE_LIMIT_EXCEEDED'
  statusCode = 429
  retryable = true

  constructor(
    message: string,
    public readonly retryAfter: number  // seconds
  ) {
    super(message)
  }
}

// Error recovery strategy
export class ErrorRecoveryStrategy {
  async execute<T>(
    operation: () => Promise<T>,
    options: RecoveryOptions = {}
  ): Promise<T> {
    const {
      maxRetries = 3,
      backoff = 'exponential',
      timeout = 5000
    } = options

    let lastError: Error

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.withTimeout(operation(), timeout)
      } catch (error) {
        lastError = error as Error

        // Don't retry if error is not retryable
        if (error instanceof DomainError && !error.retryable) {
          throw error
        }

        // Last attempt - throw error
        if (attempt === maxRetries) {
          throw error
        }

        // Calculate backoff delay
        const delay = this.calculateBackoff(attempt, backoff)
        await this.sleep(delay)
      }
    }

    throw lastError!
  }

  private calculateBackoff(attempt: number, strategy: 'fixed' | 'linear' | 'exponential'): number {
    switch (strategy) {
      case 'fixed':
        return 1000
      case 'linear':
        return attempt * 1000
      case 'exponential':
        return Math.min(Math.pow(2, attempt) * 1000, 30000)
    }
  }

  private async withTimeout<T>(promise: Promise<T>, timeout: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new NetworkTimeoutError('Operation timed out')), timeout)
      )
    ])
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

// Usage
const recovery = new ErrorRecoveryStrategy()

await recovery.execute(
  async () => await stateManager.getSession({ sessionId }),
  { maxRetries: 3, backoff: 'exponential', timeout: 5000 }
)
```

**Decision Required:**
- [ ] Adopt typed error hierarchy
- [ ] Use generic error codes only
- [ ] Let infrastructure errors bubble up

---

## 5. Performance Monitoring and SLOs

### Problem

v3.0 doesn't specify:
- Service Level Objectives (SLOs)
- Service Level Indicators (SLIs)
- How to measure and alert on performance

### Proposed Solution: SLO-Driven Monitoring

```typescript
// src/monitoring/slo.ts

export interface SLO {
  name: string
  description: string
  target: number  // Percentage (e.g., 99.9 = 99.9%)
  window: number  // Time window in seconds
  metric: SLI
}

export interface SLI {
  measure(): Promise<number>  // Returns current value
}

// Example SLIs
export class LatencySLI implements SLI {
  constructor(
    private operationName: string,
    private percentile: number = 99
  ) {}

  async measure(): Promise<number> {
    // Query metrics backend for p99 latency
    return await metrics.getPercentile(this.operationName, this.percentile)
  }
}

export class AvailabilitySLI implements SLI {
  constructor(private serviceName: string) {}

  async measure(): Promise<number> {
    const total = await metrics.getTotalRequests(this.serviceName)
    const errors = await metrics.getErrorRequests(this.serviceName)
    return ((total - errors) / total) * 100
  }
}

// Define SLOs
const slos: SLO[] = [
  {
    name: 'switchCycle-latency',
    description: 'Cycle switch p99 latency < 50ms',
    target: 99.9,
    window: 300,  // 5 minutes
    metric: new LatencySLI('switchCycle', 99)
  },
  {
    name: 'service-availability',
    description: 'Service availability > 99.9%',
    target: 99.9,
    window: 3600,  // 1 hour
    metric: new AvailabilitySLI('synckairos')
  },
  {
    name: 'getCurrentState-latency',
    description: 'Get state p99 latency < 10ms',
    target: 99.9,
    window: 300,
    metric: new LatencySLI('getCurrentState', 99)
  }
]

// SLO monitoring
export class SLOMonitor {
  async checkSLOs(): Promise<SLOReport[]> {
    const reports: SLOReport[] = []

    for (const slo of slos) {
      const current = await slo.metric.measure()
      const met = current >= slo.target

      reports.push({
        name: slo.name,
        target: slo.target,
        current,
        met,
        errorBudget: this.calculateErrorBudget(slo, current)
      })

      if (!met) {
        await this.alert(slo, current)
      }
    }

    return reports
  }

  private calculateErrorBudget(slo: SLO, current: number): number {
    // Error budget = (target - current) / (100 - target)
    return ((slo.target - current) / (100 - slo.target)) * 100
  }

  private async alert(slo: SLO, current: number): Promise<void> {
    // Send alert to PagerDuty, Slack, etc.
    console.error(`SLO violation: ${slo.name} - Target: ${slo.target}%, Current: ${current}%`)
  }
}
```

**Decision Required:**
- [ ] Define explicit SLOs for all operations
- [ ] Use informal performance targets only
- [ ] Wait until production to define SLOs

---

## 6. Security Considerations

### Problem

v3.0 doesn't address security:
- Authentication and authorization
- Input validation
- Rate limiting per tenant/user
- Audit logging for compliance
- Sensitive data handling

### Proposed Solution: Security Layer

```typescript
// src/security/interfaces.ts

export interface IAuthenticationService {
  authenticate(credentials: any): Promise<AuthenticationResult>
  validateToken(token: string): Promise<TokenPayload>
}

export interface IAuthorizationService {
  authorize(
    subject: Subject,
    action: Action,
    resource: Resource
  ): Promise<boolean>
}

export interface Subject {
  userId: string
  tenantId?: string
  roles: string[]
}

export interface Action {
  type: 'create' | 'read' | 'update' | 'delete'
  resource: string  // 'session', 'participant'
}

export interface Resource {
  type: string
  id: string
  tenantId?: string
}

// Example authorization policies
export class SessionAuthorizationService implements IAuthorizationService {
  async authorize(subject: Subject, action: Action, resource: Resource): Promise<boolean> {
    // Multi-tenancy: Users can only access their tenant's sessions
    if (resource.tenantId && resource.tenantId !== subject.tenantId) {
      return false
    }

    // Role-based access control
    if (action.type === 'delete' && !subject.roles.includes('admin')) {
      return false
    }

    // All authenticated users can read/update sessions
    if (['read', 'update'].includes(action.type)) {
      return true
    }

    return false
  }
}

// Input validation
export class InputValidator {
  static validateSessionConfig(config: any): ValidationResult {
    const errors: string[] = []

    if (config.incrementMs < 0) {
      errors.push('incrementMs must be non-negative')
    }

    if (config.maxTimeMs && config.maxTimeMs < 1000) {
      errors.push('maxTimeMs must be at least 1000ms')
    }

    // Prevent resource exhaustion
    if (config.participants && config.participants.length > 1000) {
      errors.push('Maximum 1000 participants allowed')
    }

    return {
      valid: errors.length === 0,
      errors
    }
  }
}

// Audit logging for compliance
export interface IAuditLogger {
  log(event: AuditEvent): Promise<void>
}

export interface AuditEvent {
  timestamp: Date
  userId: string
  tenantId?: string
  action: string
  resource: string
  resourceId: string
  success: boolean
  metadata?: Record<string, any>
}

// Usage in application
export class SecureSessionService {
  constructor(
    private sessionService: SessionService,
    private authorization: IAuthorizationService,
    private auditLogger: IAuditLogger
  ) {}

  async switchCycle(
    subject: Subject,
    sessionId: string,
    nextParticipantId: string
  ): Promise<void> {
    // Authorization check
    const authorized = await this.authorization.authorize(
      subject,
      { type: 'update', resource: 'session' },
      { type: 'session', id: sessionId, tenantId: subject.tenantId }
    )

    if (!authorized) {
      await this.auditLogger.log({
        timestamp: new Date(),
        userId: subject.userId,
        tenantId: subject.tenantId,
        action: 'switchCycle',
        resource: 'session',
        resourceId: sessionId,
        success: false,
        metadata: { reason: 'unauthorized' }
      })

      throw new Error('Unauthorized')
    }

    try {
      // Execute operation
      await this.sessionService.switchCycle(sessionId, nextParticipantId)

      // Audit log success
      await this.auditLogger.log({
        timestamp: new Date(),
        userId: subject.userId,
        tenantId: subject.tenantId,
        action: 'switchCycle',
        resource: 'session',
        resourceId: sessionId,
        success: true
      })
    } catch (error) {
      // Audit log failure
      await this.auditLogger.log({
        timestamp: new Date(),
        userId: subject.userId,
        tenantId: subject.tenantId,
        action: 'switchCycle',
        resource: 'session',
        resourceId: sessionId,
        success: false,
        metadata: { error: (error as Error).message }
      })

      throw error
    }
  }
}
```

**Decision Required:**
- [ ] Implement comprehensive security layer
- [ ] Delegate security to API gateway
- [ ] Mix of both (gateway + application-level)

---

## 7. Testing Strategy Details

### Problem

v3.0 mentions contract testing but doesn't cover:
- Integration testing strategy
- Performance testing approach
- Chaos engineering for resilience
- Load testing methodology

### Proposed Solution: Comprehensive Testing Pyramid

```typescript
// tests/integration/session-lifecycle.test.ts

describe('Session Lifecycle Integration Tests', () => {
  let container: Container
  let sessionService: SessionService
  let redis: Redis
  let db: PostgresDatabase

  beforeAll(async () => {
    // Spin up test infrastructure
    redis = await startTestRedis()
    db = await startTestPostgres()

    // Create container with test implementations
    container = createTestContainer({
      redis: redis.url,
      db: db.connectionString
    })

    sessionService = container.get(SessionService)
  })

  afterAll(async () => {
    await redis.stop()
    await db.stop()
  })

  test('complete session lifecycle', async () => {
    // Create session
    const session = await sessionService.createSession({
      syncMode: 'per_participant',
      participants: ['player1', 'player2'],
      totalTimeMs: 60000
    })

    // Start session
    await sessionService.startSession(session.sessionId)

    // Switch cycles
    await sessionService.switchCycle(session.sessionId, 'player2')
    await sessionService.switchCycle(session.sessionId, 'player1')

    // Verify state in Redis
    const redisState = await redis.get(`session:${session.sessionId}`)
    expect(JSON.parse(redisState).activeParticipantId).toBe('player1')

    // Complete session
    await sessionService.completeSession(session.sessionId)

    // Eventually: Verify audit in PostgreSQL
    await eventually(async () => {
      const events = await db.query('SELECT * FROM sync_events WHERE session_id = $1', [session.sessionId])
      expect(events.rows.length).toBeGreaterThan(0)
    }, { timeout: 5000 })
  })

  test('concurrent cycle switches with optimistic locking', async () => {
    const session = await sessionService.createSession({
      syncMode: 'per_participant',
      participants: ['player1', 'player2']
    })

    await sessionService.startSession(session.sessionId)

    // Simulate concurrent updates
    const promises = [
      sessionService.switchCycle(session.sessionId, 'player2'),
      sessionService.switchCycle(session.sessionId, 'player1')
    ]

    // One should succeed, one should fail with ConcurrentModificationError
    const results = await Promise.allSettled(promises)

    const successes = results.filter(r => r.status === 'fulfilled')
    const failures = results.filter(r => r.status === 'rejected')

    expect(successes.length).toBe(1)
    expect(failures.length).toBe(1)
  })
})

// tests/performance/load-test.ts

describe('Performance Load Tests', () => {
  test('sustain 10,000 concurrent sessions', async () => {
    const sessionIds: string[] = []

    // Create 10,000 sessions
    for (let i = 0; i < 10000; i++) {
      const session = await sessionService.createSession({
        syncMode: 'per_participant',
        participants: ['p1', 'p2']
      })
      sessionIds.push(session.sessionId)
    }

    // Perform concurrent cycle switches
    const startTime = Date.now()

    await Promise.all(
      sessionIds.map(id => sessionService.switchCycle(id, 'p2'))
    )

    const duration = Date.now() - startTime
    const avgLatency = duration / sessionIds.length

    expect(avgLatency).toBeLessThan(50)  // < 50ms average
  })

  test('p99 latency under load', async () => {
    const session = await sessionService.createSession({
      syncMode: 'per_participant',
      participants: ['p1', 'p2']
    })

    await sessionService.startSession(session.sessionId)

    const latencies: number[] = []

    // Perform 1000 operations
    for (let i = 0; i < 1000; i++) {
      const start = Date.now()
      await sessionService.switchCycle(
        session.sessionId,
        i % 2 === 0 ? 'p2' : 'p1'
      )
      const latency = Date.now() - start
      latencies.push(latency)
    }

    latencies.sort((a, b) => a - b)
    const p99 = latencies[Math.floor(latencies.length * 0.99)]

    expect(p99).toBeLessThan(50)
  })
})

// tests/chaos/resilience.test.ts

describe('Chaos Engineering Tests', () => {
  test('recover from Redis connection loss', async () => {
    const session = await sessionService.createSession({
      syncMode: 'per_participant',
      participants: ['p1', 'p2']
    })

    // Disconnect Redis
    await redis.disconnect()

    // Operation should fail
    await expect(
      sessionService.switchCycle(session.sessionId, 'p2')
    ).rejects.toThrow(StorageUnavailableError)

    // Reconnect Redis
    await redis.connect()

    // Operation should succeed after recovery
    await sessionService.switchCycle(session.sessionId, 'p2')
  })

  test('handle partial Pub/Sub failures', async () => {
    const session = await sessionService.createSession({
      syncMode: 'per_participant',
      participants: ['p1', 'p2']
    })

    await sessionService.startSession(session.sessionId)

    // Inject Pub/Sub failure
    messageBroker.injectFailure({ probability: 0.5 })

    // Operation should still succeed (best-effort broadcast)
    await sessionService.switchCycle(session.sessionId, 'p2')

    // State should be consistent in Redis
    const state = await stateManager.getSession({ sessionId: session.sessionId })
    expect(state.activeParticipantId).toBe('p2')
  })
})
```

**Decision Required:**
- [ ] Adopt comprehensive testing pyramid
- [ ] Focus on unit and integration tests only
- [ ] Add chaos engineering in production

---

## 8. Observability and Debugging

### Problem

v3.0 doesn't specify how to debug distributed issues:
- Request tracing across services
- State debugging and inspection
- Performance profiling
- Incident investigation

### Proposed Solution: Structured Observability

```typescript
// src/observability/trace.ts

export interface TraceContext {
  traceId: string
  spanId: string
  parentSpanId?: string
  baggage: Record<string, string>
}

export class DistributedTracer {
  startSpan(name: string, context?: TraceContext): Span {
    const span: Span = {
      name,
      traceId: context?.traceId ?? uuid(),
      spanId: uuid(),
      parentSpanId: context?.spanId,
      startTime: Date.now(),
      tags: {},
      logs: []
    }

    // Export to Jaeger/Zipkin
    this.exporter.export(span)

    return span
  }
}

// State debugging endpoint
export class DebugController {
  async getSessionDebugInfo(sessionId: string): Promise<DebugInfo> {
    const redisState = await redis.get(`session:${sessionId}`)
    const dbState = await db.query('SELECT * FROM sync_sessions WHERE session_id = $1', [sessionId])
    const events = await db.query('SELECT * FROM sync_events WHERE session_id = $1 ORDER BY timestamp DESC LIMIT 10', [sessionId])

    return {
      sessionId,
      redis: {
        exists: !!redisState,
        ttl: await redis.ttl(`session:${sessionId}`),
        state: redisState ? JSON.parse(redisState) : null
      },
      database: {
        exists: dbState.rows.length > 0,
        state: dbState.rows[0]
      },
      recentEvents: events.rows,
      consistency: this.checkConsistency(redisState, dbState.rows[0])
    }
  }

  private checkConsistency(redisState: any, dbState: any): ConsistencyReport {
    if (!redisState || !dbState) {
      return { consistent: false, reason: 'Missing data' }
    }

    const redis = JSON.parse(redisState)

    if (redis.version !== dbState.version) {
      return {
        consistent: false,
        reason: `Version mismatch: Redis=${redis.version}, DB=${dbState.version}`
      }
    }

    return { consistent: true }
  }
}
```

**Decision Required:**
- [ ] Implement comprehensive observability from day 1
- [ ] Add observability incrementally
- [ ] Rely on infrastructure observability only

---

## Summary of Decisions Required

| # | Topic | Priority | Decision Needed |
|---|-------|----------|-----------------|
| 1 | Transaction Model | HIGH | Consistency model (eventual vs strong) |
| 2 | Cross-Cutting Concerns | HIGH | Middleware/decorator/AOP pattern |
| 3 | Data Migration | HIGH | Feature flags vs canary vs cutover |
| 4 | Error Handling | HIGH | Typed errors vs generic errors |
| 5 | Performance Monitoring | MEDIUM | SLO-driven vs informal targets |
| 6 | Security | HIGH | Comprehensive vs gateway-only |
| 7 | Testing Strategy | MEDIUM | Full pyramid vs unit/integration only |
| 8 | Observability | MEDIUM | Day 1 comprehensive vs incremental |

---

## Recommended Decisions

Based on industry best practices for production-ready distributed systems:

1. **Transaction Model:** ✅ **Eventual consistency with sagas** (matches distributed-first design)
2. **Cross-Cutting Concerns:** ✅ **Middleware pattern** (composable, testable)
3. **Data Migration:** ✅ **Feature flags with gradual rollout** (zero downtime)
4. **Error Handling:** ✅ **Typed error hierarchy** (better client experience)
5. **Performance Monitoring:** ✅ **SLO-driven from day 1** (proactive monitoring)
6. **Security:** ✅ **Comprehensive application-level** (defense in depth)
7. **Testing Strategy:** ✅ **Full testing pyramid** (confidence in changes)
8. **Observability:** ✅ **Day 1 comprehensive** (essential for distributed systems)

---

## Next Steps

1. **Review** this addendum with the team
2. **Decide** on each item (use recommended decisions or alternatives)
3. **Update** ARCHITECTURE_V3_PROPOSAL.md with decisions
4. **Create** detailed implementation plan with these considerations
5. **Begin** implementation starting with core interfaces

**Estimated Additional Design Time:** 1 week (including reviews and revisions)

**Total v3.0 Design Time:** 2 weeks (original) + 1 week (addendum) = **3 weeks**

---

## Related Documents

- [ARCHITECTURE_V3_PROPOSAL.md](ARCHITECTURE_V3_PROPOSAL.md) - Main v3.0 proposal
- [EXTENSIBILITY_REVIEW.md](EXTENSIBILITY_REVIEW.md) - Extensibility analysis
- [ARCHITECTURE.md](ARCHITECTURE.md) - Current v2.0 architecture
- [IMPLEMENTATION.md](IMPLEMENTATION.md) - Implementation guide
