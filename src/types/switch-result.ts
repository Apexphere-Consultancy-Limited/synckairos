// Result type for switchCycle() operation
// Contains the updated state after switching active participant

import { SyncParticipant } from './session'

/**
 * Result returned from switchCycle() operation
 *
 * This provides all information needed to update clients about
 * the cycle switch without requiring a full state fetch
 */
export interface SwitchCycleResult {
  /** Session identifier */
  session_id: string

  /** New active participant (or null if session ended) */
  active_participant_id: string | null

  /** Timestamp when new cycle started */
  cycle_started_at: Date

  /** Updated participant states with new times */
  participants: SyncParticipant[]

  /** Current session status */
  status: string

  /** Participant ID that ran out of time (if any) */
  expired_participant_id?: string
}
