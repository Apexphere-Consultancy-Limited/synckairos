// SyncKairos v2.0 - Main Entry Point
// Redis-first distributed synchronization service

// Load environment variables first (from .env and .env.local)
import '@/config/env'

import http from 'http'
import { createRedisClient, createRedisPubSubClient } from '@/config/redis'
import { RedisStateManager } from '@/state/RedisStateManager'
import { DBWriteQueue } from '@/state/DBWriteQueue'
import { SyncEngine } from '@/engine/SyncEngine'
import { createApp } from '@/api/app'
import { WebSocketServer } from '@/websocket/WebSocketServer'
import { logger } from '@/utils/logger'
import { pool } from '@/config/database'
import type Redis from 'ioredis'

// Global references for cleanup
let server: http.Server | null = null
let wsServer: WebSocketServer | null = null
let redis: Redis | null = null
let pubSub: Redis | null = null
let dbQueue: DBWriteQueue | null = null

async function main() {
  logger.info('SyncKairos v2.0 initializing...')

  try {
    // 1. Create Redis connections
    logger.info('Connecting to Redis...')
    redis = createRedisClient()
    pubSub = createRedisPubSubClient()

    // Test Redis connection
    await redis.ping()
    logger.info('Redis connected')

    // 2. Create DBWriteQueue
    logger.info('Initializing DBWriteQueue...')
    dbQueue = new DBWriteQueue(process.env.REDIS_URL!)
    logger.info('DBWriteQueue initialized')

    // 3. Create RedisStateManager
    logger.info('Creating RedisStateManager...')
    const stateManager = new RedisStateManager(redis, pubSub, dbQueue)
    logger.info('RedisStateManager created')

    // 4. Create SyncEngine
    logger.info('Creating SyncEngine...')
    const syncEngine = new SyncEngine(stateManager)
    logger.info('SyncEngine created')

    // 5. Create Express app
    logger.info('Creating Express app...')
    const app = createApp({ syncEngine })
    logger.info('Express app created')

    // 6. Create HTTP server (for WebSocket upgrade)
    logger.info('Creating HTTP server...')
    server = http.createServer(app)

    // 7. Create WebSocket server
    logger.info('Creating WebSocket server...')
    wsServer = new WebSocketServer(server, stateManager)
    logger.info('WebSocket server created')

    // 8. Start server
    const port = parseInt(process.env.PORT || '3000', 10)
    await new Promise<void>((resolve) => {
      server!.listen(port, '0.0.0.0', () => {
        logger.info({ port }, 'Server started successfully (HTTP + WebSocket)')
        logger.info(`SyncKairos v2.0 ready at http://0.0.0.0:${port}`)
        logger.info(`WebSocket endpoint: ws://0.0.0.0:${port}/ws`)
        resolve()
      })
    })

    // 9. Setup graceful shutdown
    setupGracefulShutdown()
  } catch (err) {
    logger.fatal({ err }, 'Fatal error during startup')
    process.exit(1)
  }
}

/**
 * Graceful shutdown handler
 *
 * Ensures all connections are closed properly:
 * 1. Stop accepting new HTTP requests
 * 2. Close WebSocket connections
 * 3. Close Redis connections
 * 4. Close DBWriteQueue
 * 5. Close PostgreSQL pool
 *
 * Timeout: 15 seconds max
 */
function setupGracefulShutdown() {
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received, starting graceful shutdown')

    // 1. Stop accepting new requests
    if (server) {
      server.close(() => {
        logger.info('HTTP server closed')
      })
    }

    // 2. Close WebSocket connections
    try {
      if (wsServer) {
        await wsServer.close()
        logger.info('WebSocket server closed')
      }
    } catch (err) {
      logger.error({ err }, 'Error closing WebSocket server')
    }

    // 3. Close Redis connections
    try {
      if (redis) {
        await redis.quit()
        logger.info('Redis connection closed')
      }
      if (pubSub) {
        await pubSub.quit()
        logger.info('Redis Pub/Sub connection closed')
      }
    } catch (err) {
      logger.error({ err }, 'Error closing Redis connections')
    }

    // 4. Close DBWriteQueue
    try {
      if (dbQueue) {
        await dbQueue.close()
        logger.info('DBWriteQueue closed')
      }
    } catch (err) {
      logger.error({ err }, 'Error closing DBWriteQueue')
    }

    // 5. Close PostgreSQL pool
    try {
      await pool.end()
      logger.info('PostgreSQL pool closed')
    } catch (err) {
      logger.error({ err }, 'Error closing PostgreSQL pool')
    }

    logger.info('Graceful shutdown complete')
    process.exit(0)
  }

  // Shutdown with timeout fallback (15 seconds)
  const shutdownWithTimeout = (signal: string) => {
    shutdown(signal)

    // Force exit after 15 seconds if graceful shutdown hangs
    setTimeout(() => {
      logger.error('Graceful shutdown timeout (15s), forcing exit')
      process.exit(1)
    }, 15000)
  }

  // Handle shutdown signals
  process.on('SIGTERM', () => shutdownWithTimeout('SIGTERM'))
  process.on('SIGINT', () => shutdownWithTimeout('SIGINT'))

  logger.info('Graceful shutdown handlers registered')
}

// Start the application
main().catch((err) => {
  logger.fatal({ err }, 'Unhandled error in main')
  process.exit(1)
})
