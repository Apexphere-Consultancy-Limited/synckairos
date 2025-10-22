// Health Check Routes
// Used by load balancers and Kubernetes for health/readiness probes

import { Router } from 'express'
import { createRedisClient } from '@/config/redis'
import { pool } from '@/config/database'
import { createComponentLogger } from '@/utils/logger'

const logger = createComponentLogger('HealthRoutes')

// Shared Redis client for health checks (don't create new one every time)
let healthCheckRedis: ReturnType<typeof createRedisClient> | null = null

export function createHealthRoutes(): Router {
  const router = Router()

  /**
   * GET /health - Basic health check
   *
   * Always returns 200 OK if the server is running.
   * Used for liveness probes.
   *
   * Response: 200 OK
   * { status: 'ok' }
   */
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  /**
   * GET /ready - Readiness check
   *
   * Checks if the server is ready to accept traffic by testing:
   * - Redis connection
   * - PostgreSQL connection
   *
   * Used for readiness probes in Kubernetes.
   *
   * Response:
   * - 200 OK if ready: { status: 'ready' }
   * - 503 Service Unavailable if not ready: { status: 'not_ready', error: '...' }
   */
  router.get('/ready', async (_req, res) => {
    try {
      // Check Redis connection
      if (!healthCheckRedis) {
        healthCheckRedis = createRedisClient()
      }
      await healthCheckRedis.ping()

      // Check PostgreSQL connection
      await pool.query('SELECT 1')

      res.json({ status: 'ready' })
    } catch (err) {
      logger.error({ err }, 'Readiness check failed')
      res.status(503).json({
        status: 'not_ready',
        error: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  })

  logger.info('Health routes registered')
  return router
}
