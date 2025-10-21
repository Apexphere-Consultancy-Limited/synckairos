/**
 * PostgreSQL Database Connection Configuration
 *
 * IMPORTANT: PostgreSQL is used for AUDIT TRAIL ONLY
 * Redis is the PRIMARY source of truth for session state
 */

import { Pool, PoolConfig } from 'pg'
import { config } from 'dotenv'
import { createComponentLogger } from '@/utils/logger'

config()

const logger = createComponentLogger('DatabaseConfig')

const poolConfig: PoolConfig = {
  connectionString: process.env.DATABASE_URL,
  min: parseInt(process.env.DATABASE_POOL_MIN || '2', 10),
  max: parseInt(process.env.DATABASE_POOL_MAX || '20', 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
}

// Add SSL for production
if (process.env.DATABASE_SSL === 'true') {
  poolConfig.ssl = {
    rejectUnauthorized: false, // For most cloud providers
  }
}

export const pool = new Pool(poolConfig)

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected error on idle PostgreSQL client')
})

pool.on('connect', () => {
  logger.info({
    min: poolConfig.min,
    max: poolConfig.max,
    ssl: !!poolConfig.ssl
  }, 'PostgreSQL client connected')
})

export const healthCheck = async (): Promise<boolean> => {
  try {
    const result = await pool.query('SELECT 1')
    return result.rows.length === 1
  } catch (err) {
    logger.error({ err }, 'PostgreSQL health check failed')
    return false
  }
}

export const closePool = async (): Promise<void> => {
  await pool.end()
  logger.info('PostgreSQL pool closed')
}
