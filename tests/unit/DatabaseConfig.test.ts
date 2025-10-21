/**
 * Database Configuration Unit Tests
 *
 * Tests the PostgreSQL connection pool configuration and health checks
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Pool } from 'pg'

describe('DatabaseConfig', () => {
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env }

    // Clear module cache to reload with new env vars
    vi.resetModules()
  })

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv
  })

  describe('Pool Configuration', () => {
    it('should create pool with default configuration', async () => {
      process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/testdb'

      const { pool } = await import('@/config/database')

      expect(pool).toBeInstanceOf(Pool)
      expect(pool.options.min).toBe(2)
      expect(pool.options.max).toBe(20)
      expect(pool.options.idleTimeoutMillis).toBe(30000)
      expect(pool.options.connectionTimeoutMillis).toBe(5000)

      await pool.end()
    })

    it('should use custom pool sizes from environment', async () => {
      process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/testdb'
      process.env.DATABASE_POOL_MIN = '5'
      process.env.DATABASE_POOL_MAX = '50'

      const { pool } = await import('@/config/database')

      expect(pool.options.min).toBe(5)
      expect(pool.options.max).toBe(50)

      await pool.end()
    })

    it('should handle invalid pool size values gracefully', async () => {
      process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/testdb'
      process.env.DATABASE_POOL_MIN = 'invalid'
      process.env.DATABASE_POOL_MAX = 'invalid'

      const { pool } = await import('@/config/database')

      // Should use defaults when parseInt returns NaN
      expect(pool.options.min).toBe(2)
      expect(pool.options.max).toBe(20)

      await pool.end()
    })

    it('should configure SSL when DATABASE_SSL is true', async () => {
      process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/testdb'
      process.env.DATABASE_SSL = 'true'

      const { pool } = await import('@/config/database')

      expect(pool.options.ssl).toBeDefined()
      expect(pool.options.ssl).toHaveProperty('rejectUnauthorized', false)

      await pool.end()
    })

    it('should not configure SSL when DATABASE_SSL is false', async () => {
      process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/testdb'
      process.env.DATABASE_SSL = 'false'

      const { pool } = await import('@/config/database')

      expect(pool.options.ssl).toBeUndefined()

      await pool.end()
    })

    it('should not configure SSL when DATABASE_SSL is not set', async () => {
      process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/testdb'
      delete process.env.DATABASE_SSL

      const { pool } = await import('@/config/database')

      expect(pool.options.ssl).toBeUndefined()

      await pool.end()
    })
  })

  describe('Health Check', () => {
    it('should return true when database is healthy', async () => {
      process.env.DATABASE_URL = 'postgresql://localhost:5432/synckairos'

      const { healthCheck, pool } = await import('@/config/database')

      const isHealthy = await healthCheck()

      expect(isHealthy).toBe(true)

      await pool.end()
    })

    it('should return false when database connection fails', async () => {
      process.env.DATABASE_URL = 'postgresql://invalid:invalid@nonexistent:9999/db'

      const { healthCheck, pool } = await import('@/config/database')

      const isHealthy = await healthCheck()

      expect(isHealthy).toBe(false)

      await pool.end()
    })

    it('should return false when query fails', async () => {
      process.env.DATABASE_URL = 'postgresql://localhost:5432/synckairos'

      const { pool } = await import('@/config/database')

      // Mock pool.query to throw error
      const originalQuery = pool.query.bind(pool)
      pool.query = vi.fn().mockRejectedValue(new Error('Query failed'))

      const { healthCheck } = await import('@/config/database')
      const isHealthy = await healthCheck()

      expect(isHealthy).toBe(false)

      // Restore original query
      pool.query = originalQuery
      await pool.end()
    })
  })

  describe('Connection Events', () => {
    it('should log on successful connection', async () => {
      process.env.DATABASE_URL = 'postgresql://localhost:5432/synckairos'

      // Mock logger
      const loggerSpy = vi.fn()

      const { pool } = await import('@/config/database')

      // Create a connection to trigger connect event
      const client = await pool.connect()

      // Wait for event to be processed
      await new Promise(resolve => setTimeout(resolve, 100))

      client.release()
      await pool.end()

      // Note: Actual logging verification depends on logger implementation
      // This test validates the event handler is attached
      expect(pool.listenerCount('connect')).toBeGreaterThan(0)
    })

    it('should log on connection error', async () => {
      process.env.DATABASE_URL = 'postgresql://localhost:5432/synckairos'

      const { pool } = await import('@/config/database')

      // Verify error event handler is attached
      expect(pool.listenerCount('error')).toBeGreaterThan(0)

      await pool.end()
    })
  })

  describe('Pool Lifecycle', () => {
    it('should close pool cleanly', async () => {
      process.env.DATABASE_URL = 'postgresql://localhost:5432/synckairos'

      const { pool, closePool } = await import('@/config/database')

      await closePool()

      // Pool should be ended
      expect(pool.ended).toBe(true)
    })

    it('should handle multiple close calls', async () => {
      process.env.DATABASE_URL = 'postgresql://localhost:5432/synckairos'

      const { pool, closePool } = await import('@/config/database')

      await closePool()
      await expect(closePool()).resolves.not.toThrow()

      expect(pool.ended).toBe(true)
    })
  })

  describe('Environment Variable Parsing', () => {
    it('should handle missing DATABASE_URL', async () => {
      delete process.env.DATABASE_URL

      // Should not throw, pool will use undefined connection string
      await expect(import('@/config/database')).resolves.toBeDefined()
    })

    it('should parse integer values correctly', async () => {
      process.env.DATABASE_URL = 'postgresql://localhost:5432/synckairos'
      process.env.DATABASE_POOL_MIN = '10'
      process.env.DATABASE_POOL_MAX = '100'

      const { pool } = await import('@/config/database')

      expect(pool.options.min).toBe(10)
      expect(pool.options.max).toBe(100)

      await pool.end()
    })

    it('should handle empty string values', async () => {
      process.env.DATABASE_URL = 'postgresql://localhost:5432/synckairos'
      process.env.DATABASE_POOL_MIN = ''
      process.env.DATABASE_POOL_MAX = ''

      const { pool } = await import('@/config/database')

      // Should use defaults when empty string
      expect(pool.options.min).toBe(2)
      expect(pool.options.max).toBe(20)

      await pool.end()
    })
  })

  describe('Connection Timeout', () => {
    it('should have configured connection timeout', async () => {
      process.env.DATABASE_URL = 'postgresql://localhost:5432/synckairos'

      const { pool } = await import('@/config/database')

      expect(pool.options.connectionTimeoutMillis).toBe(5000)

      await pool.end()
    })

    it('should have configured idle timeout', async () => {
      process.env.DATABASE_URL = 'postgresql://localhost:5432/synckairos'

      const { pool } = await import('@/config/database')

      expect(pool.options.idleTimeoutMillis).toBe(30000)

      await pool.end()
    })
  })
})
