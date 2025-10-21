// Redis Config Error Handler Tests
// Testing connection failures, retry logic, and error event handlers

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRedisClient, createRedisPubSubClient } from '@/config/redis'
import type Redis from 'ioredis'

describe('RedisConfig - Error Handling', () => {
  let client: Redis

  afterEach(async () => {
    if (client) {
      await client.quit()
    }
  })

  describe('createRedisClient', () => {
    it('should create a Redis client with correct configuration', () => {
      client = createRedisClient()

      expect(client).toBeDefined()
      expect(client.options.maxRetriesPerRequest).toBe(3)
    })

    it('should handle connection event', (done) => {
      client = createRedisClient()

      // Listen for connect event
      client.once('connect', () => {
        expect(client.status).toBe('connect')
        done()
      })
    })

    it('should handle error event', async () => {
      client = createRedisClient()

      // Create a promise that resolves when error is handled
      const errorPromise = new Promise<Error>((resolve) => {
        client.once('error', (err) => {
          resolve(err)
        })
      })

      // Simulate an error by emitting it directly
      client.emit('error', new Error('Test error'))

      const err = await errorPromise
      expect(err).toBeDefined()
      expect(err.message).toBe('Test error')
    })

    it('should use exponential backoff retry strategy', () => {
      client = createRedisClient()

      const retryStrategy = client.options.retryStrategy as (times: number) => number | null

      expect(retryStrategy).toBeDefined()

      // Test retry delays
      expect(retryStrategy(1)).toBe(100)   // First retry: 100ms
      expect(retryStrategy(2)).toBe(200)   // Second retry: 200ms
      expect(retryStrategy(3)).toBe(300)   // Third retry: 300ms
      expect(retryStrategy(4)).toBe(null)  // Fourth retry: stop retrying
    })

    it('should reconnect on READONLY error', () => {
      client = createRedisClient()

      const reconnectOnError = client.options.reconnectOnError as (err: Error) => boolean

      expect(reconnectOnError).toBeDefined()

      const readonlyError = new Error('READONLY You can\'t write against a read only replica.')
      expect(reconnectOnError(readonlyError)).toBe(true)
    })

    it('should reconnect on ECONNRESET error', () => {
      client = createRedisClient()

      const reconnectOnError = client.options.reconnectOnError as (err: Error) => boolean

      expect(reconnectOnError).toBeDefined()

      const connResetError = new Error('connect ECONNRESET')
      expect(reconnectOnError(connResetError)).toBe(true)
    })

    it('should not reconnect on other errors', () => {
      client = createRedisClient()

      const reconnectOnError = client.options.reconnectOnError as (err: Error) => boolean

      expect(reconnectOnError).toBeDefined()

      const otherError = new Error('Some other error')
      expect(reconnectOnError(otherError)).toBe(false)
    })
  })

  describe('createRedisPubSubClient', () => {
    it('should create a Pub/Sub client with same configuration as main client', () => {
      client = createRedisPubSubClient()

      expect(client).toBeDefined()
      expect(client.options.maxRetriesPerRequest).toBe(3)
    })

    it('should be independent from main Redis client', async () => {
      const mainClient = createRedisClient()
      const pubSubClient = createRedisPubSubClient()

      expect(mainClient).not.toBe(pubSubClient)

      await mainClient.quit()
      await pubSubClient.quit()
    })
  })

  describe('Connection Failure Scenarios', () => {
    it('should handle connection to invalid host gracefully', (done) => {
      // Set invalid Redis URL
      const originalUrl = process.env.REDIS_URL
      process.env.REDIS_URL = 'redis://invalid-host:6379'

      client = createRedisClient()

      client.once('error', (err) => {
        expect(err).toBeDefined()
        expect(err.message).toContain('ENOTFOUND')

        // Restore original URL
        process.env.REDIS_URL = originalUrl
        done()
      })
    }, 10000)

    it('should stop retrying after max retries', () => {
      client = createRedisClient()

      const retryStrategy = client.options.retryStrategy as (times: number) => number | null

      // Simulate 4 retry attempts
      expect(retryStrategy(4)).toBe(null)
      expect(retryStrategy(5)).toBe(null)
      expect(retryStrategy(10)).toBe(null)
    })
  })
})
