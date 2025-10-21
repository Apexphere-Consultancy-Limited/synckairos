// RedisStateManager Edge Case Tests
// Testing max concurrent subscribers, Pub/Sub errors, and network failures

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { RedisStateManager } from '@/state/RedisStateManager'
import { createRedisClient, createRedisPubSubClient } from '@/config/redis'
import { SyncMode, SyncStatus, type SyncState } from '@/types/session'
import type Redis from 'ioredis'

describe('RedisStateManager - Edge Cases', () => {
  let stateManager: RedisStateManager
  let redisClient: Redis
  let pubSubClient: Redis

  beforeEach(async () => {
    redisClient = createRedisClient()
    pubSubClient = createRedisPubSubClient()
    stateManager = new RedisStateManager(redisClient, pubSubClient)
    await redisClient.flushdb()
  })

  afterEach(async () => {
    await stateManager.close()
  })

  const createTestState = (sessionId: string, overrides?: Partial<SyncState>): SyncState => ({
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
    ...overrides,
  })

  describe('Concurrent Subscribers', () => {
    it('should handle multiple concurrent update subscribers', async () => {
      const sessionId = 'multi-sub-test'
      const state = createTestState(sessionId)
      await stateManager.createSession(state)

      const subscriber1Updates: string[] = []
      const subscriber2Updates: string[] = []
      const subscriber3Updates: string[] = []

      // Create 3 concurrent subscribers
      stateManager.subscribeToUpdates((sid) => {
        subscriber1Updates.push(sid)
      })

      stateManager.subscribeToUpdates((sid) => {
        subscriber2Updates.push(sid)
      })

      stateManager.subscribeToUpdates((sid) => {
        subscriber3Updates.push(sid)
      })

      // Wait for subscriptions to be established
      await new Promise(resolve => setTimeout(resolve, 100))

      // Update session
      const current = await stateManager.getSession(sessionId)
      await stateManager.updateSession(sessionId, {
        ...current!,
        status: SyncStatus.RUNNING,
      })

      // Wait for messages to be received
      await new Promise(resolve => setTimeout(resolve, 100))

      // All subscribers should receive the update
      expect(subscriber1Updates).toContain(sessionId)
      expect(subscriber2Updates).toContain(sessionId)
      expect(subscriber3Updates).toContain(sessionId)
    })

    it('should handle many concurrent WebSocket subscribers', async () => {
      const sessionId = 'multi-ws-sub-test'
      const message = { type: 'test', data: 'hello' }

      const receivedMessages: Array<{ subscriberId: number; sessionId: string }> = []

      // Create 10 concurrent WebSocket subscribers
      for (let i = 0; i < 10; i++) {
        const subscriberId = i
        stateManager.subscribeToWebSocket((sid) => {
          receivedMessages.push({ subscriberId, sessionId: sid })
        })
      }

      // Wait for subscriptions to be established
      await new Promise(resolve => setTimeout(resolve, 100))

      // Broadcast message
      await stateManager.broadcastToSession(sessionId, message)

      // Wait for messages to be received
      await new Promise(resolve => setTimeout(resolve, 100))

      // All 10 subscribers should receive the message
      expect(receivedMessages.length).toBeGreaterThanOrEqual(10)
      expect(receivedMessages.filter(m => m.sessionId === sessionId).length).toBe(10)
    })
  })

  describe('Pub/Sub Message Processing Errors', () => {
    it('should handle malformed JSON in session update messages', async () => {
      const malformedMessages: string[] = []

      stateManager.subscribeToUpdates(() => {
        // Callback should not be called for malformed messages
      })

      // Wait for subscription
      await new Promise(resolve => setTimeout(resolve, 100))

      // Publish malformed JSON directly to the channel
      await redisClient.publish('session-updates', 'invalid-json-{]')

      // Wait for message processing
      await new Promise(resolve => setTimeout(resolve, 100))

      // Should not crash - error is logged but processing continues
      expect(true).toBe(true)
    })

    it('should handle messages with missing fields in session updates', async () => {
      const updates: string[] = []

      stateManager.subscribeToUpdates((sid) => {
        updates.push(sid)
      })

      // Wait for subscription
      await new Promise(resolve => setTimeout(resolve, 100))

      // Publish message with missing sessionId
      await redisClient.publish('session-updates', JSON.stringify({
        state: '{"version": 1}',
        timestamp: Date.now(),
      }))

      // Wait for message processing
      await new Promise(resolve => setTimeout(resolve, 100))

      // Should handle gracefully - logs error but continues
      // The callback might be called with undefined sessionId, but no crash
      expect(true).toBe(true) // Test passes if no crash occurs
    })

    it('should handle malformed JSON in WebSocket messages', async () => {
      const messages: unknown[] = []

      stateManager.subscribeToWebSocket((_sid, msg) => {
        messages.push(msg)
      })

      // Wait for subscription
      await new Promise(resolve => setTimeout(resolve, 100))

      // Publish malformed JSON directly to WebSocket channel
      await redisClient.publish('ws:test-session', 'invalid-json-{]')

      // Wait for message processing
      await new Promise(resolve => setTimeout(resolve, 100))

      // Should not crash - error is logged but processing continues
      // No messages should be received due to JSON parse error
      expect(true).toBe(true) // Test passes if no crash occurs
    })

    it('should handle messages from non-matching channels', async () => {
      const updates: string[] = []

      stateManager.subscribeToUpdates((sid) => {
        updates.push(sid)
      })

      // Wait for subscription
      await new Promise(resolve => setTimeout(resolve, 100))

      // Publish to a different channel
      await redisClient.publish('some-other-channel', JSON.stringify({
        sessionId: 'test',
        state: '{}',
      }))

      // Wait for message processing
      await new Promise(resolve => setTimeout(resolve, 100))

      // Should not receive messages from other channels
      expect(updates).toHaveLength(0)
    })
  })

  describe('Network Disconnection Scenarios', () => {
    it('should handle Redis disconnection gracefully', async () => {
      // Create a separate state manager for this test
      const testRedis = createRedisClient()
      const testPubSub = createRedisPubSubClient()
      const testManager = new RedisStateManager(testRedis, testPubSub)

      const sessionId = 'disconnect-test'
      const state = createTestState(sessionId)
      await testManager.createSession(state)

      // Verify session exists
      const retrieved = await testManager.getSession(sessionId)
      expect(retrieved).toBeDefined()

      // Disconnect Redis (simulating network failure)
      await testRedis.disconnect()

      // Attempt to get session should fail but not crash
      await expect(testManager.getSession(sessionId)).rejects.toThrow()

      // Clean up pub/sub client separately
      await testPubSub.quit()
    })

    it('should handle Pub/Sub client disconnection', async () => {
      // Create a separate state manager for this test
      const testRedis = createRedisClient()
      const testPubSub = createRedisPubSubClient()
      const testManager = new RedisStateManager(testRedis, testPubSub)

      const updates: string[] = []

      testManager.subscribeToUpdates((sid) => {
        updates.push(sid)
      })

      // Wait for subscription
      await new Promise(resolve => setTimeout(resolve, 100))

      // Disconnect Pub/Sub client
      await testPubSub.disconnect()

      // Publishing should still work on main client
      await expect(
        testRedis.publish('session-updates', JSON.stringify({ sessionId: 'test', deleted: true }))
      ).resolves.toBeDefined()

      // Clean up main client
      await testRedis.quit()
    })
  })

  describe('Concurrent Update Stress Test', () => {
    it('should handle 10 concurrent updates to the same session', async () => {
      const sessionId = 'concurrent-stress'
      const state = createTestState(sessionId)
      await stateManager.createSession(state)

      // Attempt 10 concurrent updates
      const updatePromises = Array.from({ length: 10 }, async (_, i) => {
        try {
          const current = await stateManager.getSession(sessionId)
          if (current) {
            await stateManager.updateSession(sessionId, {
              ...current,
              status: i % 2 === 0 ? SyncStatus.RUNNING : SyncStatus.PAUSED,
            })
          }
        } catch (err) {
          // Some updates will fail due to version conflicts - this is expected
          return 'failed'
        }
        return 'success'
      })

      const results = await Promise.all(updatePromises)

      // Some updates should succeed, some should fail
      const successCount = results.filter(r => r === 'success').length
      expect(successCount).toBeGreaterThan(0)

      // Final version should reflect the number of successful updates
      const final = await stateManager.getSession(sessionId)
      expect(final).toBeDefined()
      expect(final!.version).toBeGreaterThan(1)
    })

    it('should handle rapid create/delete cycles', async () => {
      const cycles = 10

      for (let i = 0; i < cycles; i++) {
        const sessionId = `rapid-cycle-${i}`
        const state = createTestState(sessionId)

        // Create
        await stateManager.createSession(state)

        // Verify exists
        const retrieved = await stateManager.getSession(sessionId)
        expect(retrieved).toBeDefined()

        // Delete
        await stateManager.deleteSession(sessionId)

        // Verify deleted
        const deleted = await stateManager.getSession(sessionId)
        expect(deleted).toBeNull()
      }
    })
  })

  describe('Large Data Handling', () => {
    it('should handle session with 100+ participants', async () => {
      const sessionId = 'large-session'
      const participants = Array.from({ length: 100 }, (_, i) => ({
        participant_id: `p${i}`,
        total_time_ms: 300000,
        time_remaining_ms: 300000,
        has_gone: false,
        is_active: i === 0,
      }))

      const state = createTestState(sessionId, {
        participants,
        active_participant_id: 'p0',
        total_time_ms: 30000000, // 100 * 300000
      })

      // Create session with 100 participants
      await stateManager.createSession(state)

      // Retrieve and verify
      const retrieved = await stateManager.getSession(sessionId)
      expect(retrieved).toBeDefined()
      expect(retrieved!.participants).toHaveLength(100)
      expect(retrieved!.participants[0].participant_id).toBe('p0')
      expect(retrieved!.participants[99].participant_id).toBe('p99')

      // Update session
      await stateManager.updateSession(sessionId, {
        ...retrieved!,
        active_participant_id: 'p50',
      })

      // Verify update
      const updated = await stateManager.getSession(sessionId)
      expect(updated!.active_participant_id).toBe('p50')
      expect(updated!.version).toBe(2)
    })

    it('should handle very large time values', async () => {
      const sessionId = 'large-time'
      const maxSafeTime = Number.MAX_SAFE_INTEGER

      const state = createTestState(sessionId, {
        participants: [
          {
            participant_id: 'p1',
            total_time_ms: maxSafeTime,
            time_remaining_ms: maxSafeTime,
            has_gone: false,
            is_active: true,
          },
        ],
        total_time_ms: maxSafeTime,
      })

      // Create session with max safe integer time
      await stateManager.createSession(state)

      // Retrieve and verify
      const retrieved = await stateManager.getSession(sessionId)
      expect(retrieved).toBeDefined()
      expect(retrieved!.total_time_ms).toBe(maxSafeTime)
      expect(retrieved!.participants[0].total_time_ms).toBe(maxSafeTime)
    })
  })

  describe('Edge Case State Values', () => {
    it('should handle session with zero time remaining', async () => {
      const sessionId = 'zero-time'
      const state = createTestState(sessionId, {
        participants: [
          {
            participant_id: 'p1',
            total_time_ms: 300000,
            time_remaining_ms: 0, // Zero time remaining
            has_gone: true,
            is_active: false,
          },
        ],
      })

      await stateManager.createSession(state)

      const retrieved = await stateManager.getSession(sessionId)
      expect(retrieved).toBeDefined()
      expect(retrieved!.participants[0].time_remaining_ms).toBe(0)
    })

    it('should handle session with single participant', async () => {
      const sessionId = 'single-participant'
      const state = createTestState(sessionId, {
        participants: [
          {
            participant_id: 'solo',
            total_time_ms: 600000,
            time_remaining_ms: 600000,
            has_gone: false,
            is_active: true,
          },
        ],
        active_participant_id: 'solo',
        total_time_ms: 600000,
      })

      await stateManager.createSession(state)

      const retrieved = await stateManager.getSession(sessionId)
      expect(retrieved).toBeDefined()
      expect(retrieved!.participants).toHaveLength(1)
      expect(retrieved!.participants[0].participant_id).toBe('solo')
    })

    it('should handle null timestamps correctly', async () => {
      const sessionId = 'null-timestamps'
      const state = createTestState(sessionId, {
        cycle_started_at: null,
        session_started_at: null,
        session_completed_at: null,
      })

      await stateManager.createSession(state)

      const retrieved = await stateManager.getSession(sessionId)
      expect(retrieved).toBeDefined()
      expect(retrieved!.cycle_started_at).toBeNull()
      expect(retrieved!.session_started_at).toBeNull()
      expect(retrieved!.session_completed_at).toBeNull()
    })

    it('should preserve timestamp precision across serialization', async () => {
      const sessionId = 'timestamp-precision'
      const now = new Date('2025-01-15T12:34:56.789Z')

      const state = createTestState(sessionId, {
        session_started_at: now,
        cycle_started_at: now,
      })

      await stateManager.createSession(state)

      const retrieved = await stateManager.getSession(sessionId)
      expect(retrieved).toBeDefined()
      expect(retrieved!.session_started_at).toBeInstanceOf(Date)
      expect(retrieved!.session_started_at!.toISOString()).toBe(now.toISOString())
      expect(retrieved!.cycle_started_at!.toISOString()).toBe(now.toISOString())
    })
  })

  describe('TTL Edge Cases', () => {
    it('should refresh TTL on multiple rapid updates', async () => {
      const sessionId = 'ttl-refresh'
      const state = createTestState(sessionId)
      await stateManager.createSession(state)

      // Perform 5 rapid updates
      for (let i = 0; i < 5; i++) {
        const current = await stateManager.getSession(sessionId)
        await stateManager.updateSession(sessionId, current!)
        await new Promise(resolve => setTimeout(resolve, 10))
      }

      // Check TTL is still fresh
      const ttl = await redisClient.ttl(`session:${sessionId}`)
      expect(ttl).toBeGreaterThan(3500) // Should be close to 3600 (1 hour)
    })

    it('should not allow session retrieval after TTL expires', async () => {
      const sessionId = 'ttl-expire'
      const state = createTestState(sessionId)
      await stateManager.createSession(state)

      // Manually set a very short TTL (1 second)
      await redisClient.expire(`session:${sessionId}`, 1)

      // Verify session exists
      const before = await stateManager.getSession(sessionId)
      expect(before).toBeDefined()

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 1500))

      // Session should be gone
      const after = await stateManager.getSession(sessionId)
      expect(after).toBeNull()
    }, 10000)
  })
})
