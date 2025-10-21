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
  total_time_ms: number
  time_remaining_ms: number
  has_gone: boolean
  is_active: boolean
  group_id?: string
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
