// Time Routes
// Server time synchronization endpoint

import { Router } from 'express'

export function createTimeRoutes(): Router {
  const router = Router()

  /**
   * GET /v1/time - Server time sync
   *
   * Returns current server timestamp for client time synchronization.
   * Clients can use this for NTP-style time sync to ensure accurate
   * time calculations across distributed clients.
   *
   * Response:
   * {
   *   timestamp_ms: number      - Current server time in milliseconds
   *   server_version: string    - Server version
   *   drift_tolerance_ms: number - Acceptable time drift (±50ms)
   * }
   */
  router.get('/v1/time', (_req, res) => {
    res.json({
      timestamp_ms: Date.now(),
      server_version: '2.0.0',
      drift_tolerance_ms: 50,
    })
  })

  return router
}
