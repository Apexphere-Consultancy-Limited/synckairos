// Redis connection configuration
// Redis is PRIMARY state store - everything goes through Redis

import Redis from 'ioredis'
import { config } from 'dotenv'
import { createComponentLogger } from '@/utils/logger'

config()

const logger = createComponentLogger('RedisConfig')

export const createRedisClient = (): Redis => {
  const client = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: 3,
    retryStrategy: (times: number) => {
      if (times > 3) {
        return null // Stop retrying
      }
      return Math.min(times * 100, 3000) // Exponential backoff: 100ms, 200ms, 300ms
    },
    reconnectOnError: err => {
      const targetErrors = ['READONLY', 'ECONNRESET']
      return targetErrors.some(targetError => err.message.includes(targetError))
    },
  })

  client.on('connect', () => {
    logger.info(
      { url: process.env.REDIS_URL || 'redis://localhost:6379' },
      'Redis client connected'
    )
  })

  client.on('error', err => {
    logger.error({ err }, 'Redis client error')
  })

  return client
}

// Create separate Pub/Sub client (required by Redis)
export const createRedisPubSubClient = (): Redis => {
  return createRedisClient()
}
