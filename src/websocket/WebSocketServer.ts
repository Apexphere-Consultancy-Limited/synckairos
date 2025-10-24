import { WebSocketServer as WSServer, WebSocket } from 'ws'
import { Server as HTTPServer } from 'http'
import { RedisStateManager } from '../state/RedisStateManager'
import { createComponentLogger } from '../utils/logger'
import { ServerMessage, ClientMessage } from '../types/websocket'
import { websocketConnections } from '../api/middlewares/metrics'

const logger = createComponentLogger('WebSocketServer')

// UUID validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

    logger.info('WebSocketServer initialized')
  }

  /**
   * Setup connection handler for new WebSocket connections
   */
  private setupConnectionHandler(): void {
    this.wss.on('connection', (ws: WebSocket, req) => {
      try {
        // Parse sessionId from query params
        const url = new URL(req.url!, `http://${req.headers.host}`)
        const sessionId = url.searchParams.get('sessionId')

        if (!sessionId) {
          logger.warn('Connection rejected: Missing sessionId parameter')
          ws.close(1008, 'Missing sessionId parameter')
          return
        }

        // Validate sessionId format (UUID)
        if (!UUID_REGEX.test(sessionId)) {
          logger.warn({ sessionId }, 'Connection rejected: Invalid sessionId format')
          ws.close(1008, 'Invalid sessionId format')
          return
        }

        // Add client to session group
        if (!this.clients.has(sessionId)) {
          this.clients.set(sessionId, new Set())
        }
        this.clients.get(sessionId)!.add(ws)

        // Update metrics: increment WebSocket connections
        websocketConnections.inc()

        // Mark as alive for heartbeat and store sessionId
        const extWs = ws as any
        extWs.isAlive = true
        extWs.sessionId = sessionId

        // Send connection acknowledgment
        this.sendMessage(ws, {
          type: 'CONNECTED',
          sessionId,
          timestamp: Date.now(),
        })

        logger.info(
          { sessionId, clientCount: this.clients.get(sessionId)!.size },
          'Client connected'
        )

        // Setup message handlers
        ws.on('message', data => this.handleClientMessage(ws, sessionId, data))
        ws.on('pong', () => {
          extWs.isAlive = true
        })
        ws.on('close', () => this.handleDisconnection(ws, sessionId))
        ws.on('error', err => {
          logger.error({ err, sessionId }, 'WebSocket error')
        })
      } catch (err) {
        logger.error({ err }, 'Connection setup error')
        ws.close(1011, 'Internal server error')
      }
    })
  }

  /**
   * Handle client disconnection
   */
  private handleDisconnection(ws: WebSocket, sessionId: string): void {
    // Remove from session group
    const clients = this.clients.get(sessionId)
    if (clients) {
      clients.delete(ws)

      // Update metrics: decrement WebSocket connections
      websocketConnections.dec()

      // Clean up empty groups
      if (clients.size === 0) {
        this.clients.delete(sessionId)
      }

      logger.info({ sessionId, remainingClients: clients.size }, 'Client disconnected')
    }
  }

  /**
   * Setup Redis Pub/Sub listeners for state updates and cross-instance WebSocket messages
   * CRITICAL: Subscribe to BOTH channels
   */
  private setupPubSubListeners(): void {
    // Channel 1: State updates (session-updates)
    this.stateManager.subscribeToUpdates((sessionId, state) => {
      if (state === null) {
        // Session deleted
        this.broadcastToSession(sessionId, {
          type: 'SESSION_DELETED',
          sessionId,
          timestamp: Date.now(),
        })

        // Close all connections for this session
        const clients = this.clients.get(sessionId)
        if (clients) {
          clients.forEach(ws => {
            ws.close(1000, 'Session deleted')
          })
          this.clients.delete(sessionId)
        }

        logger.info({ sessionId }, 'Session deleted, connections closed')
      } else {
        // State updated
        this.broadcastToSession(sessionId, {
          type: 'STATE_UPDATE',
          sessionId,
          timestamp: Date.now(),
          state,
        })
      }
    })

    // Channel 2: WebSocket messages (ws:*)
    this.stateManager.subscribeToWebSocket((sessionId, message) => {
      this.broadcastToSession(sessionId, message as ServerMessage)
    })

    logger.info('Subscribed to Redis Pub/Sub channels')
  }

  /**
   * Broadcast message to all clients in a session
   */
  private broadcastToSession(sessionId: string, message: ServerMessage): void {
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

    logger.debug(
      { sessionId, clients: clients.size, sent: sentCount, messageType: message.type },
      'Broadcasted message'
    )
  }

  /**
   * Send message to a single WebSocket client
   */
  private sendMessage(ws: WebSocket, message: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message))
    }
  }

  /**
   * Handle incoming messages from clients
   */
  private async handleClientMessage(
    ws: WebSocket,
    sessionId: string,
    data: Buffer | ArrayBuffer | Buffer[]
  ): Promise<void> {
    try {
      const message = JSON.parse(data.toString()) as ClientMessage

      switch (message.type) {
        case 'PING':
          // Respond with PONG + server timestamp
          this.sendMessage(ws, {
            type: 'PONG',
            timestamp: Date.now(),
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
              state,
            })
            logger.info({ sessionId }, 'Sent STATE_SYNC for reconnection')
          } else {
            this.sendMessage(ws, {
              type: 'ERROR',
              code: 'SESSION_NOT_FOUND',
              message: `Session ${sessionId} not found`,
            })
            logger.warn({ sessionId }, 'RECONNECT failed: Session not found')
          }
          break

        default:
          logger.warn({ type: (message as any).type }, 'Unknown message type')
      }
    } catch (err) {
      logger.error({ err, sessionId }, 'Failed to handle client message')
    }
  }

  /**
   * Start heartbeat mechanism
   * Sends PING to all clients every 5 seconds
   * Terminates connections that don't respond with PONG
   */
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

  /**
   * Close WebSocket server gracefully
   */
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
    return new Promise(resolve => {
      this.wss.close(() => {
        logger.info('WebSocket server closed')
        resolve()
      })
    })
  }

  /**
   * Get connected client count for a session
   * Useful for debugging and monitoring
   */
  getClientCount(sessionId: string): number {
    return this.clients.get(sessionId)?.size ?? 0
  }

  /**
   * Get total connected client count
   * Useful for monitoring
   */
  getTotalClientCount(): number {
    return this.wss.clients.size
  }
}
