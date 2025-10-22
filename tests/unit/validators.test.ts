import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { uuidV4, timeRange, positiveInt, formatZodErrors } from '@/api/schemas/validators'

describe('Validation Helpers', () => {
  describe('uuidV4()', () => {
    it('should validate valid UUID v4', () => {
      const schema = uuidV4()
      const result = schema.safeParse('123e4567-e89b-12d3-a456-426614174000')
      expect(result.success).toBe(true)
    })

    it('should reject invalid UUID', () => {
      const schema = uuidV4()
      const result = schema.safeParse('not-a-uuid')
      expect(result.success).toBe(false)
    })

    it('should reject non-string values', () => {
      const schema = uuidV4()
      const result = schema.safeParse(12345)
      expect(result.success).toBe(false)
    })

    it('should reject empty string', () => {
      const schema = uuidV4()
      const result = schema.safeParse('')
      expect(result.success).toBe(false)
    })
  })

  describe('timeRange()', () => {
    it('should validate time within range', () => {
      const schema = timeRange(1000, 60000, 'duration')
      const result = schema.safeParse(30000)
      expect(result.success).toBe(true)
    })

    it('should validate minimum boundary', () => {
      const schema = timeRange(1000, 60000, 'duration')
      const result = schema.safeParse(1000)
      expect(result.success).toBe(true)
    })

    it('should validate maximum boundary', () => {
      const schema = timeRange(1000, 60000, 'duration')
      const result = schema.safeParse(60000)
      expect(result.success).toBe(true)
    })

    it('should reject time below minimum', () => {
      const schema = timeRange(1000, 60000, 'duration')
      const result = schema.safeParse(500)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('at least 1000ms')
      }
    })

    it('should reject time above maximum', () => {
      const schema = timeRange(1000, 60000, 'duration')
      const result = schema.safeParse(70000)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('cannot exceed 60000ms')
      }
    })

    it('should reject non-integer values', () => {
      const schema = timeRange(1000, 60000, 'duration')
      const result = schema.safeParse(30000.5)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('must be an integer')
      }
    })

    it('should use field name in error messages', () => {
      const schema = timeRange(1000, 60000, 'custom_field')
      const result = schema.safeParse(500)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('custom_field')
      }
    })
  })

  describe('positiveInt()', () => {
    it('should validate zero', () => {
      const schema = positiveInt('count')
      const result = schema.safeParse(0)
      expect(result.success).toBe(true)
    })

    it('should validate positive integers', () => {
      const schema = positiveInt('count')
      const result = schema.safeParse(42)
      expect(result.success).toBe(true)
    })

    it('should reject negative numbers', () => {
      const schema = positiveInt('count')
      const result = schema.safeParse(-1)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('must be non-negative')
      }
    })

    it('should reject non-integer values', () => {
      const schema = positiveInt('count')
      const result = schema.safeParse(3.14)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('must be an integer')
      }
    })

    it('should use field name in error messages', () => {
      const schema = positiveInt('custom_count')
      const result = schema.safeParse(-5)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('custom_count')
      }
    })
  })

  describe('formatZodErrors()', () => {
    it('should format single validation error', () => {
      const schema = z.object({
        name: z.string(),
      })

      const result = schema.safeParse({ name: 123 })
      expect(result.success).toBe(false)

      if (!result.success) {
        const formatted = formatZodErrors(result.error)
        expect(formatted).toHaveLength(1)
        expect(formatted[0]).toHaveProperty('field')
        expect(formatted[0]).toHaveProperty('message')
        expect(formatted[0]).toHaveProperty('code')
        expect(formatted[0].field).toBe('name')
      }
    })

    it('should format multiple validation errors', () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
        email: z.string().email(),
      })

      const result = schema.safeParse({
        name: 123,
        age: 'not-a-number',
        email: 'invalid-email',
      })
      expect(result.success).toBe(false)

      if (!result.success) {
        const formatted = formatZodErrors(result.error)
        expect(formatted.length).toBeGreaterThan(0)
        formatted.forEach((err) => {
          expect(err).toHaveProperty('field')
          expect(err).toHaveProperty('message')
          expect(err).toHaveProperty('code')
          expect(typeof err.field).toBe('string')
          expect(typeof err.message).toBe('string')
          expect(typeof err.code).toBe('string')
        })
      }
    })

    it('should format nested field paths correctly', () => {
      const schema = z.object({
        user: z.object({
          profile: z.object({
            email: z.string().email(),
          }),
        }),
      })

      const result = schema.safeParse({
        user: {
          profile: {
            email: 'invalid-email',
          },
        },
      })
      expect(result.success).toBe(false)

      if (!result.success) {
        const formatted = formatZodErrors(result.error)
        expect(formatted[0].field).toBe('user.profile.email')
      }
    })

    it('should format array index paths correctly', () => {
      const schema = z.object({
        items: z.array(
          z.object({
            id: z.string().uuid(),
          })
        ),
      })

      const result = schema.safeParse({
        items: [{ id: 'invalid-uuid' }],
      })
      expect(result.success).toBe(false)

      if (!result.success) {
        const formatted = formatZodErrors(result.error)
        expect(formatted[0].field).toBe('items.0.id')
      }
    })

    it('should include error codes', () => {
      const schema = z.object({
        value: z.number().min(10),
      })

      const result = schema.safeParse({ value: 5 })
      expect(result.success).toBe(false)

      if (!result.success) {
        const formatted = formatZodErrors(result.error)
        expect(formatted[0].code).toBeTruthy()
        expect(typeof formatted[0].code).toBe('string')
      }
    })

    it('should handle empty path (root level error)', () => {
      const schema = z.string()
      const result = schema.safeParse(123)
      expect(result.success).toBe(false)

      if (!result.success) {
        const formatted = formatZodErrors(result.error)
        expect(formatted[0].field).toBe('')
      }
    })

    it('should preserve original error messages', () => {
      const schema = z.object({
        age: z.number().min(18, 'You must be at least 18 years old'),
      })

      const result = schema.safeParse({ age: 15 })
      expect(result.success).toBe(false)

      if (!result.success) {
        const formatted = formatZodErrors(result.error)
        expect(formatted[0].message).toBe('You must be at least 18 years old')
      }
    })
  })

  describe('Helper Functions Integration', () => {
    it('should work together in a complex schema', () => {
      const schema = z.object({
        session_id: uuidV4(),
        duration_ms: timeRange(1000, 86400000, 'duration'),
        participant_count: positiveInt('participant_count'),
      })

      const validData = {
        session_id: '123e4567-e89b-12d3-a456-426614174000',
        duration_ms: 60000,
        participant_count: 5,
      }

      const result = schema.safeParse(validData)
      expect(result.success).toBe(true)
    })

    it('should format errors from combined helper functions', () => {
      const schema = z.object({
        session_id: uuidV4(),
        duration_ms: timeRange(1000, 86400000, 'duration'),
        participant_count: positiveInt('participant_count'),
      })

      const invalidData = {
        session_id: 'not-a-uuid',
        duration_ms: 500,
        participant_count: -1,
      }

      const result = schema.safeParse(invalidData)
      expect(result.success).toBe(false)

      if (!result.success) {
        const formatted = formatZodErrors(result.error)
        expect(formatted.length).toBe(3)
        expect(formatted.map((e) => e.field)).toContain('session_id')
        expect(formatted.map((e) => e.field)).toContain('duration_ms')
        expect(formatted.map((e) => e.field)).toContain('participant_count')
      }
    })
  })
})
