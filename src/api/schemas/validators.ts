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
 * Formats Zod validation errors into a consistent structure
 *
 * @param error - ZodError instance
 * @returns Array of formatted error objects
 *
 * @example
 * const errors = formatZodErrors(zodError)
 * // [
 * //   {
 * //     field: "participants.0.total_time_ms",
 * //     message: "Total time must be at least 1000ms",
 * //     code: "too_small"
 * //   }
 * // ]
 */
export function formatZodErrors(error: z.ZodError) {
  return error.issues.map((err) => ({
    field: err.path.join('.'),
    message: err.message,
    code: err.code,
  }))
}
