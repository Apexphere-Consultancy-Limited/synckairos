# Task 2.4: WebSocket Server Implementation

**Phase:** 2 - Business Logic & API
**Component:** WebSocket Server (Real-time Updates)
**Priority:** ⭐ **CRITICAL PATH**
**Estimated Time:** 2 days
**Status:** 🔴 Not Started
**Dependencies:** Task 2.1 (SyncEngine), Task 1.2 (RedisStateManager)

---

## Objective

Implement WebSocket server for real-time session state updates with cross-instance broadcasting via Redis Pub/Sub. Enable bi-directional communication between server and clients with heartbeat mechanism.

**Key Focus:** Cross-instance broadcasting must work reliably with <100ms latency.

---

## Success Criteria

- [ ] WebSocket connections stable with heartbeat
- [ ] Real-time updates delivered <100ms
- [ ] Cross-instance broadcasting via Redis Pub/Sub validated **[CRITICAL]**
- [ ] Both Pub/Sub channels working (state updates + WebSocket messages)
- [ ] Reconnection logic with state sync
- [ ] Integration tests passing, including multi-instance test

---

## Day 1: WebSocket Setup & Pub/Sub Integration (8 hours)

### Morning: WebSocket Server Setup (4 hours)

#### 1. Install Dependencies (5 min)

```bash
pnpm add ws
pnpm add -D @types/ws
```

#### 2. Create WebSocket Server Class (2 hours)

**File:** `src/websocket/WebSocketServer.ts`

- [ ] Server initialization
  ```typescript
  import { WebSocketServer as WSServer, WebSocket } from 'ws'
  import { Server as HTTPServer } from 'http'
  import { RedisStateManager } from '@/state/RedisStateManager'
  import { SyncState } from '@/types/session'
  import { createComponentLogger } from '@/utils/logger'
  import { URL } from 'url'

  const logger = createComponentLogger('WebSocketServer')

  export class WebSocketServer {
    private wss: WSServer
    private clients: Map<string, Set<WebSocket>> // sessionId -> Set<WebSocket>
    private stateManager: RedisStateManager
    private heartbeatInterval?: NodeJS.Timeout

    constructor(server: HTTPServer, stateManager: RedisStateManager) {
      this.wss = new WSServer({ server, path: '/ws' })
      this.clients = new Map()
      this.stateManager = stateManager

      this.setupConnectionHandler()
      this.setupPubSubListeners()
      this.startHeartbeat()
    }
  }
  ```

#### 3. Implement Connection Handler (1.5 hours)

- [ ] Handle new connections
  ```typescript
  private setupConnectionHandler(): void {
    this.wss.on('connection', (ws: WebSocket, req) => {
      try {
        // Parse sessionId from query params
        const url = new URL(req.url!, `http://${req.headers.host}`)
        const sessionId = url.searchParams.get('sessionId')

        if (!sessionId) {
          ws.close(1008, 'Missing sessionId parameter')
          return
        }

        // Validate sessionId format (UUID)
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        if (!uuidRegex.test(sessionId)) {
          ws.close(1008, 'Invalid sessionId format')
          return
        }

        // Add client to session group
        if (!this.clients.has(sessionId)) {
          this.clients.set(sessionId, new Set())
        }
        this.clients.get(sessionId)!.add(ws)

        // Mark as alive for heartbeat
        ;(ws as any).isAlive = true
        ;(ws as any).sessionId = sessionId

        // Send connection acknowledgment
        this.sendMessage(ws, {
          type: 'CONNECTED',
          sessionId,
          timestamp: Date.now()
        })

        logger.info({ sessionId, clientCount: this.clients.get(sessionId)!.size }, 'Client connected')

        // Setup message handlers
        ws.on('message', (data) => this.handleClientMessage(ws, sessionId, data))
        ws.on('pong', () => {
          ;(ws as any).isAlive = true
        })
        ws.on('close', () => this.handleDisconnection(ws, sessionId))
        ws.on('error', (err) => {
          logger.error({ err, sessionId }, 'WebSocket error')
        })

      } catch (err) {
        logger.error({ err }, 'Connection setup error')
        ws.close(1011, 'Internal server error')
      }
    })
  }
  ```

#### 4. Implement Disconnection Handler (30 min)

- [ ] Clean up on disconnect
  ```typescript
  private handleDisconnection(ws: WebSocket, sessionId: string): void {
    // Remove from session group
    const clients = this.clients.get(sessionId)
    if (clients) {
      clients.delete(ws)

      // Clean up empty groups
      if (clients.size === 0) {
        this.clients.delete(sessionId)
      }

      logger.info({ sessionId, remainingClients: clients.size }, 'Client disconnected')
    }
  }
  ```

### Afternoon: Redis Pub/Sub Integration (4 hours)

#### 5. Setup Pub/Sub Listeners (2 hours)

**CRITICAL:** Subscribe to BOTH Pub/Sub channels

- [ ] Channel 1: State Updates
  ```typescript
  private setupPubSubListeners(): void {
    // 1. Subscribe to state updates
    this.stateManager.subscribeToUpdates((sessionId, state) => {
      if (state === null) {
        // Session deleted
        this.broadcastToSession(sessionId, {
          type: 'SESSION_DELETED',
          sessionId,
          timestamp: Date.now()
        })

        // Close all connections for this session
        const clients = this.clients.get(sessionId)
        if (clients) {
          clients.forEach(ws => {
            ws.close(1000, 'Session deleted')
          })
          this.clients.delete(sessionId)
        }
      } else {
        // State updated
        this.broadcastToSession(sessionId, {
          type: 'STATE_UPDATE',
          sessionId,
          timestamp: Date.now(),
          state
        })
      }
    })

    // 2. Subscribe to WebSocket messages (cross-instance)
    this.stateManager.subscribeToWebSocket((sessionId, message) => {
      this.broadcastToSession(sessionId, message)
    })

    logger.info('Subscribed to Redis Pub/Sub channels')
  }
  ```

#### 6. Implement Broadcasting (1 hour)

- [ ] Broadcast to session clients
  ```typescript
  private broadcastToSession(sessionId: string, message: any): void {
    const clients = this.clients.get(sessionId)
    if (!clients || clients.size === 0) {
      return
    }

    const messageStr = JSON.stringify(message)
    let sentCount = 0

    clients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(messageStr)
          sentCount++
        } catch (err) {
          logger.error({ err, sessionId }, 'Failed to send message to client')
        }
      }
    })

    logger.debug({ sessionId, clients: clients.size, sent: sentCount }, 'Broadcasted message')
  }

  private sendMessage(ws: WebSocket, message: any): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message))
    }
  }
  ```

#### 7. Handle Client Messages (1 hour)

- [ ] Process incoming messages
  ```typescript
  private async handleClientMessage(
    ws: WebSocket,
    sessionId: string,
    data: Buffer | ArrayBuffer | Buffer[]
  ): void {
    try {
      const message = JSON.parse(data.toString())

      switch (message.type) {
        case 'PING':
          this.sendMessage(ws, {
            type: 'PONG',
            timestamp: Date.now()
          })
          break

        case 'RECONNECT':
          // Send full state sync
          const state = await this.stateManager.getSession(sessionId)
          if (state) {
            this.sendMessage(ws, {
              type: 'STATE_SYNC',
              sessionId,
              timestamp: Date.now(),
              state
            })
          } else {
            this.sendMessage(ws, {
              type: 'ERROR',
              code: 'SESSION_NOT_FOUND',
              message: `Session ${sessionId} not found`
            })
          }
          break

        default:
          logger.warn({ type: message.type }, 'Unknown message type')
      }
    } catch (err) {
      logger.error({ err }, 'Failed to handle client message')
    }
  }
  ```

---

## Day 2: Heartbeat & Testing (8 hours)

### Morning: Heartbeat Implementation (2 hours)

#### 8. Implement Heartbeat Mechanism (2 hours)

- [ ] Start heartbeat interval
  ```typescript
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      this.wss.clients.forEach((ws: any) => {
        if (!ws.isAlive) {
          // Client didn't respond to last PING
          logger.warn({ sessionId: ws.sessionId }, 'Client heartbeat timeout')
          return ws.terminate()
        }

        // Mark as dead, will be marked alive on PONG
        ws.isAlive = false
        ws.ping()
      })
    }, 5000) // Every 5 seconds

    logger.info('Heartbeat started (5s interval)')
  }
  ```

- [ ] Cleanup on server close
  ```typescript
  async close(): Promise<void> {
    logger.info('Closing WebSocket server')

    // Stop heartbeat
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
    }

    // Close all connections
    this.wss.clients.forEach(ws => {
      ws.close(1001, 'Server shutting down')
    })

    // Close WSS
    return new Promise((resolve) => {
      this.wss.close(() => {
        logger.info('WebSocket server closed')
        resolve()
      })
    })
  }
  ```

### Afternoon: Testing (6 hours)

#### 9. Create Test Fixtures (30 min)

**File:** `tests/fixtures/websocketClient.ts`

- [ ] Test WebSocket client helper
  ```typescript
  import WebSocket from 'ws'

  export class TestWebSocketClient {
    private ws: WebSocket
    private messages: any[] = []

    constructor(url: string, sessionId: string) {
      this.ws = new WebSocket(`${url}?sessionId=${sessionId}`)

      this.ws.on('message', (data) => {
        this.messages.push(JSON.parse(data.toString()))
      })
    }

    async waitForConnection(): Promise<void> {
      return new Promise((resolve, reject) => {
        this.ws.once('open', resolve)
        this.ws.once('error', reject)
      })
    }

    send(message: any): void {
      this.ws.send(JSON.stringify(message))
    }

    async waitForMessage(timeout: number = 1000): Promise<any> {
      const start = Date.now()
      while (this.messages.length === 0) {
        if (Date.now() - start > timeout) {
          throw new Error('Timeout waiting for message')
        }
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      return this.messages.shift()
    }

    close(): void {
      this.ws.close()
    }
  }
  ```

#### 10. Write Integration Tests (5.5 hours)

**File:** `tests/integration/websocket.test.ts`

- [ ] Test connection/disconnection (1 hour)
  ```typescript
  import { describe, it, expect, beforeAll, afterAll } from 'vitest'
  import { WebSocketServer } from '@/websocket/WebSocketServer'
  import { TestWebSocketClient } from '@/tests/fixtures/websocketClient'
  import { createApp } from '@/api/app'
  import http from 'http'

  describe('WebSocket Server Integration Tests', () => {
    let server: http.Server
    let wsServer: WebSocketServer
    let baseUrl: string

    beforeAll(async () => {
      // Setup HTTP server
      const app = createApp(syncEngine)
      server = http.createServer(app)

      // Setup WebSocket server
      wsServer = new WebSocketServer(server, stateManager)

      // Start server
      await new Promise<void>(resolve => {
        server.listen(0, () => {
          const addr = server.address()
          const port = typeof addr === 'object' ? addr?.port : 0
          baseUrl = `ws://localhost:${port}/ws`
          resolve()
        })
      })
    })

    afterAll(async () => {
      await wsServer.close()
      await new Promise(resolve => server.close(resolve))
    })

    it('should connect and receive CONNECTED message', async () => {
      const sessionId = 'test-session-1'
      const client = new TestWebSocketClient(baseUrl, sessionId)

      await client.waitForConnection()
      const message = await client.waitForMessage()

      expect(message.type).toBe('CONNECTED')
      expect(message.sessionId).toBe(sessionId)

      client.close()
    })

    it('should reject connection without sessionId', async () => {
      const client = new WebSocket(`${baseUrl}`)

      await expect(async () => {
        await new Promise((resolve, reject) => {
          client.once('close', reject)
          client.once('open', resolve)
        })
      }).rejects.toThrow()
    })
  })
  ```

- [ ] Test message broadcasting (1.5 hours)
  ```typescript
  it('should broadcast state updates to all clients in session', async () => {
    const sessionId = 'test-session-2'

    // Connect 2 clients
    const client1 = new TestWebSocketClient(baseUrl, sessionId)
    const client2 = new TestWebSocketClient(baseUrl, sessionId)

    await client1.waitForConnection()
    await client2.waitForConnection()

    // Clear CONNECTED messages
    await client1.waitForMessage()
    await client2.waitForMessage()

    // Trigger state update via SyncEngine
    await syncEngine.createSession({
      session_id: sessionId,
      sync_mode: 'per_participant',
      participants: [...]
    })

    // Both clients should receive STATE_UPDATE
    const msg1 = await client1.waitForMessage()
    const msg2 = await client2.waitForMessage()

    expect(msg1.type).toBe('STATE_UPDATE')
    expect(msg2.type).toBe('STATE_UPDATE')
    expect(msg1.state.session_id).toBe(sessionId)
    expect(msg2.state.session_id).toBe(sessionId)

    client1.close()
    client2.close()
  })
  ```

- [ ] **Test cross-instance broadcasting (2 hours) - CRITICAL**
  ```typescript
  it('should broadcast across multiple server instances via Redis Pub/Sub', async () => {
    const sessionId = 'test-session-cross-instance'

    // Setup: Create 2 server instances
    // Instance 1
    const app1 = createApp(syncEngine1)
    const server1 = http.createServer(app1)
    const ws1 = new WebSocketServer(server1, stateManager1)

    await new Promise<void>(resolve => {
      server1.listen(0, () => resolve())
    })
    const port1 = (server1.address() as any).port
    const url1 = `ws://localhost:${port1}/ws`

    // Instance 2
    const app2 = createApp(syncEngine2)
    const server2 = http.createServer(app2)
    const ws2 = new WebSocketServer(server2, stateManager2)

    await new Promise<void>(resolve => {
      server2.listen(0, () => resolve())
    })
    const port2 = (server2.address() as any).port
    const url2 = `ws://localhost:${port2}/ws`

    // Test scenario:
    // Connect client A to server 1
    const clientA = new TestWebSocketClient(url1, sessionId)
    await clientA.waitForConnection()
    await clientA.waitForMessage() // CONNECTED

    // Connect client B to server 2
    const clientB = new TestWebSocketClient(url2, sessionId)
    await clientB.waitForConnection()
    await clientB.waitForMessage() // CONNECTED

    // Trigger switchCycle() via instance 1
    await syncEngine1.switchCycle(sessionId)

    // Verify BOTH clients receive STATE_UPDATE
    const msgA = await clientA.waitForMessage(2000)
    const msgB = await clientB.waitForMessage(2000)

    expect(msgA.type).toBe('STATE_UPDATE')
    expect(msgB.type).toBe('STATE_UPDATE')

    // Verify latency <100ms
    const latency = Math.abs(msgA.timestamp - msgB.timestamp)
    expect(latency).toBeLessThan(100)

    // Cleanup
    clientA.close()
    clientB.close()
    await ws1.close()
    await ws2.close()
    server1.close()
    server2.close()
  })
  ```

- [ ] Test heartbeat (1 hour)
  ```typescript
  it('should maintain connection with heartbeat', async () => {
    const sessionId = 'test-heartbeat'
    const client = new TestWebSocketClient(baseUrl, sessionId)

    await client.waitForConnection()

    // Wait for multiple heartbeat cycles
    await new Promise(resolve => setTimeout(resolve, 15000))

    // Connection should still be open
    expect(client.ws.readyState).toBe(WebSocket.OPEN)

    client.close()
  })

  it('should terminate stale connections', async () => {
    // This test requires mocking the WebSocket PONG response
    // Implementation depends on test framework capabilities
  })
  ```

---

## Integration with Main Server

**Update:** `src/index.ts`

- [ ] Add WebSocket server to main entry point
  ```typescript
  import { WebSocketServer } from '@/websocket/WebSocketServer'

  async function main() {
    // ... existing setup ...

    // Create Express app
    const app = createApp(syncEngine)

    // Create HTTP server (needed for WebSocket upgrade)
    const server = http.createServer(app)

    // Create WebSocket server
    const wsServer = new WebSocketServer(server, stateManager)

    // Start server
    const port = parseInt(process.env.PORT || '3000', 10)
    server.listen(port, () => {
      logger.info({ port }, 'Server started (HTTP + WebSocket)')
    })

    // Update graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info({ signal }, 'Shutdown signal received')

      // 1. Stop accepting new requests
      server.close()

      // 2. Close WebSocket connections
      await wsServer.close()

      // 3. Close Redis, PostgreSQL, etc.
      // ... existing shutdown code ...
    }
  }
  ```

---

## WebSocket Protocol Definition

**File:** `src/types/websocket.ts`

- [ ] Define message types
  ```typescript
  // Server → Client messages
  export interface WSConnectedMessage {
    type: 'CONNECTED'
    sessionId: string
    timestamp: number
  }

  export interface WSStateUpdateMessage {
    type: 'STATE_UPDATE'
    sessionId: string
    timestamp: number
    state: SyncState
  }

  export interface WSStateSyncMessage {
    type: 'STATE_SYNC'
    sessionId: string
    timestamp: number
    state: SyncState
  }

  export interface WSSessionDeletedMessage {
    type: 'SESSION_DELETED'
    sessionId: string
    timestamp: number
  }

  export interface WSPongMessage {
    type: 'PONG'
    timestamp: number
  }

  export interface WSErrorMessage {
    type: 'ERROR'
    code: string
    message: string
  }

  export type ServerMessage =
    | WSConnectedMessage
    | WSStateUpdateMessage
    | WSStateSyncMessage
    | WSSessionDeletedMessage
    | WSPongMessage
    | WSErrorMessage

  // Client → Server messages
  export interface WSPingMessage {
    type: 'PING'
  }

  export interface WSReconnectMessage {
    type: 'RECONNECT'
  }

  export type ClientMessage =
    | WSPingMessage
    | WSReconnectMessage
  ```

---

## Deliverables

### Code Files
- [ ] `src/websocket/WebSocketServer.ts` - Main WebSocket server
- [ ] `src/types/websocket.ts` - Protocol definitions
- [ ] `tests/integration/websocket.test.ts` - Integration tests
- [ ] `tests/fixtures/websocketClient.ts` - Test helper

### Updated Files
- [ ] `src/index.ts` - Add WebSocket server to main entry point

### Documentation
- [ ] WebSocket protocol documentation
- [ ] Connection parameters (sessionId query param)
- [ ] Message types reference

---

## Testing Checklist

- [ ] Connection/disconnection working
- [ ] State updates broadcast to clients
- [ ] Cross-instance broadcasting validated **[CRITICAL]**
- [ ] Heartbeat maintains connections
- [ ] Stale connections terminated
- [ ] Reconnection sends STATE_SYNC
- [ ] Invalid sessionId rejected

---

## Performance Targets

| Operation | Target | Validation |
|-----------|--------|------------|
| Connection setup | <100ms | Integration test |
| State update delivery (same instance) | <50ms | Integration test |
| Cross-instance delivery | <100ms | **Multi-instance test** |
| Heartbeat overhead | <1% CPU | Manual observation |

---

## Future Enhancements (Post-Phase 2)

These features are not required for Phase 2 completion but should be considered for Phase 3 or future iterations:

- **WebSocket protocol versioning** - Similar to REST API v1/v2, add version negotiation during connection
- **Connection limits per session** - Prevent abuse by limiting max connections per session (e.g., 100 clients)
- **Message compression** - For large state objects, consider WebSocket per-message deflate extension
- **Resume from version** - More advanced reconnection that resumes from last known state version instead of full sync
- **Binary protocol** - For high-performance use cases, consider MessagePack or Protocol Buffers instead of JSON
- **Presence detection** - Track which participants are currently connected via WebSocket

---

## Common Pitfalls to Avoid

❌ **DON'T:**
- Forget to subscribe to BOTH Pub/Sub channels
- Skip heartbeat implementation
- Miss cross-instance test (THE critical test)
- Store WebSocket connections in instance memory only

✅ **DO:**
- Subscribe to `session-updates` AND `ws:*` patterns
- Implement heartbeat mechanism
- Test multi-instance scenario thoroughly
- Clean up disconnected clients properly

---

## Blocked By

- Task 2.1 (SyncEngine) - Needs for state updates
- Task 1.2 (RedisStateManager) - Needs for Pub/Sub

## Blocks

- None (WebSocket is final Phase 2 component)

---

**Status:** 🔴 Not Started
**This completes Phase 2 implementation!**
