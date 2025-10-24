// SyncEngine - Core Business Logic for SyncKairos
// Manages session state transitions, time tracking, and participant rotation
//
// CRITICAL: This uses dependency injection pattern
// Accept RedisStateManager instance, do NOT create it inside!

import { RedisStateManager } from '@/state/RedisStateManager'
import { SyncState, SyncParticipant, SyncMode, SyncStatus } from '@/types/session'
import { SwitchCycleResult } from '@/types/switch-result'
import { SessionNotFoundError, ConcurrencyError } from '@/errors/StateErrors'
import { createComponentLogger } from '@/utils/logger'

const logger = createComponentLogger('SyncEngine')

/**
 * Configuration for creating a new session
 */
export interface CreateSessionConfig {
  session_id: string
  sync_mode: SyncMode
  participants: Array<{
    participant_id: string
    participant_index?: number
    total_time_ms: number
    group_id?: string
  }>
  total_time_ms: number
  time_per_cycle_ms?: number
  increment_ms?: number
  max_time_ms?: number
}

/**
 * SyncEngine - Core business logic for session management
 *
 * Responsibilities:
 * - Session lifecycle (create, start, pause, resume, complete)
 * - Time calculations and participant rotation
 * - Hot path optimization (switchCycle < 50ms target)
 *
 * Architecture:
 * - Uses RedisStateManager for all state operations
 * - Stateless - no instance-level state
 * - Optimistic locking for concurrency control
 */
export class SyncEngine {
  private stateManager: RedisStateManager

  /**
   * Create a new SyncEngine instance
   *
   * IMPORTANT: Accepts RedisStateManager via dependency injection
   * This allows for:
   * - Shared Redis connections across components
   * - Easier testing with mocks
   * - Better resource management
   *
   * @param stateManager - RedisStateManager instance
   */
  constructor(stateManager: RedisStateManager) {
    this.stateManager = stateManager
    logger.info('SyncEngine initialized')
  }

  /**
   * Create a new sync session
   *
   * Initializes a session in PENDING status with all participants
   * in their starting state. Session must be explicitly started
   * via startSession() to begin timing.
   *
   * @param config - Session configuration
   * @returns Created session state
   * @throws Error if validation fails
   */
  async createSession(config: CreateSessionConfig): Promise<SyncState> {
    logger.info({ session_id: config.session_id }, 'Creating session')

    // Validate input
    this.validateSessionId(config.session_id)
    this.validateParticipants(config.participants)
    this.validateTimeValues(config)

    const now = new Date()

    // Initialize participants with starting state
    const participants: SyncParticipant[] = config.participants.map((p, index) => ({
      participant_id: p.participant_id,
      participant_index: p.participant_index ?? index,
      total_time_ms: p.total_time_ms,
      time_used_ms: 0,
      time_remaining_ms: p.total_time_ms,
      cycle_count: 0,
      is_active: false,
      has_expired: false,
      group_id: p.group_id,
    }))

    // Build initial state
    const state: SyncState = {
      session_id: config.session_id,
      sync_mode: config.sync_mode,
      status: SyncStatus.PENDING,
      version: 1, // Will be managed by RedisStateManager

      // Participants
      participants,
      active_participant_id: null, // Set when session starts

      // Timing
      total_time_ms: config.total_time_ms,
      time_per_cycle_ms: config.time_per_cycle_ms ?? null,
      cycle_started_at: null,
      session_started_at: null,
      session_completed_at: null,

      // Configuration
      increment_ms: config.increment_ms ?? 0,
      max_time_ms: config.max_time_ms,

      // Metadata
      created_at: now,
      updated_at: now,
    }

    await this.stateManager.createSession(state)

    logger.info(
      {
        session_id: state.session_id,
        participant_count: participants.length,
        sync_mode: config.sync_mode,
      },
      'Session created'
    )

    return state
  }

  /**
   * Start a pending session
   *
   * Transitions session from PENDING to RUNNING and activates
   * the first participant. Sets session_started_at and
   * cycle_started_at timestamps.
   *
   * @param sessionId - Session UUID
   * @returns Updated session state
   * @throws SessionNotFoundError if session doesn't exist
   * @throws Error if session is not in PENDING status
   */
  async startSession(sessionId: string): Promise<SyncState> {
    logger.info({ session_id: sessionId }, 'Starting session')

    const state = await this.stateManager.getSession(sessionId)
    if (!state) {
      throw new SessionNotFoundError(sessionId)
    }

    if (state.status !== SyncStatus.PENDING) {
      throw new Error(`Session ${sessionId} cannot be started (current status: ${state.status})`)
    }

    const now = new Date()

    // Activate first participant
    state.status = SyncStatus.RUNNING
    state.active_participant_id = state.participants[0].participant_id
    state.cycle_started_at = now
    state.session_started_at = now
    state.participants[0].is_active = true
    state.updated_at = now

    await this.stateManager.updateSession(sessionId, state)

    logger.info(
      {
        session_id: sessionId,
        active_participant_id: state.active_participant_id,
      },
      'Session started'
    )

    return state
  }

  /**
   * Get current session state
   *
   * Simple passthrough to RedisStateManager. Client is responsible
   * for calculating remaining time using the "Calculate, Don't Count"
   * principle:
   *
   * time_remaining = total_time_ms - (server_now - cycle_started_at)
   *
   * @param sessionId - Session UUID
   * @returns Current session state
   * @throws SessionNotFoundError if session doesn't exist
   */
  async getCurrentState(sessionId: string): Promise<SyncState> {
    const state = await this.stateManager.getSession(sessionId)
    if (!state) {
      throw new SessionNotFoundError(sessionId)
    }
    return state
  }

  /**
   * Switch cycle to next participant
   *
   * HOT PATH METHOD - Target: <50ms (expected: 3-5ms)
   *
   * This is THE most critical method in SyncKairos. It:
   * 1. Calculates time elapsed in current cycle
   * 2. Updates current participant's time_used_ms and total_time_ms
   * 3. Checks for time expiration
   * 4. Adds increment time (Fischer mode)
   * 5. Determines and activates next participant
   * 6. Uses optimistic locking to prevent race conditions
   *
   * Performance optimizations:
   * - Redis-only operations (no PostgreSQL)
   * - Minimal calculations
   * - Optimistic locking (version check)
   *
   * @param sessionId - Session UUID
   * @param currentParticipantId - Optional current participant (for validation)
   * @param nextParticipantId - Optional explicit next participant
   * @returns Switch result with updated state
   * @throws SessionNotFoundError if session doesn't exist
   * @throws ConcurrencyError if concurrent modification detected
   * @throws Error if session not running or participant not found
   */
  async switchCycle(
    sessionId: string,
    _currentParticipantId?: string,
    nextParticipantId?: string
  ): Promise<SwitchCycleResult> {
    logger.debug({ session_id: sessionId }, 'Switching cycle')

    // 1. Get session and validate
    const state = await this.stateManager.getSession(sessionId)
    if (!state) {
      throw new SessionNotFoundError(sessionId)
    }

    if (state.status !== SyncStatus.RUNNING) {
      throw new Error(`Session ${sessionId} not running (current status: ${state.status})`)
    }

    // 2. Capture version for optimistic locking
    const expectedVersion = state.version

    const now = new Date()
    const currentParticipant = state.participants.find(
      p => p.participant_id === state.active_participant_id
    )

    let expiredParticipantId: string | undefined

    // 3. Calculate elapsed time and update current participant
    if (currentParticipant && state.cycle_started_at) {
      const elapsed = now.getTime() - state.cycle_started_at.getTime()

      // Update time tracking
      currentParticipant.time_used_ms += elapsed
      currentParticipant.total_time_ms = Math.max(0, currentParticipant.total_time_ms - elapsed)
      currentParticipant.time_remaining_ms = currentParticipant.total_time_ms
      currentParticipant.cycle_count++
      currentParticipant.is_active = false

      // Check for expiration
      if (currentParticipant.total_time_ms === 0) {
        currentParticipant.has_expired = true
        expiredParticipantId = currentParticipant.participant_id

        logger.warn(
          {
            session_id: sessionId,
            participant_id: currentParticipant.participant_id,
          },
          'Participant time expired'
        )
      }

      // Add increment time (Fischer mode)
      if (state.increment_ms && state.increment_ms > 0 && !currentParticipant.has_expired) {
        currentParticipant.total_time_ms += state.increment_ms
        currentParticipant.time_remaining_ms = currentParticipant.total_time_ms

        logger.debug(
          {
            session_id: sessionId,
            participant_id: currentParticipant.participant_id,
            increment_ms: state.increment_ms,
          },
          'Added increment time'
        )
      }
    }

    // 4. Determine next participant
    let nextParticipant: SyncParticipant | undefined

    if (nextParticipantId) {
      // Explicit next participant specified
      nextParticipant = state.participants.find(p => p.participant_id === nextParticipantId)
      if (!nextParticipant) {
        throw new Error(`Participant ${nextParticipantId} not found in session`)
      }
    } else {
      // Auto-advance to next in rotation
      const currentIndex = state.participants.findIndex(
        p => p.participant_id === state.active_participant_id
      )
      const nextIndex = (currentIndex + 1) % state.participants.length
      nextParticipant = state.participants[nextIndex]
    }

    // 5. Update state for next participant
    state.active_participant_id = nextParticipant.participant_id
    state.cycle_started_at = now
    nextParticipant.is_active = true
    state.updated_at = now

    // 6. Write to Redis with optimistic locking
    try {
      await this.stateManager.updateSession(sessionId, state, expectedVersion)
    } catch (err) {
      if (err instanceof ConcurrencyError) {
        logger.warn(
          { session_id: sessionId, expected_version: expectedVersion },
          'Concurrent modification detected during switchCycle'
        )
        throw err
      }
      throw err
    }

    logger.info(
      {
        session_id: sessionId,
        previous_participant: currentParticipant?.participant_id,
        active_participant_id: state.active_participant_id,
        expired: !!expiredParticipantId,
      },
      'Cycle switched'
    )

    // 7. Return result
    return {
      session_id: sessionId,
      active_participant_id: state.active_participant_id,
      cycle_started_at: now,
      participants: state.participants,
      status: state.status,
      expired_participant_id: expiredParticipantId,
    }
  }

  /**
   * Pause a running session
   *
   * Calculates time used before pausing and saves it.
   * Clears cycle_started_at to indicate no active cycle.
   *
   * @param sessionId - Session UUID
   * @returns Updated session state
   * @throws SessionNotFoundError if session doesn't exist
   * @throws Error if session is not running
   */
  async pauseSession(sessionId: string): Promise<SyncState> {
    logger.info({ session_id: sessionId }, 'Pausing session')

    const state = await this.stateManager.getSession(sessionId)
    if (!state) {
      throw new SessionNotFoundError(sessionId)
    }

    if (state.status !== SyncStatus.RUNNING) {
      throw new Error(`Session ${sessionId} cannot be paused (current status: ${state.status})`)
    }

    const now = new Date()

    // Calculate and save time used before pausing
    const activeParticipant = state.participants.find(p => p.is_active)
    if (activeParticipant && state.cycle_started_at) {
      const elapsed = now.getTime() - state.cycle_started_at.getTime()
      activeParticipant.time_used_ms += elapsed
      activeParticipant.total_time_ms = Math.max(0, activeParticipant.total_time_ms - elapsed)
      activeParticipant.time_remaining_ms = activeParticipant.total_time_ms
    }

    state.status = SyncStatus.PAUSED
    state.cycle_started_at = null // No active cycle while paused
    state.updated_at = now

    await this.stateManager.updateSession(sessionId, state)

    logger.info({ session_id: sessionId }, 'Session paused')

    return state
  }

  /**
   * Resume a paused session
   *
   * Transitions session back to RUNNING and restarts the cycle timer.
   * Active participant remains the same.
   *
   * @param sessionId - Session UUID
   * @returns Updated session state
   * @throws SessionNotFoundError if session doesn't exist
   * @throws Error if session is not paused
   */
  async resumeSession(sessionId: string): Promise<SyncState> {
    logger.info({ session_id: sessionId }, 'Resuming session')

    const state = await this.stateManager.getSession(sessionId)
    if (!state) {
      throw new SessionNotFoundError(sessionId)
    }

    if (state.status !== SyncStatus.PAUSED) {
      throw new Error(`Session ${sessionId} cannot be resumed (current status: ${state.status})`)
    }

    const now = new Date()

    state.status = SyncStatus.RUNNING
    state.cycle_started_at = now // Restart cycle timer
    state.updated_at = now

    await this.stateManager.updateSession(sessionId, state)

    logger.info({ session_id: sessionId }, 'Session resumed')

    return state
  }

  /**
   * Complete a session
   *
   * Marks session as COMPLETED and deactivates all participants.
   * Sets session_completed_at timestamp.
   *
   * @param sessionId - Session UUID
   * @returns Updated session state
   * @throws SessionNotFoundError if session doesn't exist
   */
  async completeSession(sessionId: string): Promise<SyncState> {
    logger.info({ session_id: sessionId }, 'Completing session')

    const state = await this.stateManager.getSession(sessionId)
    if (!state) {
      throw new SessionNotFoundError(sessionId)
    }

    const now = new Date()

    state.status = SyncStatus.COMPLETED
    state.session_completed_at = now
    state.cycle_started_at = null
    state.active_participant_id = null
    state.participants.forEach(p => (p.is_active = false))
    state.updated_at = now

    await this.stateManager.updateSession(sessionId, state)

    logger.info({ session_id: sessionId }, 'Session completed')

    return state
  }

  /**
   * Delete a session
   *
   * Removes session from Redis. This triggers:
   * - Redis deletion
   * - Pub/Sub broadcast to all instances
   * - WebSocket clients receive SESSION_DELETED message
   *
   * @param sessionId - Session UUID
   * @throws SessionNotFoundError if session doesn't exist
   */
  async deleteSession(sessionId: string): Promise<void> {
    logger.info({ session_id: sessionId }, 'Deleting session')

    await this.stateManager.deleteSession(sessionId)

    logger.info({ session_id: sessionId }, 'Session deleted')
  }

  //
  // Private validation helpers
  //

  /**
   * Validate session ID format (UUID)
   */
  private validateSessionId(sessionId: string): void {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(sessionId)) {
      throw new Error(`Invalid session_id format: ${sessionId}. Must be UUID.`)
    }
  }

  /**
   * Validate participants array
   */
  private validateParticipants(participants: CreateSessionConfig['participants']): void {
    if (!participants || participants.length < 1) {
      throw new Error('At least 1 participant required')
    }

    if (participants.length > 1000) {
      throw new Error('Maximum 1000 participants allowed')
    }

    // Check for duplicate participant IDs
    const ids = new Set<string>()
    for (const p of participants) {
      if (ids.has(p.participant_id)) {
        throw new Error(`Duplicate participant_id: ${p.participant_id}`)
      }
      ids.add(p.participant_id)

      // Validate time value
      if (p.total_time_ms < 1000) {
        throw new Error(
          `Participant ${p.participant_id} total_time_ms must be at least 1000ms (1 second)`
        )
      }

      if (p.total_time_ms > 86400000) {
        throw new Error(`Participant ${p.participant_id} total_time_ms exceeds maximum (24 hours)`)
      }
    }
  }

  /**
   * Validate time configuration values
   */
  private validateTimeValues(config: CreateSessionConfig): void {
    if (config.total_time_ms < 0) {
      throw new Error('total_time_ms must be non-negative')
    }

    if (config.time_per_cycle_ms !== undefined && config.time_per_cycle_ms < 0) {
      throw new Error('time_per_cycle_ms must be non-negative')
    }

    if (config.increment_ms !== undefined && config.increment_ms < 0) {
      throw new Error('increment_ms must be non-negative')
    }

    if (config.max_time_ms !== undefined && config.max_time_ms < 0) {
      throw new Error('max_time_ms must be non-negative')
    }
  }
}
