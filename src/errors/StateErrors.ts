// Custom error types for state management
// Provides structured, actionable error information

/**
 * Thrown when a requested session is not found in Redis
 */
export class SessionNotFoundError extends Error {
  public readonly sessionId: string
  public readonly code = 'SESSION_NOT_FOUND'

  constructor(sessionId: string) {
    super(`Session ${sessionId} not found`)
    this.name = 'SessionNotFoundError'
    this.sessionId = sessionId

    // Maintains proper stack trace for where error was thrown (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, SessionNotFoundError)
    }
  }
}

/**
 * Thrown when concurrent modification is detected via optimistic locking
 */
export class ConcurrencyError extends Error {
  public readonly sessionId: string
  public readonly expectedVersion: number
  public readonly actualVersion: number
  public readonly code = 'CONCURRENT_MODIFICATION'

  constructor(sessionId: string, expectedVersion: number, actualVersion: number) {
    super(
      `Concurrent modification detected on session ${sessionId}: expected version ${expectedVersion}, found ${actualVersion}`
    )
    this.name = 'ConcurrencyError'
    this.sessionId = sessionId
    this.expectedVersion = expectedVersion
    this.actualVersion = actualVersion

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ConcurrencyError)
    }
  }
}

/**
 * Thrown when session state cannot be deserialized from Redis
 */
export class StateDeserializationError extends Error {
  public readonly sessionId: string
  public readonly rawData: string
  public readonly code = 'STATE_DESERIALIZATION_ERROR'

  constructor(sessionId: string, rawData: string, cause?: Error) {
    super(`Failed to deserialize state for session ${sessionId}`)
    this.name = 'StateDeserializationError'
    this.sessionId = sessionId
    this.rawData = rawData

    // Include original error as cause if available
    if (cause && 'cause' in Error.prototype) {
      Object.defineProperty(this, 'cause', { value: cause })
    }

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, StateDeserializationError)
    }
  }
}
