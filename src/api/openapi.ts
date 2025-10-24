/**
 * OpenAPI Document Generator
 *
 * Auto-generates OpenAPI 3.1 documentation from Zod schemas.
 * Single source of truth: Zod schemas in api-contracts.ts
 *
 * Usage:
 * - Serves interactive Swagger UI at /api-docs
 * - OpenAPI JSON available at /api-docs/openapi.json
 * - Auto-updates when schemas change (no manual sync needed)
 */

import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi'
import {
  // Core schemas
  SyncStateSchema,
  SyncParticipantSchema,
  SyncModeSchema,
  SyncStatusSchema,
  // WebSocket messages
  ServerMessageSchema,
  WSConnectedMessageSchema,
  WSStateUpdateMessageSchema,
  WSStateSyncMessageSchema,
  WSSessionDeletedMessageSchema,
  WSPongMessageSchema,
  WSErrorMessageSchema,
  ClientMessageSchema,
  WSPingMessageSchema,
  WSRequestSyncMessageSchema,
  // REST API
  CreateSessionRequestSchema,
  SwitchCycleRequestSchema,
  SessionResponseSchema,
  SwitchCycleResponseSchema,
  ErrorResponseSchema,
  HealthResponseSchema,
} from '@/types/api-contracts'

// Create OpenAPI registry
const registry = new OpenAPIRegistry()

// ============================================================================
// Register Core Schemas
// ============================================================================

registry.register('SyncMode', SyncModeSchema)
registry.register('SyncStatus', SyncStatusSchema)
registry.register('SyncParticipant', SyncParticipantSchema)
registry.register('SyncState', SyncStateSchema)

// ============================================================================
// Register WebSocket Schemas
// ============================================================================

registry.register('ServerMessage', ServerMessageSchema)
registry.register('WSConnectedMessage', WSConnectedMessageSchema)
registry.register('WSStateUpdateMessage', WSStateUpdateMessageSchema)
registry.register('WSStateSyncMessage', WSStateSyncMessageSchema)
registry.register('WSSessionDeletedMessage', WSSessionDeletedMessageSchema)
registry.register('WSPongMessage', WSPongMessageSchema)
registry.register('WSErrorMessage', WSErrorMessageSchema)

registry.register('ClientMessage', ClientMessageSchema)
registry.register('WSPingMessage', WSPingMessageSchema)
registry.register('WSRequestSyncMessage', WSRequestSyncMessageSchema)

// ============================================================================
// Register REST API Schemas
// ============================================================================

registry.register('CreateSessionRequest', CreateSessionRequestSchema)
registry.register('SwitchCycleRequest', SwitchCycleRequestSchema)
registry.register('SessionResponse', SessionResponseSchema)
registry.register('SwitchCycleResponse', SwitchCycleResponseSchema)
registry.register('ErrorResponse', ErrorResponseSchema)
registry.register('HealthResponse', HealthResponseSchema)

// ============================================================================
// Register REST API Endpoints
// ============================================================================

// Health check
registry.registerPath({
  method: 'get',
  path: '/health',
  summary: 'Health check endpoint',
  description: 'Returns server health status and infrastructure services status',
  tags: ['Health'],
  responses: {
    200: {
      description: 'Server is healthy',
      content: {
        'application/json': {
          schema: HealthResponseSchema,
        },
      },
    },
  },
})

// Create session
registry.registerPath({
  method: 'post',
  path: '/v1/sessions',
  summary: 'Create a new session',
  description: 'Creates a new synchronization session with participants and timing configuration',
  tags: ['Sessions'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateSessionRequestSchema,
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
      description: 'Invalid request body',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    409: {
      description: 'Session ID already exists',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
})

// Get session
registry.registerPath({
  method: 'get',
  path: '/v1/sessions/{id}',
  summary: 'Get session state',
  description: 'Returns current session state. Clients calculate remaining time from timestamps.',
  tags: ['Sessions'],
  request: {
    params: registry.registerComponent('parameters', 'SessionId', {
      in: 'path',
      name: 'id',
      required: true,
      schema: {
        type: 'string',
        description: 'Session ID',
        example: 'debate-001',
      },
    }),
  },
  responses: {
    200: {
      description: 'Session state retrieved successfully',
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

// Start session
registry.registerPath({
  method: 'post',
  path: '/v1/sessions/{id}/start',
  summary: 'Start session',
  description: 'Transitions session from PENDING to RUNNING. Broadcasts STATE_UPDATE to all WebSocket clients.',
  tags: ['Sessions'],
  request: {
    params: registry.registerComponent('parameters', 'SessionId', {
      in: 'path',
      name: 'id',
      required: true,
      schema: {
        type: 'string',
      },
    }),
  },
  responses: {
    200: {
      description: 'Session started successfully',
      content: {
        'application/json': {
          schema: SessionResponseSchema,
        },
      },
    },
    400: {
      description: 'Session already started',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
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

// Switch cycle (HOT PATH)
registry.registerPath({
  method: 'post',
  path: '/v1/sessions/{id}/switch',
  summary: 'Switch to next participant (HOT PATH)',
  description: 'Switches to next participant. Target latency: <50ms (typical: 3-5ms). Broadcasts STATE_UPDATE.',
  tags: ['Sessions'],
  request: {
    params: registry.registerComponent('parameters', 'SessionId', {
      in: 'path',
      name: 'id',
      required: true,
      schema: {
        type: 'string',
      },
    }),
    body: {
      content: {
        'application/json': {
          schema: SwitchCycleRequestSchema,
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
    400: {
      description: 'Session not running',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
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
    409: {
      description: 'Optimistic locking conflict (version mismatch)',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    429: {
      description: 'Rate limit exceeded (100 req/min)',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
})

// Pause session
registry.registerPath({
  method: 'post',
  path: '/v1/sessions/{id}/pause',
  summary: 'Pause session',
  description: 'Pauses running session. Saves current time. Broadcasts STATE_UPDATE.',
  tags: ['Sessions'],
  request: {
    params: registry.registerComponent('parameters', 'SessionId', {
      in: 'path',
      name: 'id',
      required: true,
      schema: {
        type: 'string',
      },
    }),
  },
  responses: {
    200: {
      description: 'Session paused successfully',
      content: {
        'application/json': {
          schema: SessionResponseSchema,
        },
      },
    },
    400: {
      description: 'Session not running',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
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

// Resume session
registry.registerPath({
  method: 'post',
  path: '/v1/sessions/{id}/resume',
  summary: 'Resume session',
  description: 'Resumes paused session. Restarts cycle timer. Broadcasts STATE_UPDATE.',
  tags: ['Sessions'],
  request: {
    params: registry.registerComponent('parameters', 'SessionId', {
      in: 'path',
      name: 'id',
      required: true,
      schema: {
        type: 'string',
      },
    }),
  },
  responses: {
    200: {
      description: 'Session resumed successfully',
      content: {
        'application/json': {
          schema: SessionResponseSchema,
        },
      },
    },
    400: {
      description: 'Session not paused',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
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

// Complete session
registry.registerPath({
  method: 'post',
  path: '/v1/sessions/{id}/complete',
  summary: 'Complete session',
  description: 'Marks session as completed. Deactivates all participants. Broadcasts STATE_UPDATE.',
  tags: ['Sessions'],
  request: {
    params: registry.registerComponent('parameters', 'SessionId', {
      in: 'path',
      name: 'id',
      required: true,
      schema: {
        type: 'string',
      },
    }),
  },
  responses: {
    200: {
      description: 'Session completed successfully',
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

// Delete session
registry.registerPath({
  method: 'delete',
  path: '/v1/sessions/{id}',
  summary: 'Delete session',
  description: 'Removes session from Redis. Sends SESSION_DELETED to WebSocket clients.',
  tags: ['Sessions'],
  request: {
    params: registry.registerComponent('parameters', 'SessionId', {
      in: 'path',
      name: 'id',
      required: true,
      schema: {
        type: 'string',
      },
    }),
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

const generator = new OpenApiGeneratorV31(registry.definitions)

export const openapiDocument = generator.generateDocument({
  openapi: '3.1.0',
  info: {
    title: 'SyncKairos API',
    version: '2.0.0',
    description: `
# SyncKairos API Documentation

**Architecture:** STATE_UPDATE Based Real-Time Synchronization

SyncKairos uses a state synchronization architecture where clients receive the complete session state on every update. This follows the "Calculate, Don't Count" principle and enables distributed-first design with Redis Pub/Sub.

## Key Principles

1. **Calculate, Don't Count**: Clients receive authoritative server timestamps and calculate remaining time locally
2. **Full State Updates**: Every change broadcasts the complete \`SyncState\` (not granular events)
3. **Distributed-First**: Stateless instances with Redis Pub/Sub for cross-instance broadcasting
4. **Reconnection Resilient**: \`STATE_SYNC\` provides current state on reconnection

## WebSocket Protocol

Connect to: \`ws://<host>:<port>/ws?sessionId=<session_id>\`

**Server Messages:**
- \`CONNECTED\`: Sent on connection
- \`STATE_UPDATE\`: Sent on every state change (start, switch, pause, resume, complete)
- \`STATE_SYNC\`: Sent on reconnection or REQUEST_SYNC
- \`SESSION_DELETED\`: Sent when session is deleted
- \`PONG\`: Response to PING
- \`ERROR\`: Error occurred

**Client Messages:**
- \`PING\`: Keep-alive
- \`REQUEST_SYNC\`: Request current state

## Performance Targets

- **switchCycle**: <50ms (typical: 3-5ms)
- **WebSocket Broadcast**: <100ms
- **STATE_UPDATE Size**: ~15-20 KB for 10 participants

## Rate Limiting

- **Global**: 100 requests per minute per IP
- **switchCycle**: 100 requests per minute (HOT PATH protection)

## References

- [Complete WebSocket Protocol Documentation](https://github.com/synckairos/synckairos/blob/main/docs/api/WEBSOCKET.md)
- [Architecture Design](https://github.com/synckairos/synckairos/blob/main/docs/design/ARCHITECTURE.md)
- [First Principles Analysis](https://github.com/synckairos/synckairos/blob/main/docs/design/WEBSOCKET_API_ANALYSIS.md)
    `.trim(),
    contact: {
      name: 'SyncKairos Team',
      url: 'https://github.com/synckairos/synckairos',
    },
    license: {
      name: 'MIT',
      url: 'https://opensource.org/licenses/MIT',
    },
  },
  servers: [
    {
      url: 'http://localhost:3000',
      description: 'Local development server',
    },
    {
      url: 'https://api.synckairos.com',
      description: 'Production server',
    },
  ],
  tags: [
    {
      name: 'Health',
      description: 'Health check endpoints for monitoring',
    },
    {
      name: 'Sessions',
      description: 'Session management endpoints',
    },
  ],
})
