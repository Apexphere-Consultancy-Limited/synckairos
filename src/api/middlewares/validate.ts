import { Request, Response, NextFunction } from 'express'
import { ZodSchema, ZodError } from 'zod'
import { formatZodErrors } from '@/api/schemas/validators'

/**
 * Validation target type
 * Determines which part of the request to validate
 */
type ValidationTarget = 'body' | 'params' | 'query'

/**
 * Generic validation middleware factory
 * Creates middleware that validates a specific part of the request using a Zod schema
 *
 * @param schema - Zod schema to validate against
 * @param target - Which part of the request to validate ('body', 'params', or 'query')
 * @returns Express middleware function
 *
 * @example
 * router.post('/sessions',
 *   validate(CreateSessionSchema, 'body'),
 *   async (req, res) => {
 *     // req.body is now validated and type-safe
 *   }
 * )
 */
export function validate(
  schema: ZodSchema,
  target: ValidationTarget = 'body'
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Determine which part of the request to validate
      const data =
        target === 'body'
          ? req.body
          : target === 'params'
            ? req.params
            : req.query

      // Parse and validate the data
      const validated = await schema.parseAsync(data)

      // Replace with validated data (ensures type safety and removes extra fields)
      if (target === 'body') {
        req.body = validated
      } else if (target === 'params') {
        req.params = validated as any
      } else if (target === 'query') {
        req.query = validated as any
      }

      next()
    } catch (err) {
      if (err instanceof ZodError) {
        // Format validation errors consistently
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            details: formatZodErrors(err),
          },
        })
      } else {
        // Pass non-validation errors to the error handler
        next(err)
      }
    }
  }
}

/**
 * Convenience middleware for validating request body
 * @param schema - Zod schema to validate against
 * @returns Express middleware function
 */
export const validateBody = (schema: ZodSchema) => validate(schema, 'body')

/**
 * Convenience middleware for validating request params
 * @param schema - Zod schema to validate against
 * @returns Express middleware function
 */
export const validateParams = (schema: ZodSchema) => validate(schema, 'params')

/**
 * Convenience middleware for validating request query parameters
 * @param schema - Zod schema to validate against
 * @returns Express middleware function
 */
export const validateQuery = (schema: ZodSchema) => validate(schema, 'query')
