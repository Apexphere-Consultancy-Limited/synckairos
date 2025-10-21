# Task 2.3: Request Validation (Zod)

**Phase:** 2 - Business Logic & API
**Component:** Request Validation with Zod
**Priority:** Medium
**Estimated Time:** 1 day
**Status:** 🔴 Not Started
**Dependencies:** Task 2.2 (REST API)

---

## Objective

Implement comprehensive request validation using Zod schemas for all REST API endpoints. Ensure type-safe validation with clear error messages and TypeScript type inference.

---

## Success Criteria

- [ ] All endpoints validated with Zod schemas
- [ ] Invalid requests return 400 with clear, structured errors
- [ ] TypeScript type inference working (types inferred from Zod schemas)
- [ ] Validation errors include field names and helpful messages
- [ ] Unit tests for validation logic

---

## Day 1: Schema Definition & Middleware (8 hours)

### Morning: Zod Schemas (4 hours)

#### 1. Install Zod (5 min)

```bash
pnpm add zod
```

#### 2. Create Session Schemas (2 hours)

**File:** `src/api/schemas/session.ts`

- [ ] CreateSessionSchema
  ```typescript
  import { z } from 'zod'

  export const ParticipantSchema = z.object({
    participant_id: z.string().uuid('Participant ID must be a valid UUID'),
    participant_index: z.number().int().min(0, 'Participant index must be non-negative'),
    total_time_ms: z.number()
      .int()
      .min(1000, 'Total time must be at least 1000ms (1 second)')
      .max(86400000, 'Total time cannot exceed 86400000ms (24 hours)'),
    group_id: z.string().uuid().optional()
  })

  export const CreateSessionSchema = z.object({
    session_id: z.string().uuid('Session ID must be a valid UUID'),
    sync_mode: z.enum(
      ['per_participant', 'per_cycle', 'per_group', 'global', 'count_up'],
      {
        errorMap: () => ({ message: 'Invalid sync mode' })
      }
    ),
    participants: z.array(ParticipantSchema)
      .min(1, 'At least one participant is required')
      .max(1000, 'Cannot exceed 1000 participants'),
    total_time_ms: z.number().int().min(1000).max(86400000),
    time_per_cycle_ms: z.number().int().min(1000).max(86400000).optional(),
    increment_ms: z.number().int().min(0).max(60000).optional(),
    max_time_ms: z.number().int().min(1000).max(86400000).optional(),
    metadata: z.record(z.any()).optional()
  })

  // Infer TypeScript types
  export type CreateSessionInput = z.infer<typeof CreateSessionSchema>
  export type ParticipantInput = z.infer<typeof ParticipantSchema>
  ```

- [ ] SwitchCycleSchema
  ```typescript
  export const SwitchCycleSchema = z.object({
    next_participant_id: z.string().uuid().optional()
  })

  export type SwitchCycleInput = z.infer<typeof SwitchCycleSchema>
  ```

- [ ] SessionIdParamSchema
  ```typescript
  export const SessionIdParamSchema = z.object({
    id: z.string().uuid('Session ID must be a valid UUID')
  })

  export type SessionIdParam = z.infer<typeof SessionIdParamSchema>
  ```

#### 3. Create Validation Utilities (1 hour)

**File:** `src/api/schemas/validators.ts`

- [ ] Custom validation helpers
  ```typescript
  import { z } from 'zod'

  // UUID v4 validator
  export const uuidV4 = () => z.string().uuid()

  // Time range validator
  export const timeRange = (min: number, max: number, name: string) =>
    z.number()
      .int(`${name} must be an integer`)
      .min(min, `${name} must be at least ${min}ms`)
      .max(max, `${name} cannot exceed ${max}ms`)

  // Positive integer validator
  export const positiveInt = (name: string) =>
    z.number()
      .int(`${name} must be an integer`)
      .min(0, `${name} must be non-negative`)

  // Custom error formatter
  export function formatZodErrors(errors: z.ZodError) {
    return errors.errors.map(err => ({
      field: err.path.join('.'),
      message: err.message,
      code: err.code
    }))
  }
  ```

#### 4. Additional Schemas (1 hour)

- [ ] Update/modify schemas as needed
  ```typescript
  // Empty body schemas (for endpoints without body)
  export const EmptyBodySchema = z.object({}).strict()

  // Query parameter schemas (if needed in future)
  export const PaginationSchema = z.object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional()
  })
  ```

### Afternoon: Validation Middleware (4 hours)

#### 5. Create Validation Middleware (2 hours)

**File:** `src/api/middlewares/validate.ts`

- [ ] Generic validation middleware
  ```typescript
  import { Request, Response, NextFunction } from 'express'
  import { ZodSchema, ZodError } from 'zod'
  import { formatZodErrors } from '@/api/schemas/validators'

  type ValidationTarget = 'body' | 'params' | 'query'

  export function validate(schema: ZodSchema, target: ValidationTarget = 'body') {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        // Validate the target
        const data = target === 'body' ? req.body :
                     target === 'params' ? req.params :
                     req.query

        // Parse and validate
        const validated = await schema.parseAsync(data)

        // Replace with validated data (type-safe)
        if (target === 'body') req.body = validated
        if (target === 'params') req.params = validated
        if (target === 'query') req.query = validated

        next()
      } catch (err) {
        if (err instanceof ZodError) {
          res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Request validation failed',
              details: formatZodErrors(err)
            }
          })
        } else {
          next(err)
        }
      }
    }
  }

  // Convenience validators
  export const validateBody = (schema: ZodSchema) => validate(schema, 'body')
  export const validateParams = (schema: ZodSchema) => validate(schema, 'params')
  export const validateQuery = (schema: ZodSchema) => validate(schema, 'query')
  ```

#### 6. Apply Validation to Routes (1.5 hours)

**Update:** `src/api/routes/sessions.ts`

- [ ] Add validation to each endpoint
  ```typescript
  import { validateBody, validateParams } from '@/api/middlewares/validate'
  import {
    CreateSessionSchema,
    SwitchCycleSchema,
    SessionIdParamSchema,
    EmptyBodySchema
  } from '@/api/schemas/session'

  export function createSessionRoutes(syncEngine: SyncEngine) {
    const router = Router()

    // POST /v1/sessions - validate body
    router.post('/v1/sessions',
      validateBody(CreateSessionSchema),
      async (req, res, next) => {
        try {
          const state = await syncEngine.createSession(req.body)
          res.status(201).json({ data: state })
        } catch (err) {
          next(err)
        }
      }
    )

    // POST /v1/sessions/:id/start - validate params
    router.post('/v1/sessions/:id/start',
      validateParams(SessionIdParamSchema),
      async (req, res, next) => {
        try {
          const state = await syncEngine.startSession(req.params.id)
          res.json({ data: state })
        } catch (err) {
          next(err)
        }
      }
    )

    // POST /v1/sessions/:id/switch - validate params and body
    router.post('/v1/sessions/:id/switch',
      validateParams(SessionIdParamSchema),
      validateBody(SwitchCycleSchema),
      async (req, res, next) => {
        try {
          const { next_participant_id } = req.body
          const result = await syncEngine.switchCycle(
            req.params.id,
            undefined,
            next_participant_id
          )
          res.json({ data: result })
        } catch (err) {
          next(err)
        }
      }
    )

    // GET /v1/sessions/:id - validate params
    router.get('/v1/sessions/:id',
      validateParams(SessionIdParamSchema),
      async (req, res, next) => {
        try {
          const state = await syncEngine.getCurrentState(req.params.id)
          res.json({ data: state })
        } catch (err) {
          next(err)
        }
      }
    )

    // POST /v1/sessions/:id/pause - validate params
    router.post('/v1/sessions/:id/pause',
      validateParams(SessionIdParamSchema),
      async (req, res, next) => {
        try {
          const state = await syncEngine.pauseSession(req.params.id)
          res.json({ data: state })
        } catch (err) {
          next(err)
        }
      }
    )

    // POST /v1/sessions/:id/resume - validate params
    router.post('/v1/sessions/:id/resume',
      validateParams(SessionIdParamSchema),
      async (req, res, next) => {
        try {
          const state = await syncEngine.resumeSession(req.params.id)
          res.json({ data: state })
        } catch (err) {
          next(err)
        }
      }
    )

    // POST /v1/sessions/:id/complete - validate params
    router.post('/v1/sessions/:id/complete',
      validateParams(SessionIdParamSchema),
      async (req, res, next) => {
        try {
          const state = await syncEngine.completeSession(req.params.id)
          res.json({ data: state })
        } catch (err) {
          next(err)
        }
      }
    )

    // DELETE /v1/sessions/:id - validate params
    router.delete('/v1/sessions/:id',
      validateParams(SessionIdParamSchema),
      async (req, res, next) => {
        try {
          await syncEngine.deleteSession(req.params.id)
          res.status(204).send()
        } catch (err) {
          next(err)
        }
      }
    )

    return router
  }
  ```

#### 7. Unit Tests for Validation (30 min)

**File:** `tests/unit/validation.test.ts`

- [ ] Test valid inputs pass
  ```typescript
  import { describe, it, expect } from 'vitest'
  import { CreateSessionSchema, ParticipantSchema } from '@/api/schemas/session'

  describe('Validation Schemas', () => {
    describe('ParticipantSchema', () => {
      it('should validate valid participant', () => {
        const valid = {
          participant_id: '123e4567-e89b-12d3-a456-426614174000',
          participant_index: 0,
          total_time_ms: 60000
        }

        const result = ParticipantSchema.safeParse(valid)
        expect(result.success).toBe(true)
      })

      it('should reject invalid UUID', () => {
        const invalid = {
          participant_id: 'not-a-uuid',
          participant_index: 0,
          total_time_ms: 60000
        }

        const result = ParticipantSchema.safeParse(invalid)
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error.errors[0].path).toContain('participant_id')
        }
      })

      it('should reject negative time', () => {
        const invalid = {
          participant_id: '123e4567-e89b-12d3-a456-426614174000',
          participant_index: 0,
          total_time_ms: -1000
        }

        const result = ParticipantSchema.safeParse(invalid)
        expect(result.success).toBe(false)
      })
    })

    describe('CreateSessionSchema', () => {
      it('should validate complete session config', () => {
        const valid = {
          session_id: '123e4567-e89b-12d3-a456-426614174000',
          sync_mode: 'per_participant',
          participants: [
            {
              participant_id: '223e4567-e89b-12d3-a456-426614174001',
              participant_index: 0,
              total_time_ms: 60000
            }
          ],
          total_time_ms: 120000,
          increment_ms: 1000
        }

        const result = CreateSessionSchema.safeParse(valid)
        expect(result.success).toBe(true)
      })

      it('should reject invalid sync_mode', () => {
        const invalid = {
          session_id: '123e4567-e89b-12d3-a456-426614174000',
          sync_mode: 'invalid_mode',
          participants: [],
          total_time_ms: 120000
        }

        const result = CreateSessionSchema.safeParse(invalid)
        expect(result.success).toBe(false)
      })

      it('should reject empty participants array', () => {
        const invalid = {
          session_id: '123e4567-e89b-12d3-a456-426614174000',
          sync_mode: 'per_participant',
          participants: [],
          total_time_ms: 120000
        }

        const result = CreateSessionSchema.safeParse(invalid)
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error.errors[0].path).toContain('participants')
        }
      })
    })
  })
  ```

---

## Integration with Error Handler

The validation middleware throws ZodError, which is caught by the error handler middleware (Task 2.2):

```typescript
// In errorHandler.ts
if (err instanceof ZodError) {
  statusCode = 400
  errorCode = 'VALIDATION_ERROR'
  message = 'Request validation failed'
  details = err.errors.map(e => ({
    field: e.path.join('.'),
    message: e.message
  }))
}
```

**Example error response:**
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [
      {
        "field": "participants.0.total_time_ms",
        "message": "Total time must be at least 1000ms (1 second)"
      }
    ]
  }
}
```

---

## TypeScript Type Inference

Once Zod schemas are in place, you get automatic TypeScript types:

```typescript
import { CreateSessionInput } from '@/api/schemas/session'

// This is now fully type-safe
function handleCreateSession(input: CreateSessionInput) {
  // TypeScript knows exact shape of input
  console.log(input.session_id) // string (UUID)
  console.log(input.sync_mode) // 'per_participant' | 'per_cycle' | ...
  console.log(input.participants[0].total_time_ms) // number
}
```

---

## Deliverables

### Code Files
- [ ] `src/api/schemas/session.ts` - Zod schemas for all endpoints
- [ ] `src/api/schemas/validators.ts` - Custom validation helpers
- [ ] `src/api/middlewares/validate.ts` - Validation middleware
- [ ] `tests/unit/validation.test.ts` - Unit tests

### Updated Files
- [ ] `src/api/routes/sessions.ts` - Add validation to all routes

### Documentation
- [ ] JSDoc comments for all schemas
- [ ] Example valid/invalid payloads in comments

---

## Testing Checklist

- [ ] All schemas validate correct inputs
- [ ] All schemas reject invalid inputs
- [ ] Error messages are clear and specific
- [ ] TypeScript type inference working
- [ ] Integration tests include validation errors

---

## Blocked By

- Task 2.2 (REST API) - Must be in place

## Blocks

- None (validation is parallel work)

---

**Status:** 🔴 Not Started
**Next Task:** Task 2.4 - WebSocket Server
