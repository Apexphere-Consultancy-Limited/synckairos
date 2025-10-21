// RedisStateManager Unit Tests
// Testing CRUD operations, optimistic locking, and Pub/Sub

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { RedisStateManager } from '@/state/RedisStateManager'
import { createRedisClient, createRedisPubSubClient } from '@/config/redis'
import { SyncMode, SyncStatus, type SyncState } from '@/types/session'
import type Redis from 'ioredis'

describe('RedisStateManager - CRUD Operations', () => {
  let stateManager: RedisStateManager
  let redisClient: Redis
  let pubSubClient: Redis

  beforeEach(async () => {
    redisClient = createRedisClient()
    pubSubClient = createRedisPubSubClient()
    stateManager = new RedisStateManager(redisClient, pubSubClient)
    await redisClient.flushall()
  })

  afterEach(async () => {
    await stateManager.close()
  })

  const createTestState = (sessionId: string): SyncState => ({
    session_id: sessionId,
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
      const state = createTestState('session-1')
      await stateManager.createSession(state)

      const retrieved = await stateManager.getSession('session-1')
      expect(retrieved).toBeDefined()
      expect(retrieved!.version).toBe(1)
      expect(retrieved!.session_id).toBe('session-1')
    })

    it('should set created_at and updated_at timestamps', async () => {
      const state = createTestState('session-2')
      await stateManager.createSession(state)

      const retrieved = await stateManager.getSession('session-2')
      expect(retrieved!.created_at).toBeInstanceOf(Date)
      expect(retrieved!.updated_at).toBeInstanceOf(Date)
    })
  })

  describe('getSession', () => {
    it('should return session when exists', async () => {
      const state = createTestState('session-3')
      await stateManager.createSession(state)

      const retrieved = await stateManager.getSession('session-3')
      expect(retrieved).toBeDefined()
      expect(retrieved!.session_id).toBe('session-3')
      expect(retrieved!.sync_mode).toBe(SyncMode.PER_PARTICIPANT)
      expect(retrieved!.status).toBe(SyncStatus.PENDING)
      expect(retrieved!.participants).toHaveLength(2)
    })

    it('should return null when not found', async () => {
      const retrieved = await stateManager.getSession('nonexistent')
      expect(retrieved).toBeNull()
    })

    it('should handle JSON parse errors gracefully', async () => {
      // Manually insert invalid JSON
      await redisClient.set('session:invalid', 'not-valid-json')

      const retrieved = await stateManager.getSession('invalid')
      expect(retrieved).toBeNull()
    })

    it('should deserialize Date objects correctly', async () => {
      const state = createTestState('session-dates')
      state.session_started_at = new Date('2025-01-01T00:00:00Z')
      state.cycle_started_at = new Date('2025-01-01T00:05:00Z')

      await stateManager.createSession(state)

      const retrieved = await stateManager.getSession('session-dates')
      expect(retrieved!.session_started_at).toBeInstanceOf(Date)
      expect(retrieved!.cycle_started_at).toBeInstanceOf(Date)
      expect(retrieved!.session_started_at!.toISOString()).toBe('2025-01-01T00:00:00.000Z')
    })
  })

  describe('updateSession', () => {
    it('should update session and increment version', async () => {
      const state = createTestState('session-4')
      await stateManager.createSession(state)

      const current = await stateManager.getSession('session-4')
      await stateManager.updateSession('session-4', {
        ...current!,
        status: SyncStatus.RUNNING,
      })

      const updated = await stateManager.getSession('session-4')
      expect(updated!.status).toBe(SyncStatus.RUNNING)
      expect(updated!.version).toBe(2) // Incremented from 1 to 2
    })

    it('should refresh TTL on each update', async () => {
      const state = createTestState('session-5')
      await stateManager.createSession(state)

      const ttlBefore = await redisClient.ttl('session:session-5')
      expect(ttlBefore).toBeGreaterThan(0)
      expect(ttlBefore).toBeLessThanOrEqual(3600)

      // Update and check TTL is refreshed
      const current = await stateManager.getSession('session-5')
      await stateManager.updateSession('session-5', current!)

      const ttlAfter = await redisClient.ttl('session:session-5')
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
      const sessionId = 'test-session-lock-1'
      const initialState = createTestState(sessionId)

      await stateManager.createSession(initialState)

      // Simulate concurrent update by another instance
      const current = await stateManager.getSession(sessionId)
      await stateManager.updateSession(sessionId, {
        ...current!,
        status: SyncStatus.RUNNING,
      })

      // This should fail due to version mismatch (version is now 2)
      await expect(
        stateManager.updateSession(sessionId, initialState, 1)
      ).rejects.toThrow('Concurrent modification detected')
    })

    it('should successfully update when version matches', async () => {
      const sessionId = 'test-session-lock-2'
      const initialState = createTestState(sessionId)

      await stateManager.createSession(initialState)
      const current = await stateManager.getSession(sessionId)

      // This should succeed with correct version
      await stateManager.updateSession(
        sessionId,
        { ...current!, status: SyncStatus.RUNNING },
        current!.version
      )

      const updated = await stateManager.getSession(sessionId)
      expect(updated!.status).toBe(SyncStatus.RUNNING)
      expect(updated!.version).toBe(current!.version + 1)
    })

    it('should throw error when session not found during optimistic lock check', async () => {
      const state = createTestState('nonexistent')

      await expect(
        stateManager.updateSession('nonexistent', state, 1)
      ).rejects.toThrow('Session nonexistent not found')
    })
  })
})
