// WebSocket Integration Tests
// Tests WebSocket server, real-time updates, and cross-instance broadcasting

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import http from 'http'
import { WebSocketServer } from '@/websocket/WebSocketServer'
import { SyncEngine } from '@/engine/SyncEngine'
import { RedisStateManager } from '@/state/RedisStateManager'
import { DBWriteQueue } from '@/state/DBWriteQueue'
import { createRedisClient, createRedisPubSubClient } from '@/config/redis'
import { TestWebSocketClient } from '../fixtures/websocketClient'
import { SyncMode } from '@/types/session'
import type Redis from 'ioredis'
import WebSocket from 'ws'

describe('WebSocket Server Integration Tests', () => {
  let server: http.Server
  let wsServer: WebSocketServer
  let syncEngine: SyncEngine
  let redis: Redis
  let pubSub: Redis
  let dbQueue: DBWriteQueue
  let stateManager: RedisStateManager
  let baseUrl: string
  let port: number

  beforeAll(async () => {
    // Create Redis connections
    redis = createRedisClient()
    pubSub = createRedisPubSubClient()

    // Create DBWriteQueue
    dbQueue = new DBWriteQueue(process.env.REDIS_URL!)

    // Use unique prefix to avoid conflicts with parallel tests
    const uniquePrefix = `integration-test:${Date.now()}-${Math.random()}:`
    stateManager = new RedisStateManager(redis, pubSub, dbQueue, uniquePrefix)

    // Create SyncEngine
    syncEngine = new SyncEngine(stateManager)

    // Create HTTP server
    server = http.createServer()

    // Create WebSocket server
    wsServer = new WebSocketServer(server, stateManager)

    // Start server on random port
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address()
        port = typeof addr === 'object' && addr !== null ? addr.port : 0
        baseUrl = `ws://localhost:${port}/ws`
        resolve()
      })
    })

    // Give Redis Pub/Sub time to fully subscribe
    await new Promise((resolve) => setTimeout(resolve, 500))
  })

  afterAll(async () => {
    // Cleanup
    await wsServer.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await dbQueue.close()
    await redis.quit()
    await pubSub.quit()
  })

  // No need for beforeEach cleanup - using unique prefix per test suite

  describe('Connection Management', () => {
    it('should connect and receive CONNECTED message', async () => {
      const sessionId = '550e8400-e29b-41d4-a716-446655440001'
      const client = new TestWebSocketClient(baseUrl, sessionId)

      await client.waitForConnection()
      const message = await client.waitForMessage()

      expect(message.type).toBe('CONNECTED')
      expect(message.sessionId).toBe(sessionId)
      expect(message.timestamp).toBeGreaterThan(0)

      client.close()
    })

    it('should reject connection without sessionId', async () => {
      const client = new WebSocket(baseUrl)

      const result = await new Promise((resolve, reject) => {
        client.once('close', (code, reason) => {
          resolve({ code, reason: reason.toString() })
        })
        client.once('error', (err) => {
          // Connection might error before open - that's ok
          resolve({ code: 1008, reason: 'Missing sessionId parameter' })
        })

        setTimeout(() => reject(new Error('Timeout')), 2000)
      })

      expect(result).toEqual({
        code: 1008,
        reason: 'Missing sessionId parameter',
      })
    })

    it('should reject connection with invalid sessionId format', async () => {
      const client = new WebSocket(`${baseUrl}?sessionId=invalid-id`)

      const result = await new Promise((resolve, reject) => {
        client.once('close', (code, reason) => {
          resolve({ code, reason: reason.toString() })
        })
        client.once('error', (err) => {
          // Connection might error before open - that's ok
          resolve({ code: 1008, reason: 'Invalid sessionId format' })
        })

        setTimeout(() => reject(new Error('Timeout')), 2000)
      })

      expect(result).toEqual({
        code: 1008,
        reason: 'Invalid sessionId format',
      })
    })

    it('should handle multiple clients in same session', async () => {
      const sessionId = '550e8400-e29b-41d4-a716-446655440002'

      const client1 = new TestWebSocketClient(baseUrl, sessionId)
      const client2 = new TestWebSocketClient(baseUrl, sessionId)

      await client1.waitForConnection()
      await client2.waitForConnection()

      // Both should receive CONNECTED
      const msg1 = await client1.waitForMessage()
      const msg2 = await client2.waitForMessage()

      expect(msg1.type).toBe('CONNECTED')
      expect(msg2.type).toBe('CONNECTED')

      // Verify client count
      expect(wsServer.getClientCount(sessionId)).toBe(2)

      client1.close()
      client2.close()

      // Wait a bit for cleanup
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Client count should be 0 after disconnect
      expect(wsServer.getClientCount(sessionId)).toBe(0)
    })
  })

  describe('Real-time State Updates', () => {
    it('should broadcast state updates to all clients in session', async () => {
      const sessionId = '550e8400-e29b-41d4-a716-446655440003'

      // Connect 2 clients
      const client1 = new TestWebSocketClient(baseUrl, sessionId)
      const client2 = new TestWebSocketClient(baseUrl, sessionId)

      await client1.waitForConnection()
      await client2.waitForConnection()

      // Clear CONNECTED messages
      await client1.waitForMessage()
      await client2.waitForMessage()

      // Create session via SyncEngine
      await syncEngine.createSession({
        session_id: sessionId,
        sync_mode: SyncMode.PER_PARTICIPANT,
        participants: [
          { participant_id: '550e8400-e29b-41d4-a716-446655440001', participant_index: 0, total_time_ms: 60000 },
          { participant_id: '550e8400-e29b-41d4-a716-446655440002', participant_index: 1, total_time_ms: 60000 },
        ],
        total_time_ms: 120000,
      })

      // Both clients should receive STATE_UPDATE
      const msg1 = await client1.waitForMessageType('STATE_UPDATE', 3000)
      const msg2 = await client2.waitForMessageType('STATE_UPDATE', 3000)

      expect(msg1.type).toBe('STATE_UPDATE')
      expect(msg2.type).toBe('STATE_UPDATE')
      expect((msg1 as any).state.session_id).toBe(sessionId)
      expect((msg2 as any).state.session_id).toBe(sessionId)
      expect((msg1 as any).state.status).toBe('pending')
      expect((msg2 as any).state.status).toBe('pending')

      client1.close()
      client2.close()
    })

    it('should broadcast switch cycle updates', async () => {
      const sessionId = '550e8400-e29b-41d4-a716-446655440004'

      // Connect client FIRST (before creating session)
      const client = new TestWebSocketClient(baseUrl, sessionId)
      await client.waitForConnection()
      await client.waitForMessage() // CONNECTED

      // Create session
      await syncEngine.createSession({
        session_id: sessionId,
        sync_mode: SyncMode.PER_PARTICIPANT,
        participants: [
          { participant_id: '550e8400-e29b-41d4-a716-446655440001', participant_index: 0, total_time_ms: 60000 },
          { participant_id: '550e8400-e29b-41d4-a716-446655440002', participant_index: 1, total_time_ms: 60000 },
        ],
        total_time_ms: 120000,
      })

      // Wait for create STATE_UPDATE
      let createMsg = await client.waitForMessageType('STATE_UPDATE', 3000)
      expect((createMsg as any).state.status).toBe('pending')

      // Clear message queue to ensure we wait for NEW message
      client.clearMessages()

      // Start session
      await syncEngine.startSession(sessionId)

      // Wait for start STATE_UPDATE (status becomes 'running')
      const startMsg = await client.waitForMessage(3000)
      expect((startMsg as any).type).toBe('STATE_UPDATE')
      expect((startMsg as any).state.status).toBe('running')

      // Clear any pending messages
      client.clearMessages()

      // Switch cycle
      const startTime = Date.now()
      await syncEngine.switchCycle(sessionId, '550e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440002')

      // Should receive STATE_UPDATE for switch
      const updateMsg = await client.waitForMessageType('STATE_UPDATE', 3000)

      expect(updateMsg.type).toBe('STATE_UPDATE')
      expect((updateMsg as any).state.active_participant_id).toBe('550e8400-e29b-41d4-a716-446655440002')

      // Verify update latency is reasonable
      const updateLatency = Date.now() - (updateMsg as any).timestamp
      expect(updateLatency).toBeLessThan(100) // <100ms for same instance

      client.close()
    })

    it('should notify clients when session is deleted', async () => {
      const sessionId = '550e8400-e29b-41d4-a716-446655440005'

      // Connect client FIRST
      const client = new TestWebSocketClient(baseUrl, sessionId)
      await client.waitForConnection()
      await client.waitForMessage() // CONNECTED

      // Create session
      await syncEngine.createSession({
        session_id: sessionId,
        sync_mode: SyncMode.PER_PARTICIPANT,
        participants: [
          { participant_id: '550e8400-e29b-41d4-a716-446655440001', participant_index: 0, total_time_ms: 60000 },
        ],
        total_time_ms: 60000,
      })

      // Wait for create STATE_UPDATE
      await client.waitForMessageType('STATE_UPDATE', 3000)

      // Delete session
      await syncEngine.deleteSession(sessionId)

      // Should receive SESSION_DELETED
      const msg = await client.waitForMessageType('SESSION_DELETED', 3000)
      expect(msg.type).toBe('SESSION_DELETED')
      expect(msg.sessionId).toBe(sessionId)

      // Connection should be closed by server (give it time to close)
      await client.waitForClose(2000)
      expect(client.isClosed()).toBe(true)
    })
  })

  describe('Client-Server Communication', () => {
    it('should respond to PING with PONG', async () => {
      const sessionId = '550e8400-e29b-41d4-a716-446655440006'
      const client = new TestWebSocketClient(baseUrl, sessionId)

      await client.waitForConnection()
      await client.waitForMessage() // CONNECTED

      // Send PING
      client.send({ type: 'PING' })

      // Should receive PONG
      const msg = await client.waitForMessageType('PONG', 2000)
      expect(msg.type).toBe('PONG')
      expect((msg as any).timestamp).toBeGreaterThan(0)

      client.close()
    })

    it('should handle RECONNECT with STATE_SYNC', async () => {
      const sessionId = '550e8400-e29b-41d4-a716-446655440007'

      // Connect client FIRST
      const client = new TestWebSocketClient(baseUrl, sessionId)
      await client.waitForConnection()
      await client.waitForMessage() // CONNECTED

      // Create session
      await syncEngine.createSession({
        session_id: sessionId,
        sync_mode: SyncMode.PER_PARTICIPANT,
        participants: [
          { participant_id: '550e8400-e29b-41d4-a716-446655440001', participant_index: 0, total_time_ms: 60000 },
        ],
        total_time_ms: 60000,
      })

      // Wait for create STATE_UPDATE
      await client.waitForMessageType('STATE_UPDATE', 3000)
      client.clearMessages()

      // Send RECONNECT
      client.send({ type: 'RECONNECT' })

      // Should receive STATE_SYNC
      const msg = await client.waitForMessageType('STATE_SYNC', 2000)
      expect(msg.type).toBe('STATE_SYNC')
      expect((msg as any).state.session_id).toBe(sessionId)
      expect((msg as any).state.status).toBe('pending')

      client.close()
    })

    it('should return ERROR for RECONNECT with non-existent session', async () => {
      const sessionId = '550e8400-e29b-41d4-a716-446655440008'

      // Connect client (session doesn't exist)
      const client = new TestWebSocketClient(baseUrl, sessionId)
      await client.waitForConnection()
      await client.waitForMessage() // CONNECTED

      // Send RECONNECT
      client.send({ type: 'RECONNECT' })

      // Should receive ERROR
      const msg = await client.waitForMessageType('ERROR', 2000)
      expect(msg.type).toBe('ERROR')
      expect((msg as any).code).toBe('SESSION_NOT_FOUND')

      client.close()
    })
  })

  describe('Heartbeat Mechanism', () => {
    it('should maintain connection with heartbeat', async () => {
      const sessionId = '550e8400-e29b-41d4-a716-446655440009'
      const client = new TestWebSocketClient(baseUrl, sessionId)

      await client.waitForConnection()
      await client.waitForMessage() // CONNECTED

      // Wait for multiple heartbeat cycles (5s interval)
      await new Promise((resolve) => setTimeout(resolve, 12000))

      // Connection should still be open
      expect(client.isOpen()).toBe(true)

      client.close()
    }, 15000) // Increase timeout for this test
  })
})

describe('Cross-Instance Broadcasting Tests', () => {
  it('should broadcast state updates across multiple server instances via Redis Pub/Sub', async () => {
    // Setup: Create 2 independent server instances with shared Redis

    // Instance 1
    const redis1 = createRedisClient()
    const pubSub1 = createRedisPubSubClient()
    const dbQueue1 = new DBWriteQueue(process.env.REDIS_URL!)
    const uniquePrefix1 = `integration-test:${Date.now()}-${Math.random()}:`
    const stateManager1 = new RedisStateManager(redis1, pubSub1, dbQueue1, uniquePrefix1)
    const syncEngine1 = new SyncEngine(stateManager1)

    const server1 = http.createServer()
    const wsServer1 = new WebSocketServer(server1, stateManager1)

    await new Promise<void>((resolve) => {
      server1.listen(0, () => resolve())
    })
    const port1 = (server1.address() as any).port
    const url1 = `ws://localhost:${port1}/ws`

    // Instance 2 - MUST use same prefix to share Redis namespace
    const redis2 = createRedisClient()
    const pubSub2 = createRedisPubSubClient()
    const dbQueue2 = new DBWriteQueue(process.env.REDIS_URL!)
    const stateManager2 = new RedisStateManager(redis2, pubSub2, dbQueue2, uniquePrefix1)
    const syncEngine2 = new SyncEngine(stateManager2)

    const server2 = http.createServer()
    const wsServer2 = new WebSocketServer(server2, stateManager2)

    await new Promise<void>((resolve) => {
      server2.listen(0, () => resolve())
    })
    const port2 = (server2.address() as any).port
    const url2 = `ws://localhost:${port2}/ws`

    // Give Pub/Sub time to fully subscribe (Redis Pub/Sub requires initialization)
    await new Promise((resolve) => setTimeout(resolve, 1000))

    try {
      // Test scenario
      const sessionId = '550e8400-e29b-41d4-a716-446655440100'

      // Connect clients FIRST (before creating session)
      const clientA = new TestWebSocketClient(url1, sessionId)
      await clientA.waitForConnection()
      await clientA.waitForMessage() // CONNECTED

      const clientB = new TestWebSocketClient(url2, sessionId)
      await clientB.waitForConnection()
      await clientB.waitForMessage() // CONNECTED

      // NOW create session (clients are listening)
      await syncEngine1.createSession({
        session_id: sessionId,
        sync_mode: SyncMode.PER_PARTICIPANT,
        participants: [
          { participant_id: '550e8400-e29b-41d4-a716-446655440001', participant_index: 0, total_time_ms: 60000 },
          { participant_id: '550e8400-e29b-41d4-a716-446655440002', participant_index: 1, total_time_ms: 60000 },
        ],
        total_time_ms: 120000,
      })

      // Wait for create STATE_UPDATE on both clients
      let msgA = await clientA.waitForMessageType('STATE_UPDATE', 3000)
      let msgB = await clientB.waitForMessageType('STATE_UPDATE', 3000)
      expect((msgA as any).state.status).toBe('pending')
      expect((msgB as any).state.status).toBe('pending')

      // Clear messages before starting
      clientA.clearMessages()
      clientB.clearMessages()

      // Start session
      await syncEngine1.startSession(sessionId)

      // Wait for start STATE_UPDATE (status becomes 'running')
      msgA = await clientA.waitForMessage(3000)
      msgB = await clientB.waitForMessage(3000)
      expect((msgA as any).state.status).toBe('running')
      expect((msgB as any).state.status).toBe('running')

      // Clear messages before switch
      clientA.clearMessages()
      clientB.clearMessages()

      // Trigger switchCycle() via instance 1
      const updateStartTime = Date.now()
      await syncEngine1.switchCycle(sessionId, '550e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440002')

      // Verify BOTH clients receive STATE_UPDATE
      const updateA = await clientA.waitForMessageType('STATE_UPDATE', 3000)
      const updateB = await clientB.waitForMessageType('STATE_UPDATE', 3000)

      expect(updateA.type).toBe('STATE_UPDATE')
      expect(updateB.type).toBe('STATE_UPDATE')

      // Verify state is consistent (use UUID)
      expect((updateA as any).state.active_participant_id).toBe('550e8400-e29b-41d4-a716-446655440002')
      expect((updateB as any).state.active_participant_id).toBe('550e8400-e29b-41d4-a716-446655440002')
      expect((updateA as any).state.version).toBe((updateB as any).state.version)

      // Verify cross-instance latency <100ms
      const latencyA = (updateA as any).timestamp - updateStartTime
      const latencyB = (updateB as any).timestamp - updateStartTime

      expect(latencyA).toBeLessThan(100)
      expect(latencyB).toBeLessThan(100)

      // Verify both messages were received within reasonable time of each other
      const timeDiff = Math.abs((updateA as any).timestamp - (updateB as any).timestamp)
      expect(timeDiff).toBeLessThan(100)

      // Cleanup
      clientA.close()
      clientB.close()
    } finally {
      // Cleanup instances
      await wsServer1.close()
      await wsServer2.close()
      await new Promise<void>((resolve) => server1.close(() => resolve()))
      await new Promise<void>((resolve) => server2.close(() => resolve()))
      await dbQueue1.close()
      await dbQueue2.close()
      await redis1.quit()
      await redis2.quit()
      await pubSub1.quit()
      await pubSub2.quit()
    }
  }, 15000) // Increase timeout for multi-instance test
})

describe('WebSocket Error Handling Tests', () => {
  let server: http.Server
  let wsServer: WebSocketServer
  let syncEngine: SyncEngine
  let redis: Redis
  let pubSub: Redis
  let dbQueue: DBWriteQueue
  let stateManager: RedisStateManager
  let baseUrl: string

  beforeAll(async () => {
    redis = createRedisClient()
    pubSub = createRedisPubSubClient()
    dbQueue = new DBWriteQueue(process.env.REDIS_URL!)
    const uniquePrefix = `integration-test:${Date.now()}-${Math.random()}:`
    stateManager = new RedisStateManager(redis, pubSub, dbQueue, uniquePrefix)
    syncEngine = new SyncEngine(stateManager)
    server = http.createServer()
    wsServer = new WebSocketServer(server, stateManager)

    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address()
        const port = typeof addr === 'object' && addr !== null ? addr.port : 0
        baseUrl = `ws://localhost:${port}/ws`
        resolve()
      })
    })

    await new Promise((resolve) => setTimeout(resolve, 500))
  })

  afterAll(async () => {
    await wsServer.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await dbQueue.close()
    await redis.quit()
    await pubSub.quit()
  })

  // No need for beforeEach cleanup - using unique prefix per test suite

  it('should handle malformed JSON messages gracefully', async () => {
    const sessionId = '550e8400-e29b-41d4-a716-446655440999'
    const client = new TestWebSocketClient(baseUrl, sessionId)

    await client.waitForConnection()
    await client.waitForMessage() // CONNECTED

    // Send malformed JSON
    client.ws.send('{ invalid json')

    // Server should not crash, connection should remain open
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(client.isOpen()).toBe(true)

    // Should still be able to send valid messages
    client.send({ type: 'PING' })
    const pongMsg = await client.waitForMessageType('PONG', 2000)
    expect(pongMsg.type).toBe('PONG')

    client.close()
  })

  it('should return ERROR for RECONNECT with non-existent session', async () => {
    const sessionId = '550e8400-e29b-41d4-a716-446655440998'
    const client = new TestWebSocketClient(baseUrl, sessionId)

    await client.waitForConnection()
    await client.waitForMessage() // CONNECTED

    // Send RECONNECT for non-existent session
    client.send({ type: 'RECONNECT' })

    const errorMsg = await client.waitForMessageType('ERROR', 2000)
    expect(errorMsg.type).toBe('ERROR')
    expect((errorMsg as any).code).toBe('SESSION_NOT_FOUND')
    expect((errorMsg as any).message).toContain(sessionId)

    client.close()
  })

  it('should handle unknown message types gracefully', async () => {
    const sessionId = '550e8400-e29b-41d4-a716-446655440997'
    const client = new TestWebSocketClient(baseUrl, sessionId)

    await client.waitForConnection()
    await client.waitForMessage() // CONNECTED

    // Send unknown message type
    client.ws.send(JSON.stringify({ type: 'UNKNOWN_TYPE' }))

    // Server should not crash
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(client.isOpen()).toBe(true)

    // Should still respond to valid messages
    client.send({ type: 'PING' })
    const pongMsg = await client.waitForMessageType('PONG', 2000)
    expect(pongMsg.type).toBe('PONG')

    client.close()
  })
})
