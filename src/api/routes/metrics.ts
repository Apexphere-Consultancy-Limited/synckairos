// Metrics Routes
// Prometheus metrics endpoint

import { Router } from 'express'
import { register } from '../middlewares/metrics'

export function createMetricsRoutes(): Router {
  const router = Router()

  /**
   * GET /metrics - Prometheus metrics endpoint
   *
   * Returns metrics in Prometheus text format for scraping.
   * Used by Prometheus server to collect metrics.
   *
   * Response: 200 OK
   * Content-Type: text/plain; version=0.0.4; charset=utf-8
   *
   * Example metrics:
   * # HELP synckairos_http_requests_total Total number of HTTP requests
   * # TYPE synckairos_http_requests_total counter
   * synckairos_http_requests_total{method="POST",route="/v1/sessions/:id/switch",status_code="200"} 42
   * ...
   */
  router.get('/metrics', async (_req, res) => {
    try {
      res.set('Content-Type', register.contentType)
      res.send(await register.metrics())
    } catch (err) {
      res.status(500).send('Error collecting metrics')
    }
  })

  return router
}
