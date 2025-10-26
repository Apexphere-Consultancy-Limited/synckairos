// RedisStateManager Unit Tests
// Testing CRUD operations, optimistic locking, and Pub/Sub

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { RedisStateManager } from '@/state/RedisStateManager'
import { createRedisClient, createRedisPubSubClient } from '@/config/redis'
import { SyncMode, SyncStatus, type SyncState } from '@/types/session'
import {
  SessionNotFoundError,
  ConcurrencyError,
  StateDeserializationError,
} from '@/errors/StateErrors'
import type Redis from 'ioredis'

describe('RedisStateManager - CRUD Operations', () => {
  let stateManager: RedisStateManager
  let redisClient: Redis
  let pubSubClient: Redis

  beforeEach(async () => {
    redisClient = createRedisClient()
    pubSubClient = createRedisPubSubClient()

    // Use unique key prefix per test run to avoid race conditions in parallel execution
    const uniquePrefix = `test:${Date.now()}-${Math.random()}:`
    stateManager = new RedisStateManager(redisClient, pubSubClient, undefined, uniquePrefix)

    // No need for flushdb() anymore - each test run has its own namespace!
  })

  afterEach(async () => {
    await stateManager.close()
  })

  const createTestState = (sessionId?: string): SyncState => ({
    session_id: sessionId || `test-session-${Date.now()}-${Math.random()}`,
    sync_mode: SyncMode.PER_PARTICIPANT,
    status: SyncStatus.PENDING,
    version: 1,
    participants: [
      {
        participant_id: 'p1',
        total_time_ms: 300000,
        time_remaining_ms: 300000,
        has_gone: false,
        is_active: true,
      },
      {
        participant_id: 'p2',
        total_time_ms: 300000,
        time_remaining_ms: 300000,
        has_gone: false,
        is_active: false,
      },
    ],
    active_participant_id: 'p1',
    total_time_ms: 600000,
    time_per_cycle_ms: null,
    cycle_started_at: null,
    session_started_at: null,
    session_completed_at: null,
    created_at: new Date(),
    updated_at: new Date(),
  })

  describe('createSession', () => {
    it('should create session with version 1', async () => {
      const state = createTestState()
      const sessionId = state.session_id
      await stateManager.createSession(state)

      const retrieved = await stateManager.getSession(sessionId)
      expect(retrieved).toBeDefined()
      expect(retrieved!.version).toBe(1)
      expect(retrieved!.session_id).toBe(sessionId)
    })

    it('should set created_at and updated_at timestamps', async () => {
      const state = createTestState()
      const sessionId = state.session_id
      await stateManager.createSession(state)

      const retrieved = await stateManager.getSession(sessionId)
      expect(retrieved).toBeDefined()
      expect(retrieved!.created_at).toBeInstanceOf(Date)
      expect(retrieved!.updated_at).toBeInstanceOf(Date)
    })
  })

  describe('getSession', () => {
    it('should return session when exists', async () => {
      const state = createTestState()
      const sessionId = state.session_id
      await stateManager.createSession(state)

      const retrieved = await stateManager.getSession(sessionId)
      expect(retrieved).toBeDefined()
      expect(retrieved!.session_id).toBe(sessionId)
      expect(retrieved!.sync_mode).toBe(SyncMode.PER_PARTICIPANT)
      expect(retrieved!.status).toBe(SyncStatus.PENDING)
      expect(retrieved!.participants).toHaveLength(2)
    })

    it('should return null when not found', async () => {
      const retrieved = await stateManager.getSession(`nonexistent-${Date.now()}`)
      expect(retrieved).toBeNull()
    })

    it('should throw StateDeserializationError on JSON parse errors', async () => {
      const state = createTestState()
      const invalidSessionId = state.session_id
      // Manually insert invalid JSON with TTL - use private getSessionKey method's output
      // We need to use the same prefix the stateManager instance is using
      const key = `${(stateManager as any).SESSION_PREFIX}${invalidSessionId}`
      await redisClient.setex(key, 3600, 'not-valid-json')

      await expect(stateManager.getSession(invalidSessionId)).rejects.toThrow(StateDeserializationError)
      await expect(stateManager.getSession(invalidSessionId)).rejects.toThrow('Failed to deserialize state')
    })

    it('should deserialize Date objects correctly', async () => {
      const state = createTestState()
      const sessionId = state.session_id
      state.session_started_at = new Date('2025-01-01T00:00:00Z')
      state.cycle_started_at = new Date('2025-01-01T00:05:00Z')

      await stateManager.createSession(state)

      const retrieved = await stateManager.getSession(sessionId)
      expect(retrieved).toBeDefined()
      expect(retrieved!.session_started_at).toBeInstanceOf(Date)
      expect(retrieved!.cycle_started_at).toBeInstanceOf(Date)
      expect(retrieved!.session_started_at!.toISOString()).toBe('2025-01-01T00:00:00.000Z')
    })
  })

  describe('updateSession', () => {
    it('should update session and increment version', async () => {
      const sessionId = `session-update-${Date.now()}`
      const state = createTestState(sessionId)
      await stateManager.createSession(state)

      const current = await stateManager.getSession(sessionId)
      expect(current).toBeDefined()
      await stateManager.updateSession(sessionId, {
        ...current!,
        status: SyncStatus.RUNNING,
      })

      const updated = await stateManager.getSession(sessionId)
      expect(updated).toBeDefined()
      expect(updated!.status).toBe(SyncStatus.RUNNING)
      expect(updated!.version).toBe(2) // Incremented from 1 to 2
    })

    it('should refresh TTL on each update', async () => {
      const sessionId = `session-ttl-${Date.now()}`
      const state = createTestState(sessionId)
      await stateManager.createSession(state)

      const key = `${(stateManager as any).SESSION_PREFIX}${sessionId}`
      const ttlBefore = await redisClient.ttl(key)
      expect(ttlBefore).toBeGreaterThan(0)
      expect(ttlBefore).toBeLessThanOrEqual(3600)

      // Small delay to ensure time passes
      await new Promise(resolve => setTimeout(resolve, 100))

      // Update and check TTL is refreshed
      const current = await stateManager.getSession(sessionId)
      expect(current).toBeDefined()
      await stateManager.updateSession(sessionId, current!)

      const ttlAfter = await redisClient.ttl(key)
      // Should be refreshed - at least greater than before minus the delay
      expect(ttlAfter).toBeGreaterThan(3500) // Should be close to 3600
    })
  })

  describe('deleteSession', () => {
    it('should delete session from Redis', async () => {
      const state = createTestState('session-6')
      await stateManager.createSession(state)

      // Verify it exists
      const before = await stateManager.getSession('session-6')
      expect(before).toBeDefined()

      // Delete
      await stateManager.deleteSession('session-6')

      // Verify it's gone
      const after = await stateManager.getSession('session-6')
      expect(after).toBeNull()
    })

    it('should not throw error if session does not exist', async () => {
      await expect(stateManager.deleteSession('nonexistent')).resolves.not.toThrow()
    })
  })

  describe('Optimistic Locking', () => {
    it('should throw error on version mismatch', async () => {
      const sessionId = `test-session-lock-${Date.now()}-1`
      const initialState = createTestState(sessionId)

      await stateManager.createSession(initialState)

      // Simulate concurrent update by another instance
      const current = await stateManager.getSession(sessionId)
      expect(current).toBeDefined()
      await stateManager.updateSession(sessionId, {
        ...current!,
        status: SyncStatus.RUNNING,
      })

      // This should fail due to version mismatch (version is now 2)
      await expect(
        stateManager.updateSession(sessionId, initialState, 1)
      ).rejects.toThrow(ConcurrencyError)
    })

    it('should successfully update when version matches', async () => {
      const sessionId = `test-session-lock-${Date.now()}-2`
      const initialState = createTestState(sessionId)

      await stateManager.createSession(initialState)
      const current = await stateManager.getSession(sessionId)
      expect(current).toBeDefined()

      // This should succeed with correct version
      await stateManager.updateSession(
        sessionId,
        { ...current!, status: SyncStatus.RUNNING },
        current!.version
      )

      const updated = await stateManager.getSession(sessionId)
      expect(updated).toBeDefined()
      expect(updated!.status).toBe(SyncStatus.RUNNING)
      expect(updated!.version).toBe(current!.version + 1)
    })

    it('should throw SessionNotFoundError when session not found during optimistic lock check', async () => {
      const state = createTestState('nonexistent')

      await expect(
        stateManager.updateSession('nonexistent', state, 1)
      ).rejects.toThrow(SessionNotFoundError)
    })
  })

  describe('Redis Pub/Sub - Session Updates', () => {
    it('should broadcast update when session is updated', async () => {
      const sessionId = 'pubsub-test-1'
      const state = createTestState(sessionId)

      await stateManager.createSession(state)

      const updates: string[] = []

      // Subscribe to updates
      stateManager.subscribeToUpdates((sid, _state) => {
        updates.push(sid)
      })

      // Wait for subscription to be established
      await new Promise(resolve => setTimeout(resolve, 100))

      // Update session (should trigger broadcast)
      const current = await stateManager.getSession(sessionId)
      await stateManager.updateSession(sessionId, {
        ...current!,
        status: SyncStatus.RUNNING,
      })

      // Wait for message to be received
      await new Promise(resolve => setTimeout(resolve, 100))

      expect(updates).toContain(sessionId)
    })

    it('should broadcast deletion when session is deleted', async () => {
      const sessionId = 'pubsub-test-2'
      const state = createTestState(sessionId)

      await stateManager.createSession(state)

      const deletions: string[] = []

      // Subscribe to updates (deletions are broadcast on same channel)
      stateManager.subscribeToUpdates((sid) => {
        deletions.push(sid)
      })

      // Wait for subscription to be established
      await new Promise(resolve => setTimeout(resolve, 100))

      // Delete session (should trigger broadcast)
      await stateManager.deleteSession(sessionId)

      // Wait for message to be received
      await new Promise(resolve => setTimeout(resolve, 100))

      expect(deletions).toContain(sessionId)
    })
  })

  describe('Redis Pub/Sub - WebSocket Broadcasting', () => {
    it('should broadcast message to specific session', async () => {
      const sessionId = `ws-test-${Date.now()}`
      const testMessage = { type: 'sync-update', data: 'test' }

      const receivedMessages: Array<{ sessionId: string; message: unknown }> = []

      // Subscribe to WebSocket messages
      stateManager.subscribeToWebSocket((sid, msg) => {
        if (sid === sessionId) {
          receivedMessages.push({ sessionId: sid, message: msg })
        }
      })

      // Wait for subscription to be established
      await new Promise(resolve => setTimeout(resolve, 100))

      // Broadcast message
      await stateManager.broadcastToSession(sessionId, testMessage)

      // Wait for message to be received
      await new Promise(resolve => setTimeout(resolve, 100))

      expect(receivedMessages.length).toBeGreaterThanOrEqual(1)
      expect(receivedMessages[0].sessionId).toBe(sessionId)
      expect(receivedMessages[0].message).toEqual(testMessage)
    })

    it('should receive messages for all sessions via pattern subscription', async () => {
      const timestamp = Date.now()
      const session1 = `ws-test-multi-${timestamp}-1`
      const session2 = `ws-test-multi-${timestamp}-2`
      const message1 = { type: 'tick', data: 1 }
      const message2 = { type: 'tick', data: 2 }

      const receivedMessages: Array<{ sessionId: string; message: unknown }> = []

      // Subscribe to all WebSocket messages for these specific sessions
      stateManager.subscribeToWebSocket((sid, msg) => {
        if (sid === session1 || sid === session2) {
          receivedMessages.push({ sessionId: sid, message: msg })
        }
      })

      // Wait for subscription to be established
      await new Promise(resolve => setTimeout(resolve, 100))

      // Broadcast to multiple sessions
      await stateManager.broadcastToSession(session1, message1)
      await stateManager.broadcastToSession(session2, message2)

      // Wait for messages to be received
      await new Promise(resolve => setTimeout(resolve, 100))

      expect(receivedMessages.length).toBeGreaterThanOrEqual(2)
      const msg1 = receivedMessages.find(m => m.sessionId === session1)
      const msg2 = receivedMessages.find(m => m.sessionId === session2)
      expect(msg1).toBeDefined()
      expect(msg2).toBeDefined()
      expect(msg1!.message).toEqual(message1)
      expect(msg2!.message).toEqual(message2)
    })
  })
})
