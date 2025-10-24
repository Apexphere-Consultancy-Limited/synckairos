/**
 * Contract Tests - WebSocket API Schemas
 *
 * Validates that Zod schemas match actual WebSocket implementation
 * - Ensures runtime validation matches TypeScript types
 * - Catches schema drift from implementation
 * - Documents API contract expectations
 */

import { describe, it, expect } from 'vitest'
import {
  ServerMessageSchema,
  WSConnectedMessageSchema,
  WSStateUpdateMessageSchema,
  WSStateSyncMessageSchema,
  WSSessionDeletedMessageSchema,
  WSPongMessageSchema,
  WSErrorMessageSchema,
  ClientMessageSchema,
  WSPingMessageSchema,
  WSRequestSyncMessageSchema,
  SyncStateSchema,
  SyncParticipantSchema,
} from '../../src/types/api-contracts'

describe('WebSocket Server Messages', () => {
  it('validates CONNECTED message', () => {
    const message = {
      type: 'CONNECTED',
      sessionId: 'test-session',
      timestamp: Date.now(),
    }

    const result = WSConnectedMessageSchema.safeParse(message)
    expect(result.success).toBe(true)
  })

  it('validates STATE_UPDATE message with full state', () => {
    const message = {
      type: 'STATE_UPDATE',
      sessionId: 'test-session',
      timestamp: Date.now(),
      state: {
        session_id: 'test-session',
        sync_mode: 'per_participant',
        status: 'running',
        version: 1,
        participants: [
          {
            participant_id: 'p1',
            participant_index: 0,
            total_time_ms: 300000,
            time_used_ms: 5000,
            time_remaining_ms: 295000,
            cycle_count: 1,
            is_active: true,
            has_expired: false,
          },
        ],
        active_participant_id: 'p1',
        total_time_ms: 300000,
        time_per_cycle_ms: null,
        cycle_started_at: new Date().toISOString(),
        session_started_at: new Date().toISOString(),
        session_completed_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    }

    const result = WSStateUpdateMessageSchema.safeParse(message)
    expect(result.success).toBe(true)
  })

  it('validates STATE_SYNC message (for reconnection)', () => {
    const message = {
      type: 'STATE_SYNC',
      sessionId: 'test-session',
      timestamp: Date.now(),
      state: {
        session_id: 'test-session',
        sync_mode: 'per_participant',
        status: 'running',
        version: 5,
        participants: [],
        active_participant_id: null,
        total_time_ms: 0,
        time_per_cycle_ms: null,
        cycle_started_at: null,
        session_started_at: null,
        session_completed_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    }

    const result = WSStateSyncMessageSchema.safeParse(message)
    expect(result.success).toBe(true)
  })

  it('validates SESSION_DELETED message', () => {
    const message = {
      type: 'SESSION_DELETED',
      sessionId: 'test-session',
      timestamp: Date.now(),
    }

    const result = WSSessionDeletedMessageSchema.safeParse(message)
    expect(result.success).toBe(true)
  })

  it('validates PONG message', () => {
    const message = {
      type: 'PONG',
      timestamp: Date.now(),
    }

    const result = WSPongMessageSchema.safeParse(message)
    expect(result.success).toBe(true)
  })

  it('validates ERROR message', () => {
    const message = {
      type: 'ERROR',
      error: 'Session not found',
      code: 'SESSION_NOT_FOUND',
      timestamp: Date.now(),
    }

    const result = WSErrorMessageSchema.safeParse(message)
    expect(result.success).toBe(true)
  })

  it('validates ServerMessage discriminated union', () => {
    const messages = [
      { type: 'CONNECTED', sessionId: 'test', timestamp: Date.now() },
      { type: 'PONG', timestamp: Date.now() },
      { type: 'ERROR', error: 'Test error', timestamp: Date.now() },
    ]

    messages.forEach(msg => {
      const result = ServerMessageSchema.safeParse(msg)
      expect(result.success).toBe(true)
    })
  })

  it('rejects invalid message types', () => {
    const invalidMessage = {
      type: 'INVALID_TYPE',
      sessionId: 'test',
      timestamp: Date.now(),
    }

    const result = ServerMessageSchema.safeParse(invalidMessage)
    expect(result.success).toBe(false)
  })

  it('rejects STATE_UPDATE with missing state', () => {
    const invalidMessage = {
      type: 'STATE_UPDATE',
      sessionId: 'test',
      timestamp: Date.now(),
      // Missing 'state' field
    }

    const result = WSStateUpdateMessageSchema.safeParse(invalidMessage)
    expect(result.success).toBe(false)
  })
})

describe('WebSocket Client Messages', () => {
  it('validates PING message', () => {
    const message = {
      type: 'PING',
    }

    const result = WSPingMessageSchema.safeParse(message)
    expect(result.success).toBe(true)
  })

  it('validates REQUEST_SYNC message', () => {
    const message = {
      type: 'REQUEST_SYNC',
    }

    const result = WSRequestSyncMessageSchema.safeParse(message)
    expect(result.success).toBe(true)
  })

  it('validates ClientMessage discriminated union', () => {
    const messages = [{ type: 'PING' }, { type: 'REQUEST_SYNC' }]

    messages.forEach(msg => {
      const result = ClientMessageSchema.safeParse(msg)
      expect(result.success).toBe(true)
    })
  })

  it('rejects invalid client message types', () => {
    const invalidMessage = {
      type: 'INVALID_CLIENT_TYPE',
    }

    const result = ClientMessageSchema.safeParse(invalidMessage)
    expect(result.success).toBe(false)
  })
})

describe('SyncState Schema', () => {
  it('validates complete SyncState object', () => {
    const state = {
      session_id: 'test-session',
      sync_mode: 'per_participant',
      status: 'running',
      version: 1,
      participants: [
        {
          participant_id: 'p1',
          participant_index: 0,
          total_time_ms: 300000,
          time_used_ms: 0,
          time_remaining_ms: 300000,
          cycle_count: 0,
          is_active: true,
          has_expired: false,
        },
        {
          participant_id: 'p2',
          participant_index: 1,
          total_time_ms: 300000,
          time_used_ms: 0,
          time_remaining_ms: 300000,
          cycle_count: 0,
          is_active: false,
          has_expired: false,
          group_id: 'group-a',
        },
      ],
      active_participant_id: 'p1',
      total_time_ms: 600000,
      time_per_cycle_ms: 60000,
      cycle_started_at: new Date().toISOString(),
      session_started_at: new Date().toISOString(),
      session_completed_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    const result = SyncStateSchema.safeParse(state)
    expect(result.success).toBe(true)
  })

  it('validates all sync modes', () => {
    const modes = ['per_participant', 'per_cycle', 'per_group', 'global', 'count_up']

    modes.forEach(mode => {
      const state = {
        session_id: 'test',
        sync_mode: mode,
        status: 'pending',
        version: 0,
        participants: [],
        active_participant_id: null,
        total_time_ms: 0,
        time_per_cycle_ms: null,
        cycle_started_at: null,
        session_started_at: null,
        session_completed_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      const result = SyncStateSchema.safeParse(state)
      expect(result.success).toBe(true)
    })
  })

  it('validates all sync statuses', () => {
    const statuses = ['pending', 'running', 'paused', 'expired', 'completed', 'cancelled']

    statuses.forEach(status => {
      const state = {
        session_id: 'test',
        sync_mode: 'per_participant',
        status: status,
        version: 0,
        participants: [],
        active_participant_id: null,
        total_time_ms: 0,
        time_per_cycle_ms: null,
        cycle_started_at: null,
        session_started_at: null,
        session_completed_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      const result = SyncStateSchema.safeParse(state)
      expect(result.success).toBe(true)
    })
  })

  it('rejects invalid sync mode', () => {
    const state = {
      session_id: 'test',
      sync_mode: 'invalid_mode',
      status: 'pending',
      version: 0,
      participants: [],
      active_participant_id: null,
      total_time_ms: 0,
      time_per_cycle_ms: null,
      cycle_started_at: null,
      session_started_at: null,
      session_completed_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    const result = SyncStateSchema.safeParse(state)
    expect(result.success).toBe(false)
  })

  it('rejects negative time values', () => {
    const state = {
      session_id: 'test',
      sync_mode: 'per_participant',
      status: 'running',
      version: 0,
      participants: [],
      active_participant_id: null,
      total_time_ms: -1000, // Invalid negative time
      time_per_cycle_ms: null,
      cycle_started_at: null,
      session_started_at: null,
      session_completed_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    const result = SyncStateSchema.safeParse(state)
    expect(result.success).toBe(false)
  })
})

describe('SyncParticipant Schema', () => {
  it('validates participant with all fields', () => {
    const participant = {
      participant_id: 'p1',
      participant_index: 0,
      total_time_ms: 300000,
      time_used_ms: 5000,
      time_remaining_ms: 295000,
      cycle_count: 2,
      is_active: true,
      has_expired: false,
      group_id: 'group-a',
    }

    const result = SyncParticipantSchema.safeParse(participant)
    expect(result.success).toBe(true)
  })

  it('validates participant without optional group_id', () => {
    const participant = {
      participant_id: 'p1',
      participant_index: 0,
      total_time_ms: 300000,
      time_used_ms: 0,
      time_remaining_ms: 300000,
      cycle_count: 0,
      is_active: false,
      has_expired: false,
    }

    const result = SyncParticipantSchema.safeParse(participant)
    expect(result.success).toBe(true)
  })

  it('rejects negative participant_index', () => {
    const participant = {
      participant_id: 'p1',
      participant_index: -1,
      total_time_ms: 300000,
      time_used_ms: 0,
      time_remaining_ms: 300000,
      cycle_count: 0,
      is_active: false,
      has_expired: false,
    }

    const result = SyncParticipantSchema.safeParse(participant)
    expect(result.success).toBe(false)
  })
})
