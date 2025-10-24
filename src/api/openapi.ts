/**
 * OpenAPI Documentation Generator
 *
 * Single source of truth: Zod schemas -> OpenAPI spec -> Swagger UI
 *
 * This file:
 * - Registers all Zod schemas from session.ts
 * - Defines all API routes with their request/response schemas
 * - Generates OpenAPI 3.0 specification
 * - Exports the spec for Swagger UI
 */

import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'
import {
  CreateSessionSchema,
  SwitchCycleSchema,
  SessionIdParamSchema,
  EmptyBodySchema,
  SessionResponseSchema,
  SwitchCycleResponseSchema,
  ErrorResponseSchema,
  HealthResponseSchema,
} from './schemas/session'

// Create OpenAPI registry
const registry = new OpenAPIRegistry()

// ============================================================================
// Register Schemas (Components)
// ============================================================================

// Register request schemas
registry.register('CreateSessionRequest', CreateSessionSchema)
registry.register('SwitchCycleRequest', SwitchCycleSchema)
registry.register('SessionIdParam', SessionIdParamSchema)
registry.register('EmptyBody', EmptyBodySchema)

// Register response schemas (all imported from session.ts)
registry.register('SessionResponse', SessionResponseSchema)
registry.register('SwitchCycleResponse', SwitchCycleResponseSchema)
registry.register('ErrorResponse', ErrorResponseSchema)
registry.register('HealthResponse', HealthResponseSchema)

// ============================================================================
// Register Routes (Paths)
// ============================================================================

// Health Endpoints
registry.registerPath({
  method: 'get',
  path: '/health',
  summary: 'Basic health check',
  description: 'Always returns 200 OK if the server is running. Used for liveness probes.',
  tags: ['Health'],
  responses: {
    200: {
      description: 'Server is running',
      content: {
        'application/json': {
          schema: HealthResponseSchema,
        },
      },
    },
  },
})

registry.registerPath({
  method: 'get',
  path: '/ready',
  summary: 'Readiness check',
  description: 'Checks Redis and PostgreSQL connections. Used for readiness probes.',
  tags: ['Health'],
  responses: {
    200: {
      description: 'Server is ready',
      content: {
        'application/json': {
          schema: z.object({
            status: z.literal('ready'),
          }),
        },
      },
    },
    503: {
      description: 'Server is not ready',
      content: {
        'application/json': {
          schema: z.object({
            status: z.literal('not_ready'),
            error: z.string(),
          }),
        },
      },
    },
  },
})

// Time Endpoint
registry.registerPath({
  method: 'get',
  path: '/v1/time',
  summary: 'Server time synchronization',
  description: 'Returns current server timestamp for client time synchronization.',
  tags: ['Time'],
  responses: {
    200: {
      description: 'Server timestamp',
      content: {
        'application/json': {
          schema: z.object({
            timestamp_ms: z.number().openapi({ example: 1704067200000 }),
            server_version: z.string().openapi({ example: '2.0.0' }),
            drift_tolerance_ms: z.number().openapi({ example: 50 }),
          }),
        },
      },
    },
  },
})

// Session Endpoints
registry.registerPath({
  method: 'post',
  path: '/v1/sessions',
  summary: 'Create new session',
  description: 'Creates a new synchronization session with participants and time allocation.',
  tags: ['Sessions'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateSessionSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Session created successfully',
      content: {
        'application/json': {
          schema: SessionResponseSchema,
        },
      },
    },
    400: {
      description: 'Invalid request',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
})

registry.registerPath({
  method: 'get',
  path: '/v1/sessions/{id}',
  summary: 'Get session state',
  description: 'Returns current session state.',
  tags: ['Sessions'],
  request: {
    params: SessionIdParamSchema,
  },
  responses: {
    200: {
      description: 'Session state retrieved',
      content: {
        'application/json': {
          schema: SessionResponseSchema,
        },
      },
    },
    404: {
      description: 'Session not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
})

registry.registerPath({
  method: 'post',
  path: '/v1/sessions/{id}/start',
  summary: 'Start session',
  description: 'Transitions session from PENDING to RUNNING.',
  tags: ['Sessions'],
  request: {
    params: SessionIdParamSchema,
  },
  responses: {
    200: {
      description: 'Session started',
      content: {
        'application/json': {
          schema: SessionResponseSchema,
        },
      },
    },
    404: {
      description: 'Session not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
})

registry.registerPath({
  method: 'post',
  path: '/v1/sessions/{id}/switch',
  summary: 'Switch cycle (HOT PATH)',
  description:
    'Switches to next participant. Target latency: <50ms. This is the hot path for real-time synchronization.',
  tags: ['Sessions'],
  request: {
    params: SessionIdParamSchema,
    body: {
      content: {
        'application/json': {
          schema: SwitchCycleSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Cycle switched successfully',
      content: {
        'application/json': {
          schema: SwitchCycleResponseSchema,
        },
      },
    },
    404: {
      description: 'Session not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    429: {
      description: 'Rate limit exceeded',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
})

registry.registerPath({
  method: 'post',
  path: '/v1/sessions/{id}/pause',
  summary: 'Pause session',
  description: 'Saves current time and transitions to PAUSED state.',
  tags: ['Sessions'],
  request: {
    params: SessionIdParamSchema,
  },
  responses: {
    200: {
      description: 'Session paused',
      content: {
        'application/json': {
          schema: SessionResponseSchema,
        },
      },
    },
    404: {
      description: 'Session not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
})

registry.registerPath({
  method: 'post',
  path: '/v1/sessions/{id}/resume',
  summary: 'Resume session',
  description: 'Transitions from PAUSED to RUNNING.',
  tags: ['Sessions'],
  request: {
    params: SessionIdParamSchema,
  },
  responses: {
    200: {
      description: 'Session resumed',
      content: {
        'application/json': {
          schema: SessionResponseSchema,
        },
      },
    },
    404: {
      description: 'Session not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
})

registry.registerPath({
  method: 'post',
  path: '/v1/sessions/{id}/complete',
  summary: 'Complete session',
  description: 'Marks session as COMPLETED.',
  tags: ['Sessions'],
  request: {
    params: SessionIdParamSchema,
  },
  responses: {
    200: {
      description: 'Session completed',
      content: {
        'application/json': {
          schema: SessionResponseSchema,
        },
      },
    },
    404: {
      description: 'Session not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
})

registry.registerPath({
  method: 'delete',
  path: '/v1/sessions/{id}',
  summary: 'Delete session',
  description: 'Removes session from Redis and triggers Pub/Sub broadcast.',
  tags: ['Sessions'],
  request: {
    params: SessionIdParamSchema,
  },
  responses: {
    204: {
      description: 'Session deleted successfully',
    },
    404: {
      description: 'Session not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
})

// ============================================================================
// Generate OpenAPI Document
// ============================================================================

const generator = new OpenApiGeneratorV3(registry.definitions)

export const openApiDocument = generator.generateDocument({
  openapi: '3.0.3',
  info: {
    title: 'SyncKairos API',
    version: '2.0.0',
    description: `
# SyncKairos v2.0 - Real-time Synchronization Service

High-performance distributed synchronization service with Redis-first architecture.

## Features

- **Sub-millisecond Operations**: <1ms average latency
- **Truly Stateless**: Any instance can serve any request
- **Horizontal Scaling**: Add instances without configuration
- **Multi-Instance Ready**: Redis Pub/Sub for cross-instance sync

## Performance

- \`getSession()\`: <3ms (achieved: 0.25ms)
- \`updateSession()\`: <5ms (achieved: 0.46ms)
- \`switchCycle()\`: <50ms (achieved: 3-5ms)
- Pub/Sub: <2ms (achieved: 0.19ms)

## WebSocket API

Connect to \`ws://host:port/ws?sessionId={id}\` to receive real-time updates.
    `.trim(),
    contact: {
      name: 'SyncKairos',
    },
    license: {
      name: 'ISC',
    },
  },
  servers: [
    {
      url: 'http://localhost:3000',
      description: 'Local development',
    },
    {
      url: 'https://synckairos-staging.fly.dev',
      description: 'Staging environment',
    },
    {
      url: 'https://synckairos-production.fly.dev',
      description: 'Production environment',
    },
  ],
  tags: [
    {
      name: 'Health',
      description: 'Health and readiness checks',
    },
    {
      name: 'Time',
      description: 'Server time synchronization',
    },
    {
      name: 'Sessions',
      description: 'Session management endpoints',
    },
  ],
})
