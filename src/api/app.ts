// Express Application Factory
// Creates and configures the Express app with all middlewares and routes
//
// MIDDLEWARE ORDER IS CRITICAL:
// 1. Metrics (first, track everything)
// 2. CORS
// 3. Body parser
// 4. Logging
// 5. Health/Metrics routes (no rate limiting)
// 6. Rate limiting (general)
// 7. Business logic routes
// 8. Error handler (MUST BE LAST)

import express, { Application } from 'express'
import cors from 'cors'
import pinoHttp from 'pino-http'
import { SyncEngine } from '@/engine/SyncEngine'
import { logger } from '@/utils/logger'
import { metricsMiddleware } from './middlewares/metrics'
import { errorHandler } from './middlewares/errorHandler'
import { generalLimiter } from './middlewares/rateLimit'
import { createSessionRoutes } from './routes/sessions'
import { createTimeRoutes } from './routes/time'
import { createHealthRoutes } from './routes/health'
import { createMetricsRoutes } from './routes/metrics'
import { createDocsRoutes } from './routes/docs'

export interface AppConfig {
  syncEngine: SyncEngine
  corsOrigin?: string
}

/**
 * Create and configure Express application
 *
 * @param config - Application configuration
 * @returns Configured Express app
 */
export function createApp(config: AppConfig): Application {
  const app = express()

  // 1. Metrics middleware (first, to track everything)
  app.use(metricsMiddleware)

  // 2. CORS
  app.use(
    cors({
      origin: config.corsOrigin || process.env.CORS_ORIGIN || '*',
      credentials: true,
    })
  )

  // 3. Body parser
  app.use(express.json({ limit: '1mb' }))

  // 4. Request logging
  app.use(
    pinoHttp({
      logger,
      customLogLevel: (_req, res, err) => {
        if (res.statusCode >= 500 || err) return 'error'
        if (res.statusCode >= 400) return 'warn'
        return 'info'
      },
      // Exclude health/metrics from logs to reduce noise
      autoLogging: {
        ignore: _req => _req.url === '/health' || _req.url === '/metrics' || _req.url === '/ready',
      },
    })
  )

  // 5. Health check routes (no rate limiting - must be available for k8s/load balancer)
  app.use(createHealthRoutes())

  // 6. Metrics endpoint (no rate limiting - Prometheus scraper needs access)
  app.use(createMetricsRoutes())

  // 7. API Documentation (no rate limiting - developers need access)
  app.use(createDocsRoutes())

  // 8. General rate limiter (for all other routes)
  // Applied before business logic routes
  app.use((_req, res, next) => {
    // Skip rate limiting for health/metrics/docs
    if (
      _req.url === '/health' ||
      _req.url === '/metrics' ||
      _req.url === '/ready' ||
      _req.url.startsWith('/api-docs')
    ) {
      return next()
    }
    generalLimiter(_req, res, next)
  })

  // 9. Time routes
  app.use(createTimeRoutes())

  // 10. Session routes
  app.use(createSessionRoutes(config.syncEngine))

  // 11. Error handler (MUST BE LAST)
  app.use(errorHandler)

  logger.info('Express app configured')

  return app
}
