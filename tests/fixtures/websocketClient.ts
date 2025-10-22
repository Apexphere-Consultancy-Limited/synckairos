import WebSocket from 'ws'
import { ServerMessage, ClientMessage } from '../../src/types/websocket'

/**
 * Test WebSocket client helper
 * Provides utilities for testing WebSocket connections
 */
export class TestWebSocketClient {
  public ws: WebSocket
  private messages: ServerMessage[] = []
  private messagePromises: Array<{
    resolve: (msg: ServerMessage) => void
    reject: (err: Error) => void
    timeout: NodeJS.Timeout
  }> = []

  constructor(url: string, sessionId: string) {
    this.ws = new WebSocket(`${url}?sessionId=${sessionId}`)

    this.ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString()) as ServerMessage
        this.messages.push(message)

        // Resolve any waiting promises
        if (this.messagePromises.length > 0) {
          const { resolve, timeout } = this.messagePromises.shift()!
          clearTimeout(timeout)
          resolve(message)
        }
      } catch (err) {
        console.error('Failed to parse message:', err)
      }
    })
  }

  /**
   * Wait for WebSocket connection to open
   */
  async waitForConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws.readyState === WebSocket.OPEN) {
        resolve()
        return
      }

      this.ws.once('open', resolve)
      this.ws.once('error', reject)

      // Timeout after 5 seconds
      setTimeout(() => {
        reject(new Error('Connection timeout'))
      }, 5000)
    })
  }

  /**
   * Send message to server
   */
  send(message: ClientMessage): void {
    this.ws.send(JSON.stringify(message))
  }

  /**
   * Wait for next message from server
   * @param timeout - Timeout in milliseconds (default: 2000ms)
   */
  async waitForMessage(timeout: number = 2000): Promise<ServerMessage> {
    // If we already have messages, return the first one
    if (this.messages.length > 0) {
      return this.messages.shift()!
    }

    // Wait for a message
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const idx = this.messagePromises.findIndex((p) => p.resolve === resolve)
        if (idx !== -1) {
          this.messagePromises.splice(idx, 1)
        }
        reject(new Error(`Timeout waiting for message (${timeout}ms)`))
      }, timeout)

      this.messagePromises.push({ resolve, reject, timeout: timeoutId })
    })
  }

  /**
   * Wait for a specific message type
   * @param type - Message type to wait for
   * @param timeout - Timeout in milliseconds (default: 2000ms)
   */
  async waitForMessageType(
    type: ServerMessage['type'],
    timeout: number = 2000
  ): Promise<ServerMessage> {
    const start = Date.now()
    const skipped: ServerMessage[] = []

    while (Date.now() - start < timeout) {
      try {
        const message = await this.waitForMessage(timeout - (Date.now() - start))
        if (message.type === type) {
          // Put skipped messages back at the beginning
          this.messages.unshift(...skipped)
          return message
        }
        // Buffer non-matching messages for later
        skipped.push(message)
      } catch (err) {
        // Restore skipped messages on timeout
        this.messages.unshift(...skipped)
        throw err
      }
    }

    // Restore skipped messages
    this.messages.unshift(...skipped)
    throw new Error(`Timeout waiting for message type: ${type}`)
  }

  /**
   * Get all received messages
   */
  getMessages(): ServerMessage[] {
    return [...this.messages]
  }

  /**
   * Clear received messages
   */
  clearMessages(): void {
    this.messages = []
  }

  /**
   * Close connection
   */
  close(): void {
    this.ws.close()
  }

  /**
   * Wait for connection to close
   */
  async waitForClose(timeout: number = 2000): Promise<void> {
    return new Promise((resolve, reject) => {
      if (
        this.ws.readyState === WebSocket.CLOSED ||
        this.ws.readyState === WebSocket.CLOSING
      ) {
        resolve()
        return
      }

      this.ws.once('close', resolve)

      setTimeout(() => {
        reject(new Error('Close timeout'))
      }, timeout)
    })
  }

  /**
   * Check if connection is open
   */
  isOpen(): boolean {
    return this.ws.readyState === WebSocket.OPEN
  }

  /**
   * Check if connection is closed or closing
   */
  isClosed(): boolean {
    return (
      this.ws.readyState === WebSocket.CLOSED ||
      this.ws.readyState === WebSocket.CLOSING
    )
  }
}
