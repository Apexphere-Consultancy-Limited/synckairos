// Metrics Middleware
// Prometheus metrics collection for HTTP requests
//
// Metrics:
// - synckairos_http_requests_total - Total HTTP requests (counter)
// - synckairos_http_request_duration_ms - HTTP request duration (histogram)
// - synckairos_switch_cycle_duration_ms - Switch cycle specific latency (histogram)

import promClient from 'prom-client'
import { Request, Response, NextFunction } from 'express'
import { createComponentLogger } from '@/utils/logger'

const logger = createComponentLogger('Metrics')

// Create Prometheus registry
export const register = new promClient.Registry()

// Add default metrics (process, Node.js runtime metrics)
promClient.collectDefaultMetrics({ register })

/**
 * HTTP requests total counter
 *
 * Labels:
 * - method: HTTP method (GET, POST, etc.)
 * - route: Route path (/v1/sessions/:id, etc.)
 * - status_code: HTTP status code (200, 404, 500, etc.)
 */
export const httpRequestsTotal = new promClient.Counter({
  name: 'synckairos_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
})

/**
 * HTTP request duration histogram
 *
 * Labels:
 * - method: HTTP method
 * - route: Route path
 *
 * Buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000] ms
 */
export const httpRequestDuration = new promClient.Histogram({
  name: 'synckairos_http_request_duration_ms',
  help: 'HTTP request duration in milliseconds',
  labelNames: ['method', 'route'],
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000],
  registers: [register],
})

/**
 * Switch cycle duration histogram
 *
 * Special metric for the hot path (POST /v1/sessions/:id/switch)
 * Target: <50ms, expected: 3-5ms
 *
 * Buckets: [1, 2, 3, 5, 10, 25, 50] ms
 * Fine-grained buckets to track hot path performance
 */
export const switchCycleDuration = new promClient.Histogram({
  name: 'synckairos_switch_cycle_duration_ms',
  help: 'Switch cycle operation duration in milliseconds (hot path)',
  buckets: [1, 2, 3, 5, 10, 25, 50],
  registers: [register],
})

/**
 * Metrics middleware
 *
 * Records HTTP request metrics for all routes.
 * MUST BE FIRST MIDDLEWARE to track all requests.
 *
 * @param req - Express request
 * @param res - Express response
 * @param next - Express next function
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now()

  // Record metrics when response finishes
  res.on('finish', () => {
    const duration = Date.now() - start
    const route = req.route?.path || req.path

    // Record request count
    httpRequestsTotal.inc({
      method: req.method,
      route,
      status_code: res.statusCode,
    })

    // Record request duration
    httpRequestDuration.observe(
      {
        method: req.method,
        route,
      },
      duration
    )

    // Record switch cycle duration specifically (hot path)
    if (route === '/v1/sessions/:id/switch' && req.method === 'POST') {
      switchCycleDuration.observe(duration)

      // Log warning if switch cycle is slow (>50ms target)
      if (duration > 50) {
        logger.warn(
          {
            duration_ms: duration,
            session_id: req.params.id,
          },
          'Switch cycle exceeded 50ms target'
        )
      }
    }
  })

  next()
}

logger.info('Metrics middleware initialized')
