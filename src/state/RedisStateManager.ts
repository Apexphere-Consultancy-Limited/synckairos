// RedisStateManager - PRIMARY state store for SyncKairos
// All session state lives in Redis - PostgreSQL is AUDIT only

import Redis from 'ioredis'
import { SyncState } from '@/types/session'

export class RedisStateManager {
  private redis: Redis
  private pubSubClient: Redis
  private readonly SESSION_PREFIX = 'session:'
  private readonly SESSION_TTL = 3600 // 1 hour in seconds

  constructor(redisClient: Redis, pubSubClient: Redis) {
    this.redis = redisClient
    this.pubSubClient = pubSubClient
  }

  // CRUD Operations
  async getSession(sessionId: string): Promise<SyncState | null> {
    const key = this.getSessionKey(sessionId)
    const data = await this.redis.get(key)

    if (!data) {
      return null
    }

    try {
      return this.deserializeState(data)
    } catch (err) {
      console.error(`Failed to parse session ${sessionId}:`, err)
      return null
    }
  }

  async createSession(state: SyncState): Promise<void> {
    // Initialize version to 1
    const newState: SyncState = {
      ...state,
      version: 1,
      created_at: new Date(),
      updated_at: new Date(),
    }

    // Write directly to Redis without incrementing version (this is the initial create)
    const key = this.getSessionKey(state.session_id)
    const serialized = this.serializeState(newState)
    await this.redis.setex(key, this.SESSION_TTL, serialized)
  }

  async updateSession(
    sessionId: string,
    state: SyncState,
    expectedVersion?: number
  ): Promise<void> {
    // Optimistic locking check
    if (expectedVersion !== undefined) {
      const currentState = await this.getSession(sessionId)
      if (!currentState) {
        throw new Error(`Session ${sessionId} not found`)
      }
      if (currentState.version !== expectedVersion) {
        throw new Error(
          `Concurrent modification detected: expected version ${expectedVersion}, found ${currentState.version}`
        )
      }
    }

    // Increment version
    const newState: SyncState = {
      ...state,
      version: state.version + 1,
      updated_at: new Date(),
    }

    // Write to Redis with TTL
    const key = this.getSessionKey(sessionId)
    const serialized = this.serializeState(newState)
    await this.redis.setex(key, this.SESSION_TTL, serialized)

    // Broadcast update (will implement in Day 2)
    // await this.broadcastUpdate(sessionId, newState)
  }

  async deleteSession(sessionId: string): Promise<void> {
    const key = this.getSessionKey(sessionId)
    await this.redis.del(key)

    // Broadcast deletion (will implement in Day 2)
    // await this.broadcastDeletion(sessionId)
  }

  // Pub/Sub (will implement in Day 2)
  subscribeToUpdates(_callback: (sessionId: string, state: SyncState) => void): void {
    // TODO: Implement
    throw new Error('Not implemented')
  }

  async broadcastToSession(_sessionId: string, _message: unknown): Promise<void> {
    // TODO: Implement
    throw new Error('Not implemented')
  }

  subscribeToWebSocket(_callback: (sessionId: string, message: unknown) => void): void {
    // TODO: Implement
    throw new Error('Not implemented')
  }

  // Lifecycle
  async close(): Promise<void> {
    await this.redis.quit()
    await this.pubSubClient.quit()
  }

  // Helper methods
  private getSessionKey(sessionId: string): string {
    return `${this.SESSION_PREFIX}${sessionId}`
  }

  private serializeState(state: SyncState): string {
    return JSON.stringify(state, (_key, value) => {
      // Convert Date objects to ISO strings
      if (value instanceof Date) {
        return value.toISOString()
      }
      return value
    })
  }

  private deserializeState(data: string): SyncState {
    return JSON.parse(data, (_key, value) => {
      // Convert ISO strings back to Date objects
      if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
        return new Date(value)
      }
      return value
    })
  }
}
