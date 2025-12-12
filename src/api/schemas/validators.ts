import { z } from 'zod'

/**
 * UUID v4 validator helper
 * @returns Zod schema for UUID validation
 */
export const uuidV4 = () => z.string().uuid()

/**
 * Time range validator helper
 * Creates a validated integer within a specific time range
 *
 * @param min - Minimum allowed value in milliseconds
 * @param max - Maximum allowed value in milliseconds
 * @param name - Field name for error messages
 * @returns Zod schema for time validation
 */
export const timeRange = (min: number, max: number, name: string) =>
  z
    .number()
    .int(`${name} must be an integer`)
    .min(min, `${name} must be at least ${min}ms`)
    .max(max, `${name} cannot exceed ${max}ms`)

/**
 * Positive integer validator helper
 * @param name - Field name for error messages
 * @returns Zod schema for positive integer validation
 */
export const positiveInt = (name: string) =>
  z
    .number()
    .int(`${name} must be an integer`)
    .min(0, `${name} must be non-negative`)

/**
 * Formats Zod validation errors into a consistent structure with helpful hints
 *
 * @param error - ZodError instance
 * @param requestBody - Optional request body to provide context-aware hints
 * @returns Array of formatted error objects
 *
 * @example
 * const errors = formatZodErrors(zodError, req.body)
 * // [
 * //   {
 * //     field: "participants.0.total_time_ms",
 * //     message: "Total time must be at least 1000ms",
 * //     code: "too_small",
 * //     hint: "Ensure all participant time values are at least 1 second (1000ms)"
 * //   }
 * // ]
 */
export function formatZodErrors(error: z.ZodError, requestBody?: any) {
  return error.issues.map((err) => {
    const field = err.path.join('.')
    const formattedError: any = {
      field,
      message: err.message,
      code: err.code,
    }

    // Add helpful hints for specific error scenarios
    if (field === 'total_time_ms' && err.code === 'invalid_type') {
      const syncMode = requestBody?.sync_mode
      if (syncMode === 'per_participant') {
        formattedError.hint =
          'For per_participant mode, total_time_ms is optional and will be auto-calculated from participant times if omitted. You can provide it explicitly or let it auto-calculate.'
      } else if (syncMode === 'global' || syncMode === 'per_cycle' || syncMode === 'per_group') {
        formattedError.hint =
          `For ${syncMode} mode, total_time_ms is required. Provide the total time budget for the session in milliseconds.`
      } else if (syncMode === 'count_up') {
        formattedError.hint =
          'For count_up mode, use max_time_ms instead of total_time_ms to specify the maximum allowed time.'
      } else {
        formattedError.hint =
          'total_time_ms requirements vary by sync_mode. For per_participant it\'s optional (auto-calculated), for global/per_cycle/per_group it\'s required.'
      }
    }

    return formattedError
  })
}
