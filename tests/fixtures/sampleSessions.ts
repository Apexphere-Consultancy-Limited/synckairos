// Test fixtures for SyncKairos sessions
// Provides factory functions for creating mock sessions and participants

import { SyncState, SyncParticipant, SyncMode, SyncStatus } from '@/types/session'

/**
 * Create a mock participant with default or overridden values
 */
export function createMockParticipant(
  overrides?: Partial<SyncParticipant>
): SyncParticipant {
  return {
    participant_id: `participant-${Math.random().toString(36).substring(7)}`,
    participant_index: 0,
    total_time_ms: 600000, // 10 minutes default
    time_used_ms: 0,
    time_remaining_ms: 600000,
    cycle_count: 0,
    is_active: false,
    has_expired: false,
    group_id: undefined,
    ...overrides,
  }
}

/**
 * Create a mock session with default or overridden values
 */
export function createMockSession(
  overrides?: Partial<SyncState>
): SyncState {
  const now = new Date()

  // Default: 2 participants with 10 minutes each
  const defaultParticipants: SyncParticipant[] = [
    createMockParticipant({
      participant_id: 'player1',
      participant_index: 0,
    }),
    createMockParticipant({
      participant_id: 'player2',
      participant_index: 1,
    }),
  ]

  return {
    session_id: `session-${Math.random().toString(36).substring(7)}`,
    sync_mode: SyncMode.PER_PARTICIPANT,
    status: SyncStatus.PENDING,
    version: 1,

    // Participants
    participants: defaultParticipants,
    active_participant_id: null,

    // Timing
    total_time_ms: 600000, // 10 minutes
    time_per_cycle_ms: null,
    cycle_started_at: null,
    session_started_at: null,
    session_completed_at: null,

    // Configuration
    increment_ms: 0,
    max_time_ms: undefined,

    // Metadata
    created_at: now,
    updated_at: now,

    ...overrides,
  }
}

/**
 * Create a chess-style session (2 players, 10 minutes each, 2s increment)
 */
export function createChessSession(sessionId?: string): SyncState {
  return createMockSession({
    session_id: sessionId ?? 'chess-session-1',
    sync_mode: SyncMode.PER_PARTICIPANT,
    increment_ms: 2000, // 2 second Fischer increment
    participants: [
      createMockParticipant({
        participant_id: 'white',
        participant_index: 0,
        total_time_ms: 600000, // 10 minutes
        time_remaining_ms: 600000,
      }),
      createMockParticipant({
        participant_id: 'black',
        participant_index: 1,
        total_time_ms: 600000,
        time_remaining_ms: 600000,
      }),
    ],
  })
}

/**
 * Create a running session (already started)
 */
export function createRunningSession(sessionId?: string): SyncState {
  const now = new Date()
  const session = createMockSession({
    session_id: sessionId ?? 'running-session-1',
    status: SyncStatus.RUNNING,
    active_participant_id: 'player1',
    cycle_started_at: now,
    session_started_at: now,
  })

  // Mark first participant as active
  session.participants[0].is_active = true

  return session
}

/**
 * Create a session with expired participant
 */
export function createExpiredParticipantSession(): SyncState {
  const session = createRunningSession('expired-session-1')

  // First participant has no time left
  session.participants[0].total_time_ms = 0
  session.participants[0].time_remaining_ms = 0
  session.participants[0].has_expired = true
  session.participants[0].time_used_ms = 600000

  return session
}

/**
 * Create a multi-participant session (for testing rotation)
 */
export function createMultiParticipantSession(numParticipants: number): SyncState {
  const participants: SyncParticipant[] = []

  for (let i = 0; i < numParticipants; i++) {
    participants.push(
      createMockParticipant({
        participant_id: `player${i + 1}`,
        participant_index: i,
        total_time_ms: 300000, // 5 minutes each
        time_remaining_ms: 300000,
      })
    )
  }

  return createMockSession({
    session_id: 'multi-participant-session',
    participants,
  })
}

/**
 * Create a session with custom time values (for testing edge cases)
 */
export function createShortTimerSession(timeMs: number): SyncState {
  return createMockSession({
    session_id: 'short-timer-session',
    participants: [
      createMockParticipant({
        participant_id: 'player1',
        participant_index: 0,
        total_time_ms: timeMs,
        time_remaining_ms: timeMs,
      }),
      createMockParticipant({
        participant_id: 'player2',
        participant_index: 1,
        total_time_ms: timeMs,
        time_remaining_ms: timeMs,
      }),
    ],
  })
}
