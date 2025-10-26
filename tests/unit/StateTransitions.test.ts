// State Transition Edge Case Tests
// Testing invalid state transitions, operations on completed/deleted sessions

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { RedisStateManager } from '@/state/RedisStateManager'
import { createRedisClient, createRedisPubSubClient } from '@/config/redis'
import { SyncMode, SyncStatus, type SyncState } from '@/types/session'
import { SessionNotFoundError } from '@/errors/StateErrors'
import type Redis from 'ioredis'

describe('State Transitions - Edge Cases', () => {
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

  const createTestState = (sessionId?: string, overrides?: Partial<SyncState>): SyncState => ({
    session_id: sessionId || `test-state-${Date.now()}-${Math.random()}`,
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

  describe('Invalid Status Transitions', () => {
    it('should allow PENDING → RUNNING transition', async () => {
      const sessionId = `transition-pending-running-${Date.now()}-${Math.random()}`
      const state = createTestState(sessionId, { status: SyncStatus.PENDING })
      await stateManager.createSession(state)

      const current = await stateManager.getSession(sessionId)
      await stateManager.updateSession(sessionId, {
        ...current!,
        status: SyncStatus.RUNNING,
        session_started_at: new Date(),
      })

      const updated = await stateManager.getSession(sessionId)
      expect(updated!.status).toBe(SyncStatus.RUNNING)
    })

    it('should allow RUNNING → PAUSED transition', async () => {
      const sessionId = `transition-running-paused-${Date.now()}-${Math.random()}`
      const state = createTestState(sessionId, { status: SyncStatus.RUNNING })
      await stateManager.createSession(state)

      const current = await stateManager.getSession(sessionId)
      await stateManager.updateSession(sessionId, {
        ...current!,
        status: SyncStatus.PAUSED,
      })

      const updated = await stateManager.getSession(sessionId)
      expect(updated!.status).toBe(SyncStatus.PAUSED)
    })

    it('should allow PAUSED → RUNNING transition', async () => {
      const sessionId = `transition-paused-running-${Date.now()}-${Math.random()}`
      const state = createTestState(sessionId, { status: SyncStatus.PAUSED })
      await stateManager.createSession(state)

      const current = await stateManager.getSession(sessionId)
      await stateManager.updateSession(sessionId, {
        ...current!,
        status: SyncStatus.RUNNING,
      })

      const updated = await stateManager.getSession(sessionId)
      expect(updated!.status).toBe(SyncStatus.RUNNING)
    })

    it('should allow RUNNING → COMPLETED transition', async () => {
      const sessionId = `transition-running-completed-${Date.now()}-${Math.random()}`
      const state = createTestState(sessionId, { status: SyncStatus.RUNNING })
      await stateManager.createSession(state)

      const current = await stateManager.getSession(sessionId)
      await stateManager.updateSession(sessionId, {
        ...current!,
        status: SyncStatus.COMPLETED,
        session_completed_at: new Date(),
      })

      const updated = await stateManager.getSession(sessionId)
      expect(updated!.status).toBe(SyncStatus.COMPLETED)
      expect(updated!.session_completed_at).toBeInstanceOf(Date)
    })

    it('should technically allow RUNNING → PENDING transition (backward transition)', async () => {
      // Note: RedisStateManager doesn't enforce state machine rules
      // This is by design - the SyncEngine will enforce business logic
      const sessionId = `transition-backward-${Date.now()}-${Math.random()}`
      const state = createTestState(sessionId, { status: SyncStatus.RUNNING })
      await stateManager.createSession(state)

      const current = await stateManager.getSession(sessionId)
      await stateManager.updateSession(sessionId, {
        ...current!,
        status: SyncStatus.PENDING,
      })

      const updated = await stateManager.getSession(sessionId)
      expect(updated!.status).toBe(SyncStatus.PENDING)
    })

    it('should allow COMPLETED → RUNNING transition (session restart scenario)', async () => {
      const sessionId = `transition-completed-running-${Date.now()}-${Math.random()}`
      const state = createTestState(sessionId, {
        status: SyncStatus.COMPLETED,
        session_completed_at: new Date(),
      })
      await stateManager.createSession(state)

      const current = await stateManager.getSession(sessionId)
      await stateManager.updateSession(sessionId, {
        ...current!,
        status: SyncStatus.RUNNING,
        session_completed_at: null,
      })

      const updated = await stateManager.getSession(sessionId)
      expect(updated!.status).toBe(SyncStatus.RUNNING)
      expect(updated!.session_completed_at).toBeNull()
    })
  })

  describe('Operations on COMPLETED Sessions', () => {
    it('should allow reading COMPLETED session state', async () => {
      const state = createTestState(undefined, {
        status: SyncStatus.COMPLETED,
        session_completed_at: new Date(),
      })
      const sessionId = state.session_id
      await stateManager.createSession(state)

      const retrieved = await stateManager.getSession(sessionId)
      expect(retrieved).toBeDefined()
      expect(retrieved!.status).toBe(SyncStatus.COMPLETED)
    })

    it('should allow updating COMPLETED session state', async () => {
      const state = createTestState(undefined, {
        status: SyncStatus.COMPLETED,
        session_completed_at: new Date(),
      })
      const sessionId = state.session_id
      await stateManager.createSession(state)

      const current = await stateManager.getSession(sessionId)
      expect(current).toBeDefined()
      await stateManager.updateSession(sessionId, {
        ...current!,
        participants: [
          ...current!.participants,
          {
            participant_id: 'p3',
            total_time_ms: 300000,
            time_remaining_ms: 300000,
            has_gone: false,
            is_active: false,
          },
        ],
      })

      const updated = await stateManager.getSession(sessionId)
      expect(updated).toBeDefined()
      expect(updated!.participants).toHaveLength(3)
      expect(updated!.status).toBe(SyncStatus.COMPLETED)
    })

    it('should allow deleting COMPLETED session', async () => {
      const sessionId = `completed-delete-${Date.now()}-${Math.random()}`
      const state = createTestState(sessionId, {
        status: SyncStatus.COMPLETED,
        session_completed_at: new Date(),
      })
      await stateManager.createSession(state)

      // Verify it exists
      const before = await stateManager.getSession(sessionId)
      expect(before).toBeDefined()

      // Delete
      await stateManager.deleteSession(sessionId)

      // Verify it's gone
      const after = await stateManager.getSession(sessionId)
      expect(after).toBeNull()
    })
  })

  describe('Operations on Deleted Sessions', () => {
    it('should return null when getting deleted session', async () => {
      const sessionId = `deleted-get-${Date.now()}-${Math.random()}`
      const state = createTestState(sessionId)
      await stateManager.createSession(state)

      // Delete
      await stateManager.deleteSession(sessionId)

      // Try to get
      const retrieved = await stateManager.getSession(sessionId)
      expect(retrieved).toBeNull()
    })

    it('should throw SessionNotFoundError when updating deleted session with version check', async () => {
      const sessionId = `deleted-update-${Date.now()}-${Math.random()}`
      const state = createTestState(sessionId)
      await stateManager.createSession(state)

      const current = await stateManager.getSession(sessionId)

      // Delete
      await stateManager.deleteSession(sessionId)

      // Try to update with optimistic locking
      await expect(
        stateManager.updateSession(sessionId, current!, current!.version)
      ).rejects.toThrow(SessionNotFoundError)
    })

    it('should allow updating deleted session without version check (recreates)', async () => {
      const sessionId = `deleted-update-no-version-${Date.now()}-${Math.random()}`
      const state = createTestState(sessionId)
      await stateManager.createSession(state)

      // Delete
      await stateManager.deleteSession(sessionId)

      // Verify it's gone
      const deleted = await stateManager.getSession(sessionId)
      expect(deleted).toBeNull()

      // Update without version check (effectively recreates the session)
      await stateManager.updateSession(sessionId, state)

      // Verify it exists again
      const recreated = await stateManager.getSession(sessionId)
      expect(recreated).toBeDefined()
      expect(recreated!.version).toBe(2) // Version incremented from original
    })

    it('should allow deleting already deleted session (idempotent)', async () => {
      const sessionId = `deleted-delete-again-${Date.now()}-${Math.random()}`
      const state = createTestState(sessionId)
      await stateManager.createSession(state)

      // Delete once
      await stateManager.deleteSession(sessionId)

      // Delete again (should not throw)
      await expect(stateManager.deleteSession(sessionId)).resolves.not.toThrow()
    })
  })

  describe('Single Participant Sessions', () => {
    it('should handle session with only one participant', async () => {
      const sessionId = `single-p-${Date.now()}`
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
      expect(retrieved!.active_participant_id).toBe('solo')
    })

    it('should handle updating single participant session', async () => {
      const sessionId = `single-p-update-${Date.now()}-${Math.random()}`
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
      })

      await stateManager.createSession(state)

      const current = await stateManager.getSession(sessionId)
      await stateManager.updateSession(sessionId, {
        ...current!,
        participants: [
          {
            ...current!.participants[0],
            time_remaining_ms: 500000,
            has_gone: true,
          },
        ],
      })

      const updated = await stateManager.getSession(sessionId)
      expect(updated!.participants[0].time_remaining_ms).toBe(500000)
      expect(updated!.participants[0].has_gone).toBe(true)
    })

    it('should handle transitioning single participant to completed', async () => {
      const sessionId = `single-p-complete-${Date.now()}-${Math.random()}`
      const state = createTestState(sessionId, {
        participants: [
          {
            participant_id: 'solo',
            total_time_ms: 600000,
            time_remaining_ms: 0,
            has_gone: true,
            is_active: false,
          },
        ],
        active_participant_id: null,
        status: SyncStatus.RUNNING,
      })

      await stateManager.createSession(state)

      const current = await stateManager.getSession(sessionId)
      await stateManager.updateSession(sessionId, {
        ...current!,
        status: SyncStatus.COMPLETED,
        session_completed_at: new Date(),
      })

      const updated = await stateManager.getSession(sessionId)
      expect(updated!.status).toBe(SyncStatus.COMPLETED)
      expect(updated!.participants[0].time_remaining_ms).toBe(0)
      expect(updated!.active_participant_id).toBeNull()
    })
  })

  describe('Participant State Edge Cases', () => {
    it('should handle all participants with has_gone=true', async () => {
      const sessionId = `all-gone-${Date.now()}-${Math.random()}`
      const state = createTestState(sessionId, {
        participants: [
          {
            participant_id: 'p1',
            total_time_ms: 300000,
            time_remaining_ms: 0,
            has_gone: true,
            is_active: false,
          },
          {
            participant_id: 'p2',
            total_time_ms: 300000,
            time_remaining_ms: 0,
            has_gone: true,
            is_active: false,
          },
        ],
        active_participant_id: null,
      })

      await stateManager.createSession(state)

      const retrieved = await stateManager.getSession(sessionId)
      expect(retrieved).toBeDefined()
      expect(retrieved!.participants.every(p => p.has_gone)).toBe(true)
      expect(retrieved!.active_participant_id).toBeNull()
    })

    it('should handle no active participants', async () => {
      const sessionId = `no-active-${Date.now()}-${Math.random()}`
      const state = createTestState(sessionId, {
        participants: [
          {
            participant_id: 'p1',
            total_time_ms: 300000,
            time_remaining_ms: 200000,
            has_gone: false,
            is_active: false,
          },
          {
            participant_id: 'p2',
            total_time_ms: 300000,
            time_remaining_ms: 200000,
            has_gone: false,
            is_active: false,
          },
        ],
        active_participant_id: null,
      })

      await stateManager.createSession(state)

      const retrieved = await stateManager.getSession(sessionId)
      expect(retrieved).toBeDefined()
      expect(retrieved!.participants.every(p => !p.is_active)).toBe(true)
      expect(retrieved!.active_participant_id).toBeNull()
    })

    it('should handle multiple active participants (invalid state)', async () => {
      // This is an invalid state, but RedisStateManager should store it
      const sessionId = `multi-active-${Date.now()}-${Math.random()}`
      const state = createTestState(sessionId, {
        participants: [
          {
            participant_id: 'p1',
            total_time_ms: 300000,
            time_remaining_ms: 300000,
            has_gone: false,
            is_active: true, // Both active
          },
          {
            participant_id: 'p2',
            total_time_ms: 300000,
            time_remaining_ms: 300000,
            has_gone: false,
            is_active: true, // Both active
          },
        ],
        active_participant_id: 'p1',
      })

      await stateManager.createSession(state)

      const retrieved = await stateManager.getSession(sessionId)
      expect(retrieved).toBeDefined()
      expect(retrieved!.participants.filter(p => p.is_active)).toHaveLength(2)
    })
  })

  describe('Session Lifecycle Edge Cases', () => {
    it('should handle session with session_started_at but status=PENDING', async () => {
      const sessionId = `started-pending-${Date.now()}-${Math.random()}`
      const state = createTestState(sessionId, {
        status: SyncStatus.PENDING,
        session_started_at: new Date(), // Started but still pending
      })

      await stateManager.createSession(state)

      const retrieved = await stateManager.getSession(sessionId)
      expect(retrieved).toBeDefined()
      expect(retrieved!.status).toBe(SyncStatus.PENDING)
      expect(retrieved!.session_started_at).toBeInstanceOf(Date)
    })

    it('should handle session with session_completed_at but status=RUNNING', async () => {
      const sessionId = `completed-running-${Date.now()}-${Math.random()}`
      const state = createTestState(sessionId, {
        status: SyncStatus.RUNNING,
        session_completed_at: new Date(), // Completed timestamp but still running
      })

      await stateManager.createSession(state)

      const retrieved = await stateManager.getSession(sessionId)
      expect(retrieved).toBeDefined()
      expect(retrieved!.status).toBe(SyncStatus.RUNNING)
      expect(retrieved!.session_completed_at).toBeInstanceOf(Date)
    })

    it('should handle clearing session_started_at timestamp', async () => {
      const sessionId = `clear-started-${Date.now()}-${Math.random()}`
      const state = createTestState(sessionId, {
        status: SyncStatus.RUNNING,
        session_started_at: new Date(),
      })

      await stateManager.createSession(state)

      const current = await stateManager.getSession(sessionId)
      await stateManager.updateSession(sessionId, {
        ...current!,
        session_started_at: null,
      })

      const updated = await stateManager.getSession(sessionId)
      expect(updated!.session_started_at).toBeNull()
    })

    it('should preserve created_at timestamp across updates', async () => {
      const state = createTestState()
      const sessionId = state.session_id

      await stateManager.createSession(state)

      // Get the created_at timestamp set by createSession
      const initial = await stateManager.getSession(sessionId)
      expect(initial).toBeDefined()
      const createdAt = initial!.created_at

      // Perform multiple updates
      for (let i = 0; i < 3; i++) {
        const current = await stateManager.getSession(sessionId)
        expect(current).toBeDefined()
        await stateManager.updateSession(sessionId, current!)
        await new Promise(resolve => setTimeout(resolve, 10))
      }

      const final = await stateManager.getSession(sessionId)
      expect(final).toBeDefined()
      expect(final!.created_at.toISOString()).toBe(createdAt.toISOString())
      expect(final!.version).toBe(4) // 1 (create) + 3 (updates)
    })

    it('should update updated_at timestamp on each update', async () => {
      const sessionId = `update-timestamp-${Date.now()}-${Math.random()}`
      const state = createTestState(sessionId)

      await stateManager.createSession(state)

      const first = await stateManager.getSession(sessionId)
      const firstUpdatedAt = first!.updated_at

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 100))

      // Update
      await stateManager.updateSession(sessionId, first!)

      const second = await stateManager.getSession(sessionId)
      const secondUpdatedAt = second!.updated_at

      // updated_at should have changed
      expect(secondUpdatedAt.getTime()).toBeGreaterThan(firstUpdatedAt.getTime())
    })
  })
})
