// Multi-Instance Cross-Communication Integration Tests
// Validates that multiple RedisStateManager instances can share state
// and communicate via Redis Pub/Sub

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { RedisStateManager } from '@/state/RedisStateManager'
import { createRedisClient, createRedisPubSubClient } from '@/config/redis'
import { SyncMode, SyncStatus, type SyncState } from '@/types/session'
import type Redis from 'ioredis'

describe('Multi-Instance Cross-Communication', () => {
  let instance1: RedisStateManager
  let instance2: RedisStateManager
  let redis1: Redis
  let redis2: Redis
  let pubSub1: Redis
  let pubSub2: Redis

  beforeAll(async () => {
    // Create Instance 1
    redis1 = createRedisClient()
    pubSub1 = createRedisPubSubClient()

    // Create Instance 2
    redis2 = createRedisClient()
    pubSub2 = createRedisPubSubClient()

    // Use unique prefix (both instances must share same namespace to test multi-instance)
    const uniquePrefix = `integration-test:${Date.now()}-${Math.random()}:`

    // Create managers with shared prefix for multi-instance testing
    instance1 = new RedisStateManager(redis1, pubSub1, undefined, uniquePrefix)
    instance2 = new RedisStateManager(redis2, pubSub2, undefined, uniquePrefix)
  })

  afterAll(async () => {
    await instance1.close()
    await instance2.close()
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

  it('should share state across instances', async () => {
    const state = createTestState('cross-instance-1')

    // Instance 1 creates session
    await instance1.createSession(state)

    // Instance 2 reads session
    const retrieved = await instance2.getSession('cross-instance-1')
    expect(retrieved).toBeDefined()
    expect(retrieved!.session_id).toBe('cross-instance-1')
    expect(retrieved!.participants).toHaveLength(2)
  })

  it('should broadcast updates across instances', async () => {
    const state = createTestState('cross-instance-2')
    await instance1.createSession(state)

    const updates: Array<{ sessionId: string; state: SyncState | null }> = []

    // Instance 2 subscribes to updates
    instance2.subscribeToUpdates((sessionId, state) => {
      updates.push({ sessionId, state })
    })

    // Wait for subscription to be established
    await new Promise(resolve => setTimeout(resolve, 100))

    // Instance 1 updates session
    const current = await instance1.getSession('cross-instance-2')
    await instance1.updateSession('cross-instance-2', {
      ...current!,
      status: SyncStatus.RUNNING,
    })

    // Wait for message to be received
    await new Promise(resolve => setTimeout(resolve, 100))

    expect(updates.length).toBeGreaterThan(0)
    const update = updates.find(u => u.sessionId === 'cross-instance-2')
    expect(update).toBeDefined()
    expect(update!.state).toBeDefined()
    expect(update!.state!.status).toBe(SyncStatus.RUNNING)
  })

  it('should broadcast deletions across instances', async () => {
    const state = createTestState('cross-instance-3')
    await instance1.createSession(state)

    const deletions: string[] = []

    // Instance 2 subscribes to updates
    instance2.subscribeToUpdates((sessionId, state) => {
      if (state === null) {
        deletions.push(sessionId)
      }
    })

    // Wait for subscription to be established
    await new Promise(resolve => setTimeout(resolve, 100))

    // Instance 1 deletes session
    await instance1.deleteSession('cross-instance-3')

    // Wait for message to be received
    await new Promise(resolve => setTimeout(resolve, 100))

    expect(deletions).toContain('cross-instance-3')

    // Verify session is actually deleted
    const retrieved = await instance2.getSession('cross-instance-3')
    expect(retrieved).toBeNull()
  })

  it('should handle concurrent updates with optimistic locking', async () => {
    const state = createTestState('cross-instance-4')
    await instance1.createSession(state)

    // Both instances read the same version
    const state1 = await instance1.getSession('cross-instance-4')
    const state2 = await instance2.getSession('cross-instance-4')

    expect(state1!.version).toBe(state2!.version)

    // Instance 1 updates successfully
    await instance1.updateSession(
      'cross-instance-4',
      { ...state1!, status: SyncStatus.RUNNING },
      state1!.version
    )

    // Instance 2 tries to update with old version - should fail
    await expect(
      instance2.updateSession(
        'cross-instance-4',
        { ...state2!, status: SyncStatus.PAUSED },
        state2!.version
      )
    ).rejects.toThrow('Concurrent modification detected')

    // Verify Instance 1's update won
    const final = await instance2.getSession('cross-instance-4')
    expect(final!.status).toBe(SyncStatus.RUNNING)
  })

  it('should broadcast WebSocket messages across instances', async () => {
    const sessionId = 'cross-instance-ws-1'
    const testMessage = { type: 'tick', participantId: 'p1', timeRemaining: 250000 }

    const receivedMessages: Array<{ sessionId: string; message: unknown }> = []

    // Instance 2 subscribes to WebSocket messages
    instance2.subscribeToWebSocket((sid, msg) => {
      receivedMessages.push({ sessionId: sid, message: msg })
    })

    // Wait for subscription to be established
    await new Promise(resolve => setTimeout(resolve, 100))

    // Instance 1 broadcasts WebSocket message
    await instance1.broadcastToSession(sessionId, testMessage)

    // Wait for message to be received
    await new Promise(resolve => setTimeout(resolve, 100))

    const received = receivedMessages.find(m => m.sessionId === sessionId)
    expect(received).toBeDefined()
    expect(received!.message).toEqual(testMessage)
  })

  it('should handle multiple instances reading and writing simultaneously', async () => {
    const state = createTestState('cross-instance-concurrent')
    await instance1.createSession(state)

    // Simulate both instances updating different fields
    const promises = [
      (async () => {
        const current = await instance1.getSession('cross-instance-concurrent')
        await instance1.updateSession('cross-instance-concurrent', {
          ...current!,
          status: SyncStatus.RUNNING,
        })
      })(),
      (async () => {
        // Slight delay to ensure instance 1 goes first
        await new Promise(resolve => setTimeout(resolve, 50))
        const current = await instance2.getSession('cross-instance-concurrent')
        await instance2.updateSession('cross-instance-concurrent', {
          ...current!,
          active_participant_id: 'p2',
        })
      })(),
    ]

    await Promise.all(promises)

    // Final state should have both changes
    const final = await instance1.getSession('cross-instance-concurrent')
    expect(final!.status).toBe(SyncStatus.RUNNING)
    expect(final!.active_participant_id).toBe('p2')
    expect(final!.version).toBe(3) // Original (1) + 2 updates
  })
})
