// RedisStateManager - PRIMARY state store for SyncKairos
// All session state lives in Redis - PostgreSQL is AUDIT only

import Redis from 'ioredis'
import { SyncState } from '@/types/session'
import { createComponentLogger } from '@/utils/logger'
import {
  SessionNotFoundError,
  ConcurrencyError,
  StateDeserializationError,
} from '@/errors/StateErrors'
import { DBWriteQueue } from './DBWriteQueue'

const logger = createComponentLogger('RedisStateManager')

export class RedisStateManager {
  private redis: Redis
  private pubSubClient: Redis
  private dbQueue?: DBWriteQueue
  private readonly SESSION_PREFIX = 'session:'
  private readonly SESSION_TTL = 3600 // 1 hour in seconds

  constructor(redisClient: Redis, pubSubClient: Redis, dbQueue?: DBWriteQueue) {
    this.redis = redisClient
    this.pubSubClient = pubSubClient
    this.dbQueue = dbQueue
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
      logger.error({ err, sessionId, data }, 'Failed to deserialize session state')
      throw new StateDeserializationError(sessionId, data, err as Error)
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

    // Async DB write (fire-and-forget)
    this.asyncDBWrite(state.session_id, newState, 'session_created').catch(err => {
      logger.error({ err, sessionId: state.session_id }, 'Failed to queue DB write')
    })
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
        throw new SessionNotFoundError(sessionId)
      }
      if (currentState.version !== expectedVersion) {
        logger.warn(
          { sessionId, expectedVersion, actualVersion: currentState.version },
          'Concurrent modification detected'
        )
        throw new ConcurrencyError(sessionId, expectedVersion, currentState.version)
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

    // Broadcast update to all instances
    await this.broadcastUpdate(sessionId, newState)

    // Async DB write (fire-and-forget)
    this.asyncDBWrite(sessionId, newState, 'session_updated').catch(err => {
      logger.error({ err, sessionId }, 'Failed to queue DB write')
    })
  }

  async deleteSession(sessionId: string): Promise<void> {
    const key = this.getSessionKey(sessionId)
    await this.redis.del(key)

    // Broadcast deletion to all instances
    await this.broadcastDeletion(sessionId)
  }

  // Pub/Sub - Session Update Broadcasting
  subscribeToUpdates(callback: (sessionId: string, state: SyncState | null) => void): void {
    this.pubSubClient.subscribe('session-updates', err => {
      if (err) {
        logger.error({ err, channel: 'session-updates' }, 'Failed to subscribe to channel')
        return
      }
      logger.info({ channel: 'session-updates' }, 'Subscribed to updates channel')
    })

    this.pubSubClient.on('message', (channel, message) => {
      if (channel !== 'session-updates') return

      try {
        const parsed = JSON.parse(message)

        // Handle deletion messages (state is null)
        if (parsed.deleted) {
          callback(parsed.sessionId, null)
          return
        }

        // Handle update messages (state is present)
        const deserializedState = this.deserializeState(parsed.state)
        callback(parsed.sessionId, deserializedState)
      } catch (err) {
        logger.error({ err, channel, message }, 'Failed to process session update message')
      }
    })
  }

  private async broadcastUpdate(sessionId: string, state: SyncState): Promise<void> {
    const message = JSON.stringify({
      sessionId,
      state: this.serializeState(state),
      timestamp: Date.now(),
    })
    await this.redis.publish('session-updates', message)
  }

  private async broadcastDeletion(sessionId: string): Promise<void> {
    const message = JSON.stringify({
      sessionId,
      deleted: true,
      timestamp: Date.now(),
    })
    await this.redis.publish('session-updates', message)
  }

  // Pub/Sub - WebSocket Broadcasting
  async broadcastToSession(sessionId: string, message: unknown): Promise<void> {
    const channel = `ws:${sessionId}`
    const serialized = JSON.stringify({
      sessionId,
      message,
      timestamp: Date.now(),
    })
    await this.redis.publish(channel, serialized)
  }

  subscribeToWebSocket(callback: (sessionId: string, message: unknown) => void): void {
    this.pubSubClient.psubscribe('ws:*', err => {
      if (err) {
        logger.error({ err, pattern: 'ws:*' }, 'Failed to subscribe to WebSocket pattern')
        return
      }
      logger.info({ pattern: 'ws:*' }, 'Subscribed to WebSocket pattern')
    })

    this.pubSubClient.on('pmessage', (pattern, channel, message) => {
      if (pattern !== 'ws:*') return

      try {
        const sessionId = channel.replace('ws:', '')
        const { message: payload } = JSON.parse(message)
        callback(sessionId, payload)
      } catch (err) {
        logger.error({ err, pattern, channel, message }, 'Failed to process WebSocket message')
      }
    })
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

  private async asyncDBWrite(
    sessionId: string,
    state: SyncState,
    eventType: string
  ): Promise<void> {
    if (!this.dbQueue) {
      logger.debug({ sessionId }, 'DBWriteQueue not configured, skipping audit write')
      return
    }
    await this.dbQueue.queueWrite(sessionId, state, eventType)
  }
}
