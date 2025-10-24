// API Documentation Routes
// Serves Swagger UI for interactive API documentation

import { Router } from 'express'
import swaggerUi from 'swagger-ui-express'
import { openApiDocument } from '../openapi'
import { createComponentLogger } from '@/utils/logger'

const logger = createComponentLogger('DocsRoutes')

export function createDocsRoutes(): Router {
  const router = Router()

  // Serve OpenAPI JSON spec
  router.get('/api-docs.json', (_req, res) => {
    res.json(openApiDocument)
  })

  // Serve Swagger UI
  router.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiDocument, {
    customSiteTitle: 'SyncKairos API Documentation',
    customCss: '.swagger-ui .topbar { display: none }',
  }))

  logger.info('API documentation routes registered')
  return router
}
