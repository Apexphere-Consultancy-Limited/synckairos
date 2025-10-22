// Error Handler Middleware
// Maps custom errors to HTTP status codes and formats error responses
//
// Error mappings:
// - SessionNotFoundError → 404 Not Found
// - ConcurrencyError → 409 Conflict
// - StateDeserializationError → 500 Internal Server Error
// - ZodError → 400 Bad Request
// - Invalid state transitions → 400 Bad Request
// - Unknown errors → 500 Internal Server Error

import { Request, Response, NextFunction } from 'express'
import { SessionNotFoundError, ConcurrencyError, StateDeserializationError } from '@/errors/StateErrors'
import { ZodError } from 'zod'
import { createComponentLogger } from '@/utils/logger'

const logger = createComponentLogger('ErrorHandler')

/**
 * Error response format
 */
interface ErrorResponse {
  error: {
    code: string
    message: string
    details?: any
    stack?: string
  }
}

/**
 * Global error handler middleware
 *
 * MUST BE THE LAST MIDDLEWARE in the Express app.
 * Catches all errors and formats them into consistent responses.
 *
 * @param err - Error object
 * @param req - Express request
 * @param res - Express response
 * @param next - Express next function
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Log error with request context
  logger.error(
    {
      err,
      url: req.url,
      method: req.method,
      body: req.body,
      params: req.params,
    },
    'Request error'
  )

  // Default error response
  let statusCode = 500
  let errorCode = 'INTERNAL_ERROR'
  let message = 'Internal server error'
  let details: any = undefined

  // Map custom errors to HTTP status codes
  if (err instanceof SessionNotFoundError) {
    statusCode = 404
    errorCode = 'SESSION_NOT_FOUND'
    message = err.message
  } else if (err instanceof ConcurrencyError) {
    statusCode = 409
    errorCode = 'CONFLICT'
    message = 'Concurrent modification detected, please retry'
    details = {
      expected_version: (err as any).expectedVersion,
      actual_version: (err as any).actualVersion,
    }
  } else if (err instanceof StateDeserializationError) {
    statusCode = 500
    errorCode = 'STATE_DESERIALIZATION_ERROR'
    message = 'Failed to deserialize session state'
    details = {
      session_id: (err as any).sessionId,
    }
  } else if (err instanceof ZodError) {
    statusCode = 400
    errorCode = 'VALIDATION_ERROR'
    message = 'Request validation failed'
    details = err.issues.map((issue: any) => ({
      field: issue.path.join('.'),
      message: issue.message,
      received: issue.received,
    }))
  } else if (
    err.message.includes('not running') ||
    err.message.includes('cannot be started') ||
    err.message.includes('cannot be paused') ||
    err.message.includes('cannot be resumed')
  ) {
    // Invalid state transitions
    statusCode = 400
    errorCode = 'INVALID_STATE_TRANSITION'
    message = err.message
  } else if (
    err.message.includes('Invalid session_id format') ||
    err.message.includes('participants required') ||
    err.message.includes('Participant') ||
    err.message.includes('not found')
  ) {
    // Validation errors
    statusCode = 400
    errorCode = 'VALIDATION_ERROR'
    message = err.message
  }

  // Format error response
  const response: ErrorResponse = {
    error: {
      code: errorCode,
      message,
      ...(details && { details }),
    },
  }

  // Include stack trace in development mode
  if (process.env.NODE_ENV === 'development') {
    response.error.stack = err.stack
  }

  // Send error response
  res.status(statusCode).json(response)
}
