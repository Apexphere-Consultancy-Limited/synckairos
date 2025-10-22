import { z } from 'zod'

/**
 * Participant Schema
 * Validates individual participant data within a session
 */
export const ParticipantSchema = z.object({
  participant_id: z.string().uuid('Participant ID must be a valid UUID'),
  participant_index: z
    .number()
    .int('Participant index must be an integer')
    .min(0, 'Participant index must be non-negative'),
  total_time_ms: z
    .number()
    .int('Total time must be an integer')
    .min(1000, 'Total time must be at least 1000ms (1 second)')
    .max(86400000, 'Total time cannot exceed 86400000ms (24 hours)'),
  group_id: z.string().uuid('Group ID must be a valid UUID').optional(),
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
export const CreateSessionSchema = z.object({
  session_id: z.string().uuid('Session ID must be a valid UUID'),
  sync_mode: z.enum(
    ['per_participant', 'per_cycle', 'per_group', 'global', 'count_up'],
    {
      message:
        'Invalid sync mode. Must be one of: per_participant, per_cycle, per_group, global, count_up',
    }
  ),
  participants: z
    .array(ParticipantSchema)
    .min(1, 'At least one participant is required')
    .max(1000, 'Cannot exceed 1000 participants'),
  total_time_ms: z
    .number()
    .int('Total time must be an integer')
    .min(1000, 'Total time must be at least 1000ms (1 second)')
    .max(86400000, 'Total time cannot exceed 86400000ms (24 hours)'),
  time_per_cycle_ms: z
    .number()
    .int('Time per cycle must be an integer')
    .min(1000, 'Time per cycle must be at least 1000ms (1 second)')
    .max(86400000, 'Time per cycle cannot exceed 86400000ms (24 hours)')
    .optional(),
  increment_ms: z
    .number()
    .int('Increment must be an integer')
    .min(0, 'Increment must be non-negative')
    .max(60000, 'Increment cannot exceed 60000ms (1 minute)')
    .optional(),
  max_time_ms: z
    .number()
    .int('Max time must be an integer')
    .min(1000, 'Max time must be at least 1000ms (1 second)')
    .max(86400000, 'Max time cannot exceed 86400000ms (24 hours)')
    .optional(),
  metadata: z.record(z.string(), z.any()).optional(),
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
export const SwitchCycleSchema = z.object({
  next_participant_id: z
    .string()
    .uuid('Next participant ID must be a valid UUID')
    .optional(),
})

/**
 * Session ID Parameter Schema
 * Validates :id parameter in all session routes
 */
export const SessionIdParamSchema = z.object({
  id: z.string().uuid('Session ID must be a valid UUID'),
})

/**
 * Empty Body Schema
 * Validates endpoints that don't accept a request body
 * Uses strict() to reject any extra fields
 */
export const EmptyBodySchema = z.object({}).strict()

// TypeScript type inference
export type CreateSessionInput = z.infer<typeof CreateSessionSchema>
export type ParticipantInput = z.infer<typeof ParticipantSchema>
export type SwitchCycleInput = z.infer<typeof SwitchCycleSchema>
export type SessionIdParam = z.infer<typeof SessionIdParamSchema>
