// State Transition Edge Case Tests
// Testing invalid state transitions, operations on completed/deleted sessions

import { describe, it, expect } from 'vitest'
import { RedisStateManager } from '@/state/RedisStateManager'
import { createRedisClient, createRedisPubSubClient } from '@/config/redis'
import { SyncMode, SyncStatus, type SyncState } from '@/types/session'
import { SessionNotFoundError } from '@/errors/StateErrors'
import type Redis from 'ioredis'

describe('State Transitions - Edge Cases', () => {
  // Helper to create isolated state manager instance for each test
  const createStateManager = (): {
    stateManager: RedisStateManager
    redisClient: Redis
    pubSubClient: Redis
  } => {
    const uniquePrefix = `test:${Date.now()}-${Math.random()}:`
    const redisClient = createRedisClient()
    const pubSubClient = createRedisPubSubClient()
    const stateManager = new RedisStateManager(redisClient, pubSubClient, undefined, uniquePrefix)
    return { stateManager, redisClient, pubSubClient }
  }

  // Helper to cleanup state manager
  const cleanupStateManager = async (context: {
    stateManager: RedisStateManager
    redisClient: Redis
    pubSubClient: Redis
  }) => {
    await context.stateManager.close()
  }

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
      const ctx = createStateManager()
      try {
        const sessionId = `transition-pending-running-${Date.now()}-${Math.random()}`
        const state = createTestState(sessionId, { status: SyncStatus.PENDING })
        await ctx.stateManager.createSession(state)

        const current = await ctx.stateManager.getSession(sessionId)
        await ctx.stateManager.updateSession(sessionId, {
          ...current!,
          status: SyncStatus.RUNNING,
          session_started_at: new Date(),
        })

        const updated = await ctx.stateManager.getSession(sessionId)
        expect(updated!.status).toBe(SyncStatus.RUNNING)
      } finally {
        await cleanupStateManager(ctx)
      }
    })

    it('should allow RUNNING → PAUSED transition', async () => {
      const ctx = createStateManager()
      try {
        const sessionId = `transition-running-paused-${Date.now()}-${Math.random()}`
        const state = createTestState(sessionId, { status: SyncStatus.RUNNING })
        await ctx.stateManager.createSession(state)

        const current = await ctx.stateManager.getSession(sessionId)
        await ctx.stateManager.updateSession(sessionId, {
          ...current!,
          status: SyncStatus.PAUSED,
        })

        const updated = await ctx.stateManager.getSession(sessionId)
        expect(updated!.status).toBe(SyncStatus.PAUSED)
      } finally {
        await cleanupStateManager(ctx)
      }
    })

    it('should allow PAUSED → RUNNING transition', async () => {
      const ctx = createStateManager()
      try {
        const sessionId = `transition-paused-running-${Date.now()}-${Math.random()}`
        const state = createTestState(sessionId, { status: SyncStatus.PAUSED })
        await ctx.stateManager.createSession(state)

        const current = await ctx.stateManager.getSession(sessionId)
        await ctx.stateManager.updateSession(sessionId, {
          ...current!,
          status: SyncStatus.RUNNING,
        })

        const updated = await ctx.stateManager.getSession(sessionId)
        expect(updated!.status).toBe(SyncStatus.RUNNING)
      } finally {
        await cleanupStateManager(ctx)
      }
    })

    it('should allow RUNNING → COMPLETED transition', async () => {
      const ctx = createStateManager()
      try {
        const sessionId = `transition-running-completed-${Date.now()}-${Math.random()}`
        const state = createTestState(sessionId, { status: SyncStatus.RUNNING })
        await ctx.stateManager.createSession(state)

        const current = await ctx.stateManager.getSession(sessionId)
        await ctx.stateManager.updateSession(sessionId, {
          ...current!,
          status: SyncStatus.COMPLETED,
          session_completed_at: new Date(),
        })

        const updated = await ctx.stateManager.getSession(sessionId)
        expect(updated!.status).toBe(SyncStatus.COMPLETED)
        expect(updated!.session_completed_at).toBeInstanceOf(Date)
      } finally {
        await cleanupStateManager(ctx)
      }
    })

    it('should technically allow RUNNING → PENDING transition (backward transition)', async () => {
      const ctx = createStateManager()
      try {
        // Note: RedisStateManager doesn't enforce state machine rules
        // This is by design - the SyncEngine will enforce business logic
        const sessionId = `transition-backward-${Date.now()}-${Math.random()}`
        const state = createTestState(sessionId, { status: SyncStatus.RUNNING })
        await ctx.stateManager.createSession(state)

        const current = await ctx.stateManager.getSession(sessionId)
        await ctx.stateManager.updateSession(sessionId, {
          ...current!,
          status: SyncStatus.PENDING,
        })

        const updated = await ctx.stateManager.getSession(sessionId)
        expect(updated!.status).toBe(SyncStatus.PENDING)
      } finally {
        await cleanupStateManager(ctx)
      }
    })

    it('should allow COMPLETED → RUNNING transition (session restart scenario)', async () => {
      const ctx = createStateManager()
      try {
        const sessionId = `transition-completed-running-${Date.now()}-${Math.random()}`
        const state = createTestState(sessionId, {
          status: SyncStatus.COMPLETED,
          session_completed_at: new Date(),
        })
        await ctx.stateManager.createSession(state)

        const current = await ctx.stateManager.getSession(sessionId)
        await ctx.stateManager.updateSession(sessionId, {
          ...current!,
          status: SyncStatus.RUNNING,
          session_completed_at: null,
        })

        const updated = await ctx.stateManager.getSession(sessionId)
        expect(updated!.status).toBe(SyncStatus.RUNNING)
        expect(updated!.session_completed_at).toBeNull()
      } finally {
        await cleanupStateManager(ctx)
      }
    })
  })

  describe('Operations on COMPLETED Sessions', () => {
    it('should allow reading COMPLETED session state', async () => {
      const ctx = createStateManager()
      try {
        const state = createTestState(undefined, {
          status: SyncStatus.COMPLETED,
          session_completed_at: new Date(),
        })
        const sessionId = state.session_id
        await ctx.stateManager.createSession(state)

        const retrieved = await ctx.stateManager.getSession(sessionId)
        expect(retrieved).toBeDefined()
        expect(retrieved!.status).toBe(SyncStatus.COMPLETED)
      } finally {
        await cleanupStateManager(ctx)
      }
    })

    it('should allow updating COMPLETED session state', async () => {
      const ctx = createStateManager()
      try {
        const state = createTestState(undefined, {
          status: SyncStatus.COMPLETED,
          session_completed_at: new Date(),
        })
        const sessionId = state.session_id
        await ctx.stateManager.createSession(state)

        const current = await ctx.stateManager.getSession(sessionId)
        expect(current).toBeDefined()
        await ctx.stateManager.updateSession(sessionId, {
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

        const updated = await ctx.stateManager.getSession(sessionId)
        expect(updated).toBeDefined()
        expect(updated!.participants).toHaveLength(3)
        expect(updated!.status).toBe(SyncStatus.COMPLETED)
      } finally {
        await cleanupStateManager(ctx)
      }
    })

    it('should allow deleting COMPLETED session', async () => {
      const ctx = createStateManager()
      try {
        const sessionId = `completed-delete-${Date.now()}-${Math.random()}`
        const state = createTestState(sessionId, {
          status: SyncStatus.COMPLETED,
          session_completed_at: new Date(),
        })
        await ctx.stateManager.createSession(state)

        // Verify it exists
        const before = await ctx.stateManager.getSession(sessionId)
        expect(before).toBeDefined()

        // Delete
        await ctx.stateManager.deleteSession(sessionId)

        // Verify it's gone
        const after = await ctx.stateManager.getSession(sessionId)
        expect(after).toBeNull()
      } finally {
        await cleanupStateManager(ctx)
      }
    })
  })

  describe('Operations on Deleted Sessions', () => {
    it('should return null when getting deleted session', async () => {
      const ctx = createStateManager()
      try {
        const sessionId = `deleted-get-${Date.now()}-${Math.random()}`
        const state = createTestState(sessionId)
        await ctx.stateManager.createSession(state)

        // Delete
        await ctx.stateManager.deleteSession(sessionId)

        // Try to get
        const retrieved = await ctx.stateManager.getSession(sessionId)
        expect(retrieved).toBeNull()
      } finally {
        await cleanupStateManager(ctx)
      }
    })

    it('should throw SessionNotFoundError when updating deleted session with version check', async () => {
      const ctx = createStateManager()
      try {
        const sessionId = `deleted-update-${Date.now()}-${Math.random()}`
        const state = createTestState(sessionId)
        await ctx.stateManager.createSession(state)

        const current = await ctx.stateManager.getSession(sessionId)

        // Delete
        await ctx.stateManager.deleteSession(sessionId)

        // Try to update with optimistic locking
        await expect(
          ctx.stateManager.updateSession(sessionId, current!, current!.version)
        ).rejects.toThrow(SessionNotFoundError)
      } finally {
        await cleanupStateManager(ctx)
      }
    })

    it('should allow updating deleted session without version check (recreates)', async () => {
      const ctx = createStateManager()
      try {
        const sessionId = `deleted-update-no-version-${Date.now()}-${Math.random()}`
        const state = createTestState(sessionId)
        await ctx.stateManager.createSession(state)

        // Delete
        await ctx.stateManager.deleteSession(sessionId)

        // Verify it's gone
        const deleted = await ctx.stateManager.getSession(sessionId)
        expect(deleted).toBeNull()

        // Update without version check (effectively recreates the session)
        await ctx.stateManager.updateSession(sessionId, state)

        // Verify it exists again
        const recreated = await ctx.stateManager.getSession(sessionId)
        expect(recreated).toBeDefined()
        expect(recreated!.version).toBe(2) // Version incremented from original
      } finally {
        await cleanupStateManager(ctx)
      }
    })

    it('should allow deleting already deleted session (idempotent)', async () => {
      const ctx = createStateManager()
      try {
        const sessionId = `deleted-delete-again-${Date.now()}-${Math.random()}`
        const state = createTestState(sessionId)
        await ctx.stateManager.createSession(state)

        // Delete once
        await ctx.stateManager.deleteSession(sessionId)

        // Delete again (should not throw)
        await expect(ctx.stateManager.deleteSession(sessionId)).resolves.not.toThrow()
      } finally {
        await cleanupStateManager(ctx)
      }
    })
  })

  describe('Single Participant Sessions', () => {
    it('should handle session with only one participant', async () => {
      const ctx = createStateManager()
      try {
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

        await ctx.stateManager.createSession(state)

        const retrieved = await ctx.stateManager.getSession(sessionId)
        expect(retrieved).toBeDefined()
        expect(retrieved!.participants).toHaveLength(1)
        expect(retrieved!.active_participant_id).toBe('solo')
      } finally {
        await cleanupStateManager(ctx)
      }
    })

    it('should handle updating single participant session', async () => {
      const ctx = createStateManager()
      try {
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

        await ctx.stateManager.createSession(state)

        const current = await ctx.stateManager.getSession(sessionId)
        await ctx.stateManager.updateSession(sessionId, {
          ...current!,
          participants: [
            {
              ...current!.participants[0],
              time_remaining_ms: 500000,
              has_gone: true,
            },
          ],
        })

        const updated = await ctx.stateManager.getSession(sessionId)
        expect(updated!.participants[0].time_remaining_ms).toBe(500000)
        expect(updated!.participants[0].has_gone).toBe(true)
      } finally {
        await cleanupStateManager(ctx)
      }
    })

    it('should handle transitioning single participant to completed', async () => {
      const ctx = createStateManager()
      try {
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

        await ctx.stateManager.createSession(state)

        const current = await ctx.stateManager.getSession(sessionId)
        await ctx.stateManager.updateSession(sessionId, {
          ...current!,
          status: SyncStatus.COMPLETED,
          session_completed_at: new Date(),
        })

        const updated = await ctx.stateManager.getSession(sessionId)
        expect(updated!.status).toBe(SyncStatus.COMPLETED)
        expect(updated!.participants[0].time_remaining_ms).toBe(0)
        expect(updated!.active_participant_id).toBeNull()
      } finally {
        await cleanupStateManager(ctx)
      }
    })
  })

  describe('Participant State Edge Cases', () => {
    it('should handle all participants with has_gone=true', async () => {
      const ctx = createStateManager()
      try {
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

        await ctx.stateManager.createSession(state)

        const retrieved = await ctx.stateManager.getSession(sessionId)
        expect(retrieved).toBeDefined()
        expect(retrieved!.participants.every((p: any) => p.has_gone)).toBe(true)
        expect(retrieved!.active_participant_id).toBeNull()
      } finally {
        await cleanupStateManager(ctx)
      }
    })

    it('should handle no active participants', async () => {
      const ctx = createStateManager()
      try {
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

        await ctx.stateManager.createSession(state)

        const retrieved = await ctx.stateManager.getSession(sessionId)
        expect(retrieved).toBeDefined()
        expect(retrieved!.participants.every((p: any) => !p.is_active)).toBe(true)
        expect(retrieved!.active_participant_id).toBeNull()
      } finally {
        await cleanupStateManager(ctx)
      }
    })

    it('should handle multiple active participants (invalid state)', async () => {
      const ctx = createStateManager()
      try {
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

        await ctx.stateManager.createSession(state)

        const retrieved = await ctx.stateManager.getSession(sessionId)
        expect(retrieved).toBeDefined()
        expect(retrieved!.participants.filter((p: any) => p.is_active)).toHaveLength(2)
      } finally {
        await cleanupStateManager(ctx)
      }
    })
  })

  describe('Session Lifecycle Edge Cases', () => {
    it('should handle session with session_started_at but status=PENDING', async () => {
      const ctx = createStateManager()
      try {
        const sessionId = `started-pending-${Date.now()}-${Math.random()}`
        const state = createTestState(sessionId, {
          status: SyncStatus.PENDING,
          session_started_at: new Date(), // Started but still pending
        })

        await ctx.stateManager.createSession(state)

        const retrieved = await ctx.stateManager.getSession(sessionId)
        expect(retrieved).toBeDefined()
        expect(retrieved!.status).toBe(SyncStatus.PENDING)
        expect(retrieved!.session_started_at).toBeInstanceOf(Date)
      } finally {
        await cleanupStateManager(ctx)
      }
    })

    it('should handle session with session_completed_at but status=RUNNING', async () => {
      const ctx = createStateManager()
      try {
        const sessionId = `completed-running-${Date.now()}-${Math.random()}`
        const state = createTestState(sessionId, {
          status: SyncStatus.RUNNING,
          session_completed_at: new Date(), // Completed timestamp but still running
        })

        await ctx.stateManager.createSession(state)

        const retrieved = await ctx.stateManager.getSession(sessionId)
        expect(retrieved).toBeDefined()
        expect(retrieved!.status).toBe(SyncStatus.RUNNING)
        expect(retrieved!.session_completed_at).toBeInstanceOf(Date)
      } finally {
        await cleanupStateManager(ctx)
      }
    })

    it('should handle clearing session_started_at timestamp', async () => {
      const ctx = createStateManager()
      try {
        const sessionId = `clear-started-${Date.now()}-${Math.random()}`
        const state = createTestState(sessionId, {
          status: SyncStatus.RUNNING,
          session_started_at: new Date(),
        })

        await ctx.stateManager.createSession(state)

        const current = await ctx.stateManager.getSession(sessionId)
        await ctx.stateManager.updateSession(sessionId, {
          ...current!,
          session_started_at: null,
        })

        const updated = await ctx.stateManager.getSession(sessionId)
        expect(updated!.session_started_at).toBeNull()
      } finally {
        await cleanupStateManager(ctx)
      }
    })

    it('should preserve created_at timestamp across updates', async () => {
      const ctx = createStateManager()
      try {
        const state = createTestState()
        const sessionId = state.session_id

        await ctx.stateManager.createSession(state)

        // Get the created_at timestamp set by createSession
        const initial = await ctx.stateManager.getSession(sessionId)
        expect(initial).toBeDefined()
        const createdAt = initial!.created_at

        // Perform multiple updates
        for (let i = 0; i < 3; i++) {
          const current = await ctx.stateManager.getSession(sessionId)
          expect(current).toBeDefined()
          await ctx.stateManager.updateSession(sessionId, current!)
          await new Promise(resolve => setTimeout(resolve, 10))
        }

        const final = await ctx.stateManager.getSession(sessionId)
        expect(final).toBeDefined()
        expect(final!.created_at.toISOString()).toBe(createdAt.toISOString())
        expect(final!.version).toBe(4) // 1 (create) + 3 (updates)
      } finally {
        await cleanupStateManager(ctx)
      }
    })

    it('should update updated_at timestamp on each update', async () => {
      const ctx = createStateManager()
      try {
        const sessionId = `update-timestamp-${Date.now()}-${Math.random()}`
        const state = createTestState(sessionId)

        await ctx.stateManager.createSession(state)

        const first = await ctx.stateManager.getSession(sessionId)
        const firstUpdatedAt = first!.updated_at

        // Wait a bit
        await new Promise(resolve => setTimeout(resolve, 100))

        // Update
        await ctx.stateManager.updateSession(sessionId, first!)

        const second = await ctx.stateManager.getSession(sessionId)
        const secondUpdatedAt = second!.updated_at

        // updated_at should have changed
        expect(secondUpdatedAt.getTime()).toBeGreaterThan(firstUpdatedAt.getTime())
      } finally {
        await cleanupStateManager(ctx)
      }
    })
  })
})
