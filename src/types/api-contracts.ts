/**
 * API Contracts - Zod Schemas with OpenAPI Metadata
 *
 * Single source of truth for SyncKairos API validation
 * - Runtime validation with Zod
 * - TypeScript type inference
 * - OpenAPI/Swagger documentation generation
 * - Shared across backend, frontend, and E2E tests
 *
 * Architecture: STATE_UPDATE based WebSocket API
 * - Clients receive full state on every update
 * - Follows "Calculate, Don't Count" principle
 * - Distributed-first design with Redis Pub/Sub
 */

import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'

// Extend Zod with OpenAPI metadata support
extendZodWithOpenApi(z)

// ============================================================================
// Enums
// ============================================================================

export const SyncModeSchema = z
  .enum(['per_participant', 'per_cycle', 'per_group', 'global', 'count_up'])
  .openapi({
    description: 'Synchronization mode for time management',
    example: 'per_participant',
    enum: ['per_participant', 'per_cycle', 'per_group', 'global', 'count_up'],
  })

export const SyncStatusSchema = z
  .enum(['pending', 'running', 'paused', 'expired', 'completed', 'cancelled'])
  .openapi({
    description: 'Current status of the session',
    example: 'running',
    enum: ['pending', 'running', 'paused', 'expired', 'completed', 'cancelled'],
  })

// ============================================================================
// Core Data Structures
// ============================================================================

export const SyncParticipantSchema = z
  .object({
    participant_id: z.string().openapi({ description: 'Unique participant identifier', example: 'p1' }),
    participant_index: z
      .number()
      .int()
      .min(0)
      .openapi({ description: 'Position in rotation order', example: 0 }),
    total_time_ms: z
      .number()
      .int()
      .min(0)
      .openapi({ description: 'Total time allocated (milliseconds)', example: 300000 }),
    time_used_ms: z
      .number()
      .int()
      .min(0)
      .openapi({ description: 'Total time consumed (milliseconds)', example: 5000 }),
    time_remaining_ms: z
      .number()
      .int()
      .min(0)
      .openapi({ description: 'Calculated remaining time (milliseconds)', example: 295000 }),
    cycle_count: z.number().int().min(0).openapi({ description: 'Number of turns taken', example: 1 }),
    is_active: z.boolean().openapi({ description: 'Currently active participant', example: true }),
    has_expired: z.boolean().openapi({ description: 'Time ran out', example: false }),
    group_id: z.string().optional().openapi({ description: 'Optional group assignment', example: 'group-a' }),
  })
  .openapi({ ref: 'SyncParticipant', description: 'Participant state in a synchronization session' })

export const SyncStateSchema = z
  .object({
    session_id: z.string().openapi({ description: 'Unique session identifier', example: 'session-123' }),
    sync_mode: SyncModeSchema,
    status: SyncStatusSchema,
    version: z.number().int().min(0).openapi({ description: 'Version for optimistic locking', example: 3 }),

    // Participants
    participants: z.array(SyncParticipantSchema).openapi({ description: 'List of participants in the session' }),
    active_participant_id: z
      .string()
      .nullable()
      .openapi({ description: 'Currently active participant ID', example: 'p1' }),

    // Timing (server-side timestamps)
    total_time_ms: z
      .number()
      .int()
      .min(0)
      .openapi({ description: 'Total time for all participants (milliseconds)', example: 600000 }),
    time_per_cycle_ms: z
      .number()
      .int()
      .min(0)
      .nullable()
      .openapi({ description: 'Fixed time per turn (per_cycle mode)', example: 60000 }),
    cycle_started_at: z
      .string()
      .datetime()
      .nullable()
      .openapi({ description: 'Current cycle start time (ISO 8601)', example: '2024-01-01T00:00:00.000Z' }),
    session_started_at: z
      .string()
      .datetime()
      .nullable()
      .openapi({ description: 'Session start time (ISO 8601)', example: '2024-01-01T00:00:00.000Z' }),
    session_completed_at: z
      .string()
      .datetime()
      .nullable()
      .openapi({ description: 'Session completion time (ISO 8601)', example: null }),

    // Count-up mode
    increment_ms: z
      .number()
      .int()
      .min(0)
      .optional()
      .openapi({ description: 'Time increment for count_up mode (milliseconds)', example: 1000 }),
    max_time_ms: z
      .number()
      .int()
      .min(0)
      .optional()
      .openapi({ description: 'Maximum time for count_up mode (milliseconds)', example: 3600000 }),

    // Metadata
    created_at: z
      .string()
      .datetime()
      .openapi({ description: 'Creation timestamp (ISO 8601)', example: '2024-01-01T00:00:00.000Z' }),
    updated_at: z
      .string()
      .datetime()
      .openapi({ description: 'Last update timestamp (ISO 8601)', example: '2024-01-01T00:00:00.000Z' }),
  })
  .openapi({
    ref: 'SyncState',
    description: 'Complete session state - the core data structure for SyncKairos STATE_UPDATE architecture',
  })

// ============================================================================
// WebSocket API - Server Messages
// ============================================================================

export const WSConnectedMessageSchema = z
  .object({
    type: z.literal('CONNECTED').openapi({ description: 'Message type', example: 'CONNECTED' }),
    sessionId: z.string().openapi({ description: 'Session ID', example: 'session-123' }),
    timestamp: z.number().int().openapi({ description: 'Unix timestamp (ms)', example: 1704067200000 }),
  })
  .openapi({ ref: 'WSConnectedMessage', description: 'Sent immediately after successful WebSocket connection' })

export const WSStateUpdateMessageSchema = z
  .object({
    type: z.literal('STATE_UPDATE').openapi({ description: 'Message type', example: 'STATE_UPDATE' }),
    sessionId: z.string().openapi({ description: 'Session ID', example: 'session-123' }),
    timestamp: z.number().int().openapi({ description: 'Unix timestamp (ms)', example: 1704067200000 }),
    state: SyncStateSchema.openapi({ description: 'Complete session state' }),
  })
  .openapi({
    ref: 'WSStateUpdateMessage',
    description:
      'Core message: Sent whenever session state changes (start, switch, pause, resume, complete). Contains full state.',
  })

export const WSStateSyncMessageSchema = z
  .object({
    type: z.literal('STATE_SYNC').openapi({ description: 'Message type', example: 'STATE_SYNC' }),
    sessionId: z.string().openapi({ description: 'Session ID', example: 'session-123' }),
    timestamp: z.number().int().openapi({ description: 'Unix timestamp (ms)', example: 1704067200000 }),
    state: SyncStateSchema.openapi({ description: 'Current session state' }),
  })
  .openapi({
    ref: 'WSStateSyncMessage',
    description: 'Sent on reconnection or when client requests sync via REQUEST_SYNC. Contains current state.',
  })

export const WSSessionDeletedMessageSchema = z
  .object({
    type: z.literal('SESSION_DELETED').openapi({ description: 'Message type', example: 'SESSION_DELETED' }),
    sessionId: z.string().openapi({ description: 'Session ID', example: 'session-123' }),
    timestamp: z.number().int().openapi({ description: 'Unix timestamp (ms)', example: 1704067200000 }),
  })
  .openapi({
    ref: 'WSSessionDeletedMessage',
    description: 'Sent when session is deleted. Clients should close connection.',
  })

export const WSPongMessageSchema = z
  .object({
    type: z.literal('PONG').openapi({ description: 'Message type', example: 'PONG' }),
    timestamp: z.number().int().openapi({ description: 'Unix timestamp (ms)', example: 1704067200000 }),
  })
  .openapi({ ref: 'WSPongMessage', description: 'Response to client PING message for keep-alive' })

export const WSErrorMessageSchema = z
  .object({
    type: z.literal('ERROR').openapi({ description: 'Message type', example: 'ERROR' }),
    error: z.string().openapi({ description: 'Human-readable error message', example: 'Session not found' }),
    code: z.string().optional().openapi({ description: 'Error code', example: 'SESSION_NOT_FOUND' }),
    timestamp: z.number().int().openapi({ description: 'Unix timestamp (ms)', example: 1704067200000 }),
  })
  .openapi({ ref: 'WSErrorMessage', description: 'Sent when an error occurs' })

export const ServerMessageSchema = z
  .discriminatedUnion('type', [
    WSConnectedMessageSchema,
    WSStateUpdateMessageSchema,
    WSStateSyncMessageSchema,
    WSSessionDeletedMessageSchema,
    WSPongMessageSchema,
    WSErrorMessageSchema,
  ])
  .openapi({ ref: 'ServerMessage', description: 'All possible messages from server to client (discriminated union)' })

// ============================================================================
// WebSocket API - Client Messages
// ============================================================================

export const WSPingMessageSchema = z
  .object({
    type: z.literal('PING').openapi({ description: 'Message type', example: 'PING' }),
  })
  .openapi({ ref: 'WSPingMessage', description: 'Keep-alive message to maintain connection. Server responds with PONG.' })

export const WSRequestSyncMessageSchema = z
  .object({
    type: z.literal('REQUEST_SYNC').openapi({ description: 'Message type', example: 'REQUEST_SYNC' }),
  })
  .openapi({
    ref: 'WSRequestSyncMessage',
    description: 'Request current session state. Useful after reconnection. Server responds with STATE_SYNC.',
  })

export const ClientMessageSchema = z
  .discriminatedUnion('type', [WSPingMessageSchema, WSRequestSyncMessageSchema])
  .openapi({ ref: 'ClientMessage', description: 'All possible messages from client to server (discriminated union)' })

// ============================================================================
// REST API - Request Bodies
// ============================================================================

export const CreateSessionRequestSchema = z
  .object({
    session_id: z.string().openapi({ description: 'Unique session identifier', example: 'debate-001' }),
    sync_mode: SyncModeSchema,
    participants: z
      .array(
        z
          .object({
            participant_id: z.string().openapi({ description: 'Participant ID', example: 'alice' }),
            total_time_ms: z.number().int().min(0).openapi({ description: 'Total time (ms)', example: 300000 }),
            group_id: z.string().optional().openapi({ description: 'Optional group ID', example: 'group-a' }),
          })
          .openapi({ ref: 'CreateParticipant' })
      )
      .openapi({ description: 'List of participants' }),
    time_per_cycle_ms: z
      .number()
      .int()
      .min(0)
      .optional()
      .openapi({ description: 'Time per cycle for per_cycle mode (ms)', example: 60000 }),
    increment_ms: z
      .number()
      .int()
      .min(0)
      .optional()
      .openapi({ description: 'Increment for count_up mode (ms)', example: 1000 }),
    max_time_ms: z
      .number()
      .int()
      .min(0)
      .optional()
      .openapi({ description: 'Max time for count_up mode (ms)', example: 3600000 }),
  })
  .openapi({ ref: 'CreateSessionRequest', description: 'Request body for creating a new session' })

export const SwitchCycleRequestSchema = z
  .object({
    version: z
      .number()
      .int()
      .min(0)
      .optional()
      .openapi({ description: 'Version for optimistic locking', example: 3 }),
  })
  .openapi({ ref: 'SwitchCycleRequest', description: 'Request body for switching cycle (optional optimistic locking)' })

// ============================================================================
// REST API - Response Bodies
// ============================================================================

export const SessionResponseSchema = SyncStateSchema.openapi({
  ref: 'SessionResponse',
  description: 'Response containing full session state',
})

export const SwitchCycleResponseSchema = z
  .object({
    session_id: z.string().openapi({ description: 'Session ID', example: 'debate-001' }),
    previous_participant_id: z
      .string()
      .nullable()
      .openapi({ description: 'Previous active participant ID', example: 'p1' }),
    new_active_participant_id: z.string().openapi({ description: 'New active participant ID', example: 'p2' }),
    switch_timestamp: z
      .string()
      .datetime()
      .openapi({ description: 'Switch timestamp (ISO 8601)', example: '2024-01-01T00:05:00.000Z' }),
    latency_ms: z.number().openapi({ description: 'Operation latency (ms)', example: 4 }),
  })
  .openapi({ ref: 'SwitchCycleResponse', description: 'Response from switchCycle operation (HOT PATH <50ms target)' })

export const ErrorResponseSchema = z
  .object({
    error: z.string().openapi({ description: 'Human-readable error message', example: 'Session not found' }),
    code: z.string().optional().openapi({ description: 'Error code', example: 'SESSION_NOT_FOUND' }),
    details: z.record(z.unknown()).optional().openapi({ description: 'Additional error details' }),
  })
  .openapi({ ref: 'ErrorResponse', description: 'Standard error response format' })

export const HealthResponseSchema = z
  .object({
    status: z.literal('ok').openapi({ description: 'Health status', example: 'ok' }),
  })
  .openapi({ ref: 'HealthResponse', description: 'Basic health check - returns OK if server is running' })

// ============================================================================
// Type Inference (for TypeScript)
// ============================================================================

export type SyncMode = z.infer<typeof SyncModeSchema>
export type SyncStatus = z.infer<typeof SyncStatusSchema>
export type SyncParticipant = z.infer<typeof SyncParticipantSchema>
export type SyncState = z.infer<typeof SyncStateSchema>

export type WSConnectedMessage = z.infer<typeof WSConnectedMessageSchema>
export type WSStateUpdateMessage = z.infer<typeof WSStateUpdateMessageSchema>
export type WSStateSyncMessage = z.infer<typeof WSStateSyncMessageSchema>
export type WSSessionDeletedMessage = z.infer<typeof WSSessionDeletedMessageSchema>
export type WSPongMessage = z.infer<typeof WSPongMessageSchema>
export type WSErrorMessage = z.infer<typeof WSErrorMessageSchema>
export type ServerMessage = z.infer<typeof ServerMessageSchema>

export type WSPingMessage = z.infer<typeof WSPingMessageSchema>
export type WSRequestSyncMessage = z.infer<typeof WSRequestSyncMessageSchema>
export type ClientMessage = z.infer<typeof ClientMessageSchema>

export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>
export type SwitchCycleRequest = z.infer<typeof SwitchCycleRequestSchema>
export type SessionResponse = z.infer<typeof SessionResponseSchema>
export type SwitchCycleResponse = z.infer<typeof SwitchCycleResponseSchema>
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>
export type HealthResponse = z.infer<typeof HealthResponseSchema>
