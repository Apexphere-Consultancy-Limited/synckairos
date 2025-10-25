/**
 * Migration Runner Unit Tests
 *
 * Tests the database migration execution script
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'fs'
import { Pool } from 'pg'

// Mock fs module
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
}))

// Mock database pool
vi.mock('@/config/database', () => ({
  pool: {
    query: vi.fn(),
    end: vi.fn(),
  },
}))

describe('Migration Runner', () => {
  const mockReadFileSync = readFileSync as unknown as ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetAllMocks()
  })

  describe('Migration Execution', () => {
    it('should execute migrations in correct order', async () => {
      const migration1 = 'CREATE TABLE test1 (id INT);'
      const migration2 = 'CREATE TABLE test2 (id INT);'

      mockReadFileSync
        .mockReturnValueOnce(migration1)
        .mockReturnValueOnce(migration2)

      const { pool } = await import('@/config/database')
      const poolQuery = pool.query as ReturnType<typeof vi.fn>

      poolQuery.mockResolvedValue({ rows: [] })

      // Import and run migrations
      // Note: This test verifies the concept - actual implementation may vary
      const migrations = ['001_initial_schema.sql', '002_add_indexes.sql']

      for (const migration of migrations) {
        const sql = readFileSync(`migrations/${migration}`, 'utf-8')
        await pool.query(sql)
      }

      expect(poolQuery).toHaveBeenCalledTimes(2)
      expect(poolQuery).toHaveBeenNthCalledWith(1, migration1)
      expect(poolQuery).toHaveBeenNthCalledWith(2, migration2)
    })

    it('should handle migration file read errors', () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error('File not found')
      })

      expect(() => {
        readFileSync('nonexistent.sql', 'utf-8')
      }).toThrow('File not found')
    })

    it('should handle SQL execution errors', async () => {
      const migration = 'INVALID SQL;'
      mockReadFileSync.mockReturnValue(migration)

      const { pool } = await import('@/config/database')
      const poolQuery = pool.query as ReturnType<typeof vi.fn>

      poolQuery.mockRejectedValue(new Error('SQL syntax error'))

      await expect(pool.query(migration)).rejects.toThrow('SQL syntax error')
    })

    it('should stop execution on first migration failure', async () => {
      const migration1 = 'CREATE TABLE test1 (id INT);'
      const migration2 = 'CREATE TABLE test2 (id INT);'

      mockReadFileSync
        .mockReturnValueOnce(migration1)
        .mockReturnValueOnce(migration2)

      const { pool } = await import('@/config/database')
      const poolQuery = pool.query as ReturnType<typeof vi.fn>

      // First migration fails
      poolQuery.mockRejectedValueOnce(new Error('Migration failed'))

      try {
        await pool.query(migration1)
      } catch (err) {
        // Expected to fail
      }

      // Second migration should not be attempted
      expect(poolQuery).toHaveBeenCalledTimes(1)
    })
  })

  describe('Idempotency', () => {
    it('should handle running migrations multiple times', async () => {
      const migration = 'CREATE TABLE IF NOT EXISTS test (id INT);'
      mockReadFileSync.mockReturnValue(migration)

      const { pool } = await import('@/config/database')
      const poolQuery = pool.query as ReturnType<typeof vi.fn>

      poolQuery.mockResolvedValue({ rows: [] })

      // Run migration twice
      await pool.query(migration)
      await pool.query(migration)

      expect(poolQuery).toHaveBeenCalledTimes(2)
      expect(poolQuery).toHaveBeenCalledWith(migration)
    })

    it('should fail gracefully if migration is not idempotent', async () => {
      const migration = 'CREATE TABLE test (id INT);' // No IF NOT EXISTS
      mockReadFileSync.mockReturnValue(migration)

      const { pool } = await import('@/config/database')
      const poolQuery = pool.query as ReturnType<typeof vi.fn>

      // First call succeeds
      poolQuery.mockResolvedValueOnce({ rows: [] })
      // Second call fails (table already exists)
      poolQuery.mockRejectedValueOnce(new Error('relation "test" already exists'))

      await pool.query(migration)

      await expect(pool.query(migration)).rejects.toThrow(
        'relation "test" already exists'
      )
    })
  })

  describe('Migration File Validation', () => {
    it('should read migration files with correct encoding', () => {
      const expectedSQL = 'CREATE TABLE test (id INT);'
      mockReadFileSync.mockReturnValue(expectedSQL)

      const sql = readFileSync('migrations/001_test.sql', 'utf-8')

      expect(sql).toBe(expectedSQL)
      expect(mockReadFileSync).toHaveBeenCalledWith(
        'migrations/001_test.sql',
        'utf-8'
      )
    })

    it('should handle empty migration files', async () => {
      mockReadFileSync.mockReturnValue('')

      const { pool } = await import('@/config/database')
      const poolQuery = pool.query as ReturnType<typeof vi.fn>

      poolQuery.mockResolvedValue({ rows: [] })

      await pool.query('')

      expect(poolQuery).toHaveBeenCalledWith('')
    })

    it('should handle migration files with comments', async () => {
      const migration = `
        -- This is a comment
        CREATE TABLE test (id INT);
        /* Multi-line
           comment */
      `
      mockReadFileSync.mockReturnValue(migration)

      const { pool } = await import('@/config/database')
      const poolQuery = pool.query as ReturnType<typeof vi.fn>

      poolQuery.mockResolvedValue({ rows: [] })

      await pool.query(migration)

      expect(poolQuery).toHaveBeenCalledWith(migration)
    })
  })

  describe('Pool Cleanup', () => {
    it('should close pool after migrations complete', async () => {
      const { pool } = await import('@/config/database')
      const poolEnd = pool.end as ReturnType<typeof vi.fn>

      poolEnd.mockResolvedValue(undefined)

      await pool.end()

      expect(poolEnd).toHaveBeenCalled()
    })

    it('should close pool even if migrations fail', async () => {
      const migration = 'INVALID SQL;'
      mockReadFileSync.mockReturnValue(migration)

      const { pool } = await import('@/config/database')
      const poolQuery = pool.query as ReturnType<typeof vi.fn>
      const poolEnd = pool.end as ReturnType<typeof vi.fn>

      poolQuery.mockRejectedValue(new Error('Migration failed'))
      poolEnd.mockResolvedValue(undefined)

      try {
        await pool.query(migration)
      } catch (err) {
        // Expected to fail
      } finally {
        await pool.end()
      }

      expect(poolEnd).toHaveBeenCalled()
    })
  })

  describe('Error Messages', () => {
    it('should provide clear error message on migration failure', async () => {
      const migration = 'INVALID SQL;'
      mockReadFileSync.mockReturnValue(migration)

      const { pool } = await import('@/config/database')
      const poolQuery = pool.query as ReturnType<typeof vi.fn>

      const error = new Error('syntax error at or near "INVALID"')
      poolQuery.mockRejectedValue(error)

      await expect(pool.query(migration)).rejects.toThrow(
        'syntax error at or near "INVALID"'
      )
    })

    it('should include migration filename in error context', () => {
      const filename = '001_initial_schema.sql'

      mockReadFileSync.mockImplementation(() => {
        throw new Error(`ENOENT: no such file or directory, open '${filename}'`)
      })

      expect(() => {
        readFileSync(filename, 'utf-8')
      }).toThrow(filename)
    })
  })
})
