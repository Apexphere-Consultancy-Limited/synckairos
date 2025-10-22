// Session Routes
// REST API endpoints for session management
//
// Endpoints:
// - POST   /v1/sessions          - Create new session
// - POST   /v1/sessions/:id/start  - Start session
// - POST   /v1/sessions/:id/switch - Switch cycle (HOT PATH)
// - GET    /v1/sessions/:id      - Get session state
// - POST   /v1/sessions/:id/pause  - Pause session
// - POST   /v1/sessions/:id/resume - Resume session
// - POST   /v1/sessions/:id/complete - Complete session
// - DELETE /v1/sessions/:id      - Delete session

import { Router } from 'express'
import { SyncEngine } from '@/engine/SyncEngine'
import { switchCycleLimiter } from '../middlewares/rateLimit'
import { validateBody, validateParams } from '../middlewares/validate'
import {
  CreateSessionSchema,
  SwitchCycleSchema,
  SessionIdParamSchema,
} from '../schemas/session'
import { createComponentLogger } from '@/utils/logger'

const logger = createComponentLogger('SessionRoutes')

export function createSessionRoutes(syncEngine: SyncEngine): Router {
  const router = Router()

  /**
   * POST /v1/sessions - Create new session
   *
   * Request body:
   * {
   *   session_id: string (UUID)
   *   sync_mode: 'per_participant' | 'per_cycle' | 'per_group' | 'global' | 'count_up'
   *   participants: [{ participant_id, total_time_ms, ... }]
   *   total_time_ms: number
   *   time_per_cycle_ms?: number
   *   increment_ms?: number
   *   max_time_ms?: number
   * }
   *
   * Response: 201 Created
   * { data: SyncState }
   */
  router.post(
    '/v1/sessions',
    validateBody(CreateSessionSchema),
    async (req, res, next) => {
      try {
        logger.info({ session_id: req.body.session_id }, 'Creating session via API')

        const state = await syncEngine.createSession(req.body)

        logger.info({ session_id: state.session_id }, 'Session created successfully')
        res.status(201).json({ data: state })
      } catch (err) {
        next(err)
      }
    }
  )

  /**
   * POST /v1/sessions/:id/start - Start session
   *
   * Transitions session from PENDING to RUNNING
   *
   * Response: 200 OK
   * { data: SyncState }
   */
  router.post(
    '/v1/sessions/:id/start',
    validateParams(SessionIdParamSchema),
    async (req, res, next) => {
      try {
        const sessionId = req.params.id
        logger.info({ session_id: sessionId }, 'Starting session via API')

        const state = await syncEngine.startSession(sessionId)

        logger.info({ session_id: sessionId }, 'Session started successfully')
        res.json({ data: state })
      } catch (err) {
        next(err)
      }
    }
  )

  /**
   * POST /v1/sessions/:id/switch - Switch cycle
   *
   * HOT PATH - Target latency: <50ms (expected: 3-5ms)
   *
   * Request body (optional):
   * {
   *   next_participant_id?: string (UUID)
   * }
   *
   * Response: 200 OK
   * {
   *   data: {
   *     session_id: string
   *     active_participant_id: string
   *     cycle_started_at: Date
   *     participants: SyncParticipant[]
   *     status: string
   *     expired_participant_id?: string
   *   }
   * }
   */
  router.post(
    '/v1/sessions/:id/switch',
    validateParams(SessionIdParamSchema),
    validateBody(SwitchCycleSchema),
    switchCycleLimiter,
    async (req, res, next) => {
      try {
        const sessionId = req.params.id
        const { next_participant_id } = req.body || {}

        logger.debug({ session_id: sessionId, next_participant_id }, 'Switching cycle via API')

        const result = await syncEngine.switchCycle(sessionId, undefined, next_participant_id)

        logger.debug({ session_id: sessionId, active_participant_id: result.active_participant_id }, 'Cycle switched successfully')
        res.json({ data: result })
      } catch (err) {
        next(err)
      }
    }
  )

  /**
   * GET /v1/sessions/:id - Get session state
   *
   * Returns current session state. Client calculates remaining time.
   *
   * Response: 200 OK
   * { data: SyncState }
   */
  router.get(
    '/v1/sessions/:id',
    validateParams(SessionIdParamSchema),
    async (req, res, next) => {
      try {
        const sessionId = req.params.id
        logger.debug({ session_id: sessionId }, 'Getting session state via API')

        const state = await syncEngine.getCurrentState(sessionId)

        res.json({ data: state })
      } catch (err) {
        next(err)
      }
    }
  )

  /**
   * POST /v1/sessions/:id/pause - Pause session
   *
   * Saves current time and transitions to PAUSED
   *
   * Response: 200 OK
   * { data: SyncState }
   */
  router.post(
    '/v1/sessions/:id/pause',
    validateParams(SessionIdParamSchema),
    async (req, res, next) => {
      try {
        const sessionId = req.params.id
        logger.info({ session_id: sessionId }, 'Pausing session via API')

        const state = await syncEngine.pauseSession(sessionId)

        logger.info({ session_id: sessionId }, 'Session paused successfully')
        res.json({ data: state })
      } catch (err) {
        next(err)
      }
    }
  )

  /**
   * POST /v1/sessions/:id/resume - Resume session
   *
   * Transitions from PAUSED to RUNNING, restarts cycle timer
   *
   * Response: 200 OK
   * { data: SyncState }
   */
  router.post(
    '/v1/sessions/:id/resume',
    validateParams(SessionIdParamSchema),
    async (req, res, next) => {
      try {
        const sessionId = req.params.id
        logger.info({ session_id: sessionId }, 'Resuming session via API')

        const state = await syncEngine.resumeSession(sessionId)

        logger.info({ session_id: sessionId }, 'Session resumed successfully')
        res.json({ data: state })
      } catch (err) {
        next(err)
      }
    }
  )

  /**
   * POST /v1/sessions/:id/complete - Complete session
   *
   * Marks session as COMPLETED, deactivates all participants
   *
   * Response: 200 OK
   * { data: SyncState }
   */
  router.post(
    '/v1/sessions/:id/complete',
    validateParams(SessionIdParamSchema),
    async (req, res, next) => {
      try {
        const sessionId = req.params.id
        logger.info({ session_id: sessionId }, 'Completing session via API')

        const state = await syncEngine.completeSession(sessionId)

        logger.info({ session_id: sessionId }, 'Session completed successfully')
        res.json({ data: state })
      } catch (err) {
        next(err)
      }
    }
  )

  /**
   * DELETE /v1/sessions/:id - Delete session
   *
   * Removes session from Redis, triggers Pub/Sub broadcast
   *
   * Response: 204 No Content
   */
  router.delete(
    '/v1/sessions/:id',
    validateParams(SessionIdParamSchema),
    async (req, res, next) => {
      try {
        const sessionId = req.params.id
        logger.info({ session_id: sessionId }, 'Deleting session via API')

        await syncEngine.deleteSession(sessionId)

        logger.info({ session_id: sessionId }, 'Session deleted successfully')
        res.status(204).send()
      } catch (err) {
        next(err)
      }
    }
  )

  logger.info('Session routes registered')
  return router
}
