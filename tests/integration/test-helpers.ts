/**
 * Integration Test Helpers
 * Shared utilities for integration tests
 */

import { v4 as uuidv4 } from 'uuid'
import { SyncState } from '@/types/session'

/**
 * Helper to create test state with valid UUIDs
 */
export function createTestState(sessionId: string, participantId: string = uuidv4()): SyncState {
  return {
    session_id: sessionId,
    sync_mode: 'per_participant',
    status: 'pending',
    time_per_cycle_ms: 60000,
    increment_ms: 0,
    max_time_ms: null,
    participants: [
      {
        participant_id: participantId,
        total_time_ms: 60000,
        time_remaining_ms: 60000,
        group_id: null,
      },
    ],
    active_participant_id: null,
    current_cycle: 0,
    created_at: new Date(),
    updated_at: new Date(),
    session_started_at: null,
    session_completed_at: null,
    version: 1,
  }
}
