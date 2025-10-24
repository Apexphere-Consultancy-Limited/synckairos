import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'

// Extend Zod with OpenAPI metadata support
extendZodWithOpenApi(z)

/**
 * Participant Schema
 * Validates individual participant data within a session
 */
export const ParticipantSchema = z
  .object({
    participant_id: z.string().uuid('Participant ID must be a valid UUID').openapi({
      description: 'Unique participant identifier (UUID)',
      example: '223e4567-e89b-12d3-a456-426614174001',
    }),
    participant_index: z
      .number()
      .int('Participant index must be an integer')
      .min(0, 'Participant index must be non-negative')
      .openapi({
        description: 'Position in participant rotation order',
        example: 0,
      }),
    total_time_ms: z
      .number()
      .int('Total time must be an integer')
      .min(1000, 'Total time must be at least 1000ms (1 second)')
      .max(86400000, 'Total time cannot exceed 86400000ms (24 hours)')
      .openapi({
        description: 'Total time allocated to participant (milliseconds)',
        example: 60000,
      }),
    group_id: z.string().uuid('Group ID must be a valid UUID').optional().openapi({
      description: 'Optional group identifier for group-based sync modes',
      example: 'group-a',
    }),
  })
  .openapi('Participant', {
    description: 'Participant data for session creation',
  })

/**
 * Create Session Schema
 * Validates POST /v1/sessions request body
 *
 * @example Valid request:
 * {
 *   "session_id": "123e4567-e89b-12d3-a456-426614174000",
 *   "sync_mode": "per_participant",
 *   "participants": [
 *     {
 *       "participant_id": "223e4567-e89b-12d3-a456-426614174001",
 *       "participant_index": 0,
 *       "total_time_ms": 60000
 *     }
 *   ],
 *   "total_time_ms": 120000,
 *   "increment_ms": 1000
 * }
 */
export const CreateSessionSchema = z
  .object({
    session_id: z.string().uuid('Session ID must be a valid UUID').openapi({
      description: 'Unique session identifier (UUID)',
      example: '123e4567-e89b-12d3-a456-426614174000',
    }),
    sync_mode: z
      .enum(['per_participant', 'per_cycle', 'per_group', 'global', 'count_up'], {
        message:
          'Invalid sync mode. Must be one of: per_participant, per_cycle, per_group, global, count_up',
      })
      .openapi({
        description: 'Synchronization mode for time management',
        example: 'per_participant',
      }),
    participants: z
      .array(ParticipantSchema)
      .min(1, 'At least one participant is required')
      .max(1000, 'Cannot exceed 1000 participants')
      .openapi({
        description: 'List of participants in the session',
      }),
    total_time_ms: z
      .number()
      .int('Total time must be an integer')
      .min(1000, 'Total time must be at least 1000ms (1 second)')
      .max(86400000, 'Total time cannot exceed 86400000ms (24 hours)')
      .openapi({
        description: 'Total time for the session (milliseconds)',
        example: 120000,
      }),
    time_per_cycle_ms: z
      .number()
      .int('Time per cycle must be an integer')
      .min(1000, 'Time per cycle must be at least 1000ms (1 second)')
      .max(86400000, 'Time per cycle cannot exceed 86400000ms (24 hours)')
      .optional()
      .openapi({
        description: 'Fixed time per cycle for per_cycle mode (milliseconds)',
        example: 60000,
      }),
    increment_ms: z
      .number()
      .int('Increment must be an integer')
      .min(0, 'Increment must be non-negative')
      .max(60000, 'Increment cannot exceed 60000ms (1 minute)')
      .optional()
      .openapi({
        description: 'Time increment for count_up mode (milliseconds)',
        example: 1000,
      }),
    max_time_ms: z
      .number()
      .int('Max time must be an integer')
      .min(1000, 'Max time must be at least 1000ms (1 second)')
      .max(86400000, 'Max time cannot exceed 86400000ms (24 hours)')
      .optional()
      .openapi({
        description: 'Maximum time for count_up mode (milliseconds)',
        example: 3600000,
      }),
    metadata: z.record(z.string(), z.any()).optional().openapi({
      description: 'Optional metadata for the session',
    }),
  })
  .openapi('CreateSessionRequest', {
    description: 'Request body for creating a new session',
  })

/**
 * Switch Cycle Schema
 * Validates POST /v1/sessions/:id/switch request body
 *
 * @example Valid request:
 * {
 *   "next_participant_id": "223e4567-e89b-12d3-a456-426614174001"
 * }
 *
 * @example Empty body (auto-advance):
 * {}
 */
export const SwitchCycleSchema = z
  .object({
    next_participant_id: z
      .string()
      .uuid('Next participant ID must be a valid UUID')
      .optional()
      .openapi({
        description: 'Optional next participant ID for manual switching',
        example: '223e4567-e89b-12d3-a456-426614174001',
      }),
  })
  .openapi('SwitchCycleRequest', {
    description: 'Request body for switching cycle (empty object for auto-advance)',
  })

/**
 * Session ID Parameter Schema
 * Validates :id parameter in all session routes
 */
export const SessionIdParamSchema = z
  .object({
    id: z.string().uuid('Session ID must be a valid UUID').openapi({
      description: 'Session identifier (UUID)',
      example: '123e4567-e89b-12d3-a456-426614174000',
    }),
  })
  .openapi('SessionIdParam', {
    description: 'Session ID parameter',
  })

/**
 * Empty Body Schema
 * Validates endpoints that don't accept a request body
 * Uses strict() to reject any extra fields
 */
export const EmptyBodySchema = z.object({}).strict().openapi('EmptyBody', {
  description: 'Empty request body',
})

// ============================================================================
// Response Schemas
// ============================================================================

/**
 * Sync Participant Response Schema
 * Participant state in the session
 */
export const SyncParticipantResponseSchema = z
  .object({
    participant_id: z.string().openapi({
      description: 'Participant identifier',
      example: 'p1',
    }),
    participant_index: z.number().int().openapi({
      description: 'Position in rotation order',
      example: 0,
    }),
    total_time_ms: z.number().int().openapi({
      description: 'Total time allocated (milliseconds)',
      example: 300000,
    }),
    time_used_ms: z.number().int().openapi({
      description: 'Total time consumed (milliseconds)',
      example: 5000,
    }),
    time_remaining_ms: z.number().int().openapi({
      description: 'Calculated remaining time (milliseconds)',
      example: 295000,
    }),
    cycle_count: z.number().int().openapi({
      description: 'Number of turns taken',
      example: 1,
    }),
    is_active: z.boolean().openapi({
      description: 'Currently active participant',
      example: true,
    }),
    has_expired: z.boolean().openapi({
      description: 'Time ran out',
      example: false,
    }),
    group_id: z.string().optional().openapi({
      description: 'Optional group identifier',
      example: 'group-a',
    }),
  })
  .openapi('SyncParticipant', {
    description: 'Participant state in a synchronization session',
  })

/**
 * Sync State Response Schema
 * Complete session state returned by all session endpoints
 */
export const SyncStateResponseSchema = z
  .object({
    session_id: z.string().openapi({
      description: 'Session identifier',
      example: 'session-123',
    }),
    sync_mode: z.enum(['per_participant', 'per_cycle', 'per_group', 'global', 'count_up']).openapi({
      description: 'Synchronization mode',
      example: 'per_participant',
    }),
    status: z.enum(['pending', 'running', 'paused', 'expired', 'completed', 'cancelled']).openapi({
      description: 'Current session status',
      example: 'running',
    }),
    version: z.number().int().openapi({
      description: 'Version for optimistic locking',
      example: 1,
    }),
    participants: z.array(SyncParticipantResponseSchema).openapi({
      description: 'List of participants',
    }),
    active_participant_id: z.string().nullable().openapi({
      description: 'Currently active participant ID',
      example: 'p1',
    }),
    total_time_ms: z.number().int().openapi({
      description: 'Total time for all participants (milliseconds)',
      example: 600000,
    }),
    time_per_cycle_ms: z.number().int().nullable().openapi({
      description: 'Fixed time per cycle (milliseconds)',
      example: 60000,
    }),
    cycle_started_at: z.string().datetime().nullable().openapi({
      description: 'Current cycle start time (ISO 8601)',
      example: '2024-01-01T00:00:00.000Z',
    }),
    session_started_at: z.string().datetime().nullable().openapi({
      description: 'Session start time (ISO 8601)',
      example: '2024-01-01T00:00:00.000Z',
    }),
    session_completed_at: z.string().datetime().nullable().openapi({
      description: 'Session completion time (ISO 8601)',
      example: null,
    }),
    increment_ms: z.number().int().optional().openapi({
      description: 'Time increment for count_up mode (milliseconds)',
      example: 1000,
    }),
    max_time_ms: z.number().int().optional().openapi({
      description: 'Maximum time for count_up mode (milliseconds)',
      example: 3600000,
    }),
    created_at: z.string().datetime().openapi({
      description: 'Creation timestamp (ISO 8601)',
      example: '2024-01-01T00:00:00.000Z',
    }),
    updated_at: z.string().datetime().openapi({
      description: 'Last update timestamp (ISO 8601)',
      example: '2024-01-01T00:00:00.000Z',
    }),
  })
  .openapi('SyncState', {
    description: 'Complete session state',
  })

/**
 * Session Response Wrapper
 * Standard response format for session endpoints
 */
export const SessionResponseSchema = z
  .object({
    data: SyncStateResponseSchema,
  })
  .openapi('SessionResponse', {
    description: 'Standard session response with data wrapper',
  })

/**
 * Switch Cycle Result Schema
 * Response from POST /v1/sessions/:id/switch
 */
export const SwitchCycleResultSchema = z
  .object({
    session_id: z.string().openapi({ description: 'Session ID', example: 'session-123' }),
    active_participant_id: z.string().openapi({ description: 'New active participant ID', example: 'p2' }),
    cycle_started_at: z.string().datetime().openapi({ description: 'Cycle start time', example: '2024-01-01T00:05:00.000Z' }),
    participants: z.array(SyncParticipantResponseSchema).openapi({ description: 'Updated participants' }),
    status: z.string().openapi({ description: 'Session status', example: 'running' }),
    expired_participant_id: z.string().optional().openapi({ description: 'Expired participant ID if any', example: 'p1' }),
  })
  .openapi('SwitchCycleResult', {
    description: 'Result from switchCycle operation',
  })

/**
 * Switch Cycle Response Wrapper
 * Response from POST /v1/sessions/:id/switch
 */
export const SwitchCycleResponseSchema = z
  .object({
    data: SwitchCycleResultSchema,
  })
  .openapi('SwitchCycleResponse', {
    description: 'Switch cycle response with data wrapper',
  })

/**
 * Error Response Schema
 * Standard error response format
 */
export const ErrorResponseSchema = z
  .object({
    error: z.string().openapi({
      description: 'Human-readable error message',
      example: 'Session not found',
    }),
    code: z.string().optional().openapi({
      description: 'Error code',
      example: 'SESSION_NOT_FOUND',
    }),
    details: z.record(z.string(), z.any()).optional().openapi({
      description: 'Additional error details',
    }),
  })
  .openapi('ErrorResponse', {
    description: 'Standard error response format',
  })

/**
 * Health Response Schema
 * Response from GET /health endpoint
 */
export const HealthResponseSchema = z
  .object({
    status: z.literal('ok').openapi({
      description: 'Health status',
      example: 'ok',
    }),
  })
  .openapi('HealthResponse', {
    description: 'Health check response',
  })

// TypeScript type inference
export type CreateSessionInput = z.infer<typeof CreateSessionSchema>
export type ParticipantInput = z.infer<typeof ParticipantSchema>
export type SwitchCycleInput = z.infer<typeof SwitchCycleSchema>
export type SessionIdParam = z.infer<typeof SessionIdParamSchema>
export type SyncStateResponse = z.infer<typeof SyncStateResponseSchema>
export type SessionResponse = z.infer<typeof SessionResponseSchema>
export type SwitchCycleResponse = z.infer<typeof SwitchCycleResponseSchema>
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>
export type HealthResponse = z.infer<typeof HealthResponseSchema>
