// Type definitions for SyncKairos sessions
// Redis-first distributed synchronization state

export enum SyncMode {
  PER_PARTICIPANT = 'per_participant',
  PER_CYCLE = 'per_cycle',
  PER_GROUP = 'per_group',
  GLOBAL = 'global',
  COUNT_UP = 'count_up',
}

export enum SyncStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  PAUSED = 'paused',
  EXPIRED = 'expired',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export interface SyncParticipant {
  participant_id: string
  participant_index: number // Position in rotation order
  total_time_ms: number // Total time remaining
  time_used_ms: number // Total time consumed
  time_remaining_ms: number // Calculated remaining time (for display)
  cycle_count: number // Number of cycles/turns taken
  is_active: boolean // Currently active participant
  has_expired: boolean // Time ran out
  group_id?: string // Optional group assignment
}

export interface SyncState {
  session_id: string
  sync_mode: SyncMode
  status: SyncStatus
  version: number // For optimistic locking

  // Participants
  participants: SyncParticipant[]
  active_participant_id: string | null

  // Timing (all server-side timestamps)
  total_time_ms: number
  time_per_cycle_ms: number | null
  cycle_started_at: Date | null
  session_started_at: Date | null
  session_completed_at: Date | null

  // Count-up mode
  increment_ms?: number
  max_time_ms?: number

  // Metadata
  created_at: Date
  updated_at: Date
}
