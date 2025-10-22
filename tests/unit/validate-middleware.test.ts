import { describe, it, expect, vi } from 'vitest'
import { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { validate, validateBody, validateParams, validateQuery } from '@/api/middlewares/validate'

describe('Validation Middleware', () => {
  describe('validate() factory function', () => {
    it('should validate request body and call next() on success', async () => {
      const schema = z.object({ name: z.string(), age: z.number() })
      const middleware = validate(schema, 'body')

      const req = {
        body: { name: 'Alice', age: 30 },
      } as Request
      const res = {} as Response
      const next = vi.fn()

      await middleware(req, res, next)

      expect(next).toHaveBeenCalledOnce()
      expect(next).toHaveBeenCalledWith() // Called without error
      expect(req.body).toEqual({ name: 'Alice', age: 30 })
    })

    it('should validate request params and call next() on success', async () => {
      const schema = z.object({ id: z.string().uuid() })
      const middleware = validate(schema, 'params')

      const req = {
        params: { id: '123e4567-e89b-12d3-a456-426614174000' },
      } as any
      const res = {} as Response
      const next = vi.fn()

      await middleware(req, res, next)

      expect(next).toHaveBeenCalledOnce()
      expect(req.params.id).toBe('123e4567-e89b-12d3-a456-426614174000')
    })

    it('should validate request query and call next() on success', async () => {
      const schema = z.object({ page: z.string(), limit: z.string() })
      const middleware = validate(schema, 'query')

      const req = {
        query: { page: '1', limit: '10' },
      } as any
      const res = {} as Response
      const next = vi.fn()

      await middleware(req, res, next)

      expect(next).toHaveBeenCalledOnce()
      expect(req.query).toEqual({ page: '1', limit: '10' })
    })

    it('should return 400 on validation error', async () => {
      const schema = z.object({ name: z.string() })
      const middleware = validate(schema, 'body')

      const req = {
        body: { name: 123 }, // Wrong type
      } as Request
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as any
      const next = vi.fn()

      await middleware(req, res, next)

      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            details: expect.any(Array),
          }),
        })
      )
      expect(next).not.toHaveBeenCalled()
    })

    it('should include field path in error details', async () => {
      const schema = z.object({
        user: z.object({
          email: z.string().email(),
        }),
      })
      const middleware = validate(schema, 'body')

      const req = {
        body: { user: { email: 'invalid-email' } },
      } as Request
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as any
      const next = vi.fn()

      await middleware(req, res, next)

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            details: expect.arrayContaining([
              expect.objectContaining({
                field: expect.stringContaining('user'),
                message: expect.any(String),
              }),
            ]),
          }),
        })
      )
    })

    it('should remove extra fields not in schema', async () => {
      const schema = z.object({ name: z.string() })
      const middleware = validate(schema, 'body')

      const req = {
        body: { name: 'Alice', extra: 'field' },
      } as Request
      const res = {} as Response
      const next = vi.fn()

      await middleware(req, res, next)

      expect(next).toHaveBeenCalledOnce()
      expect(req.body).toEqual({ name: 'Alice' })
      expect(req.body).not.toHaveProperty('extra')
    })

    it('should pass non-ZodError errors to next()', async () => {
      const schema = z.object({ name: z.string() })
      const middleware = validate(schema, 'body')

      // Simulate an unexpected error
      const parseAsyncSpy = vi.spyOn(schema, 'parseAsync')
      const customError = new Error('Unexpected error')
      parseAsyncSpy.mockRejectedValueOnce(customError)

      const req = {
        body: { name: 'Alice' },
      } as Request
      const res = {
        status: vi.fn(),
        json: vi.fn(),
      } as any
      const next = vi.fn()

      await middleware(req, res, next)

      expect(next).toHaveBeenCalledWith(customError)
      expect(res.status).not.toHaveBeenCalled()
      expect(res.json).not.toHaveBeenCalled()

      parseAsyncSpy.mockRestore()
    })

    it('should default to validating body when target not specified', async () => {
      const schema = z.object({ name: z.string() })
      const middleware = validate(schema) // No target specified

      const req = {
        body: { name: 'Alice' },
      } as Request
      const res = {} as Response
      const next = vi.fn()

      await middleware(req, res, next)

      expect(next).toHaveBeenCalledOnce()
      expect(req.body).toEqual({ name: 'Alice' })
    })
  })

  describe('validateBody() helper', () => {
    it('should validate request body', async () => {
      const schema = z.object({ name: z.string() })
      const middleware = validateBody(schema)

      const req = {
        body: { name: 'Bob' },
      } as Request
      const res = {} as Response
      const next = vi.fn()

      await middleware(req, res, next)

      expect(next).toHaveBeenCalledOnce()
      expect(req.body).toEqual({ name: 'Bob' })
    })

    it('should return 400 for invalid body', async () => {
      const schema = z.object({ age: z.number() })
      const middleware = validateBody(schema)

      const req = {
        body: { age: 'invalid' },
      } as Request
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as any
      const next = vi.fn()

      await middleware(req, res, next)

      expect(res.status).toHaveBeenCalledWith(400)
      expect(next).not.toHaveBeenCalled()
    })
  })

  describe('validateParams() helper', () => {
    it('should validate request params', async () => {
      const schema = z.object({ id: z.string() })
      const middleware = validateParams(schema)

      const req = {
        params: { id: 'test-id' },
      } as any
      const res = {} as Response
      const next = vi.fn()

      await middleware(req, res, next)

      expect(next).toHaveBeenCalledOnce()
      expect(req.params.id).toBe('test-id')
    })

    it('should return 400 for invalid params', async () => {
      const schema = z.object({ id: z.string().uuid() })
      const middleware = validateParams(schema)

      const req = {
        params: { id: 'not-a-uuid' },
      } as any
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as any
      const next = vi.fn()

      await middleware(req, res, next)

      expect(res.status).toHaveBeenCalledWith(400)
      expect(next).not.toHaveBeenCalled()
    })
  })

  describe('validateQuery() helper', () => {
    it('should validate request query parameters', async () => {
      const schema = z.object({ search: z.string() })
      const middleware = validateQuery(schema)

      const req = {
        query: { search: 'test' },
      } as any
      const res = {} as Response
      const next = vi.fn()

      await middleware(req, res, next)

      expect(next).toHaveBeenCalledOnce()
      expect(req.query.search).toBe('test')
    })

    it('should return 400 for invalid query', async () => {
      const schema = z.object({ page: z.string().regex(/^\d+$/) })
      const middleware = validateQuery(schema)

      const req = {
        query: { page: 'invalid' },
      } as any
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as any
      const next = vi.fn()

      await middleware(req, res, next)

      expect(res.status).toHaveBeenCalledWith(400)
      expect(next).not.toHaveBeenCalled()
    })
  })

  describe('Error message format', () => {
    it('should format multiple validation errors', async () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
        email: z.string().email(),
      })
      const middleware = validate(schema, 'body')

      const req = {
        body: {
          name: 123, // Wrong type
          age: 'not-a-number', // Wrong type
          email: 'invalid-email', // Invalid format
        },
      } as Request
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as any
      const next = vi.fn()

      await middleware(req, res, next)

      const response = res.json.mock.calls[0][0]
      expect(response.error.details.length).toBeGreaterThan(0)
      expect(response.error.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: expect.any(String),
            message: expect.any(String),
            code: expect.any(String),
          }),
        ])
      )
    })

    it('should include error codes in details', async () => {
      const schema = z.object({ value: z.number().min(10) })
      const middleware = validate(schema, 'body')

      const req = {
        body: { value: 5 },
      } as Request
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as any
      const next = vi.fn()

      await middleware(req, res, next)

      const response = res.json.mock.calls[0][0]
      expect(response.error.details[0]).toHaveProperty('code')
      expect(response.error.details[0].code).toBeTruthy()
    })
  })
})
