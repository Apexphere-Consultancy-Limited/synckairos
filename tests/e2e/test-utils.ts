/**
 * E2E Test Utilities
 * Shared helpers and constants for E2E tests
 */

import { v4 as uuidv4 } from 'uuid'

/**
 * Standard test participant UUIDs (valid UUID v4 format)
 * Use these for consistent test data
 */
export const TEST_PARTICIPANTS = {
  P1: '223e4567-e89b-12d3-a456-426614174001',
  P2: '223e4567-e89b-12d3-a456-426614174002',
  P3: '223e4567-e89b-12d3-a456-426614174003',
  P4: '223e4567-e89b-12d3-a456-426614174004',
  P5: '223e4567-e89b-12d3-a456-426614174005',
} as const

/**
 * Standard test group UUIDs (valid UUID v4 format)
 */
export const TEST_GROUPS = {
  GROUP_A: '323e4567-e89b-12d3-a456-426614174001',
  GROUP_B: '323e4567-e89b-12d3-a456-426614174002',
} as const

/**
 * Generate a test session ID (valid UUID v4)
 */
export function generateSessionId(prefix?: string): string {
  // Generate a valid UUID v4
  return uuidv4()
}

/**
 * Create a valid participant object for tests
 */
export function createParticipant(
  participantId: string,
  index: number,
  totalTimeMs: number = 60000,
  groupId?: string
) {
  return {
    participant_id: participantId,
    participant_index: index,
    total_time_ms: totalTimeMs,
    ...(groupId && { group_id: groupId }),
  }
}

/**
 * Create a valid session payload for tests
 */
export function createSessionPayload(
  sessionId: string,
  participants: ReturnType<typeof createParticipant>[],
  options?: {
    sync_mode?: 'per_participant' | 'per_cycle' | 'per_group' | 'global' | 'count_up'
    total_time_ms?: number
    time_per_cycle_ms?: number
    increment_ms?: number
  }
) {
  const totalTime = options?.total_time_ms ?? participants.reduce((sum, p) => sum + p.total_time_ms, 0)

  return {
    session_id: sessionId,
    sync_mode: options?.sync_mode ?? 'per_participant',
    participants,
    total_time_ms: totalTime,
    ...(options?.time_per_cycle_ms && { time_per_cycle_ms: options.time_per_cycle_ms }),
    ...(options?.increment_ms && { increment_ms: options.increment_ms }),
  }
}
