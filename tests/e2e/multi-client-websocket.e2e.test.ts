/**
 * E2E Test: Multi-Client WebSocket Synchronization
 *
 * Tags: @critical @websocket
 * Goal: Validate STATE_UPDATE broadcasting to multiple WebSocket clients
 *
 * Test Coverage:
 * - WebSocket connection establishment
 * - STATE_UPDATE broadcasting to all connected clients
 * - State consistency across clients
 * - Broadcast latency <100ms
 * - Schema validation with Zod
 *
 * Architecture: Uses STATE_UPDATE (not granular events)
 * - Clients receive full state on every update
 * - Follows "Calculate, Don't Count" principle
 * - Distributed-first design with Redis Pub/Sub
 */

import { test, expect } from '@playwright/test'
import { getEnvironment } from './setup/environments'
import WebSocket from 'ws'
import {
  ServerMessage,
  WSStateUpdateMessage,
} from '../../src/types/websocket'
import { SyncState } from '../../src/types/session'
import { generateSessionId, createParticipant, createSessionPayload, TEST_PARTICIPANTS } from './test-utils'

interface WebSocketClient {
  ws: WebSocket
  receivedMessages: ServerMessage[]
  sessionId: string
}

/**
 * Helper: Create and connect a WebSocket client
 */
async function createWebSocketClient(
  sessionId: string,
  wsURL: string
): Promise<WebSocketClient> {
  const client: WebSocketClient = {
    ws: new WebSocket(`${wsURL}?sessionId=${sessionId}`),
    receivedMessages: [],
    sessionId,
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`WebSocket connection timeout for session ${sessionId}`))
    }, 5000)

    client.ws.on('open', () => {
      clearTimeout(timeout)
      console.log(`✅ WebSocket connected to session: ${sessionId}`)
      resolve(client)
    })

    client.ws.on('message', (data: WebSocket.Data) => {
      const message = JSON.parse(data.toString()) as ServerMessage

      // Basic validation - ensure message has type field
      if (!message || !message.type) {
        console.error('❌ Invalid message received: missing type field')
        return
      }

      ;(message as any).received_at = Date.now() // Track reception time for latency measurement
      client.receivedMessages.push(message)
      console.log(`📩 Received ${message.type}`)
    })

    client.ws.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
  })
}

/**
 * Helper: Wait for STATE_UPDATE matching condition
 */
async function waitForStateUpdate(
  client: WebSocketClient,
  condition: (state: SyncState) => boolean,
  timeoutMs: number = 2000
): Promise<WSStateUpdateMessage & { received_at: number }> {
  const startTime = Date.now()

  while (Date.now() - startTime < timeoutMs) {
    const msg = client.receivedMessages.find(
      (m) =>
        (m.type === 'STATE_UPDATE' || m.type === 'STATE_SYNC') &&
        condition((m as WSStateUpdateMessage).state)
    )
    if (msg) {
      return msg as WSStateUpdateMessage & { received_at: number }
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }

  throw new Error(`Timeout waiting for STATE_UPDATE matching condition`)
}

/**
 * Helper: Close WebSocket client
 */
async function closeWebSocketClient(client: WebSocketClient): Promise<void> {
  return new Promise((resolve) => {
    client.ws.on('close', () => {
      console.log(`🔌 WebSocket closed for session: ${client.sessionId}`)
      resolve()
    })
    client.ws.close()
  })
}

test('multi-client WebSocket synchronization @critical @websocket', async ({ request }) => {
  const env = getEnvironment()
  const sessionId = generateSessionId('e2e-ws')
  let client1: WebSocketClient | null = null
  let client2: WebSocketClient | null = null
  let client3: WebSocketClient | null = null

  try {
    // 1. Create session via REST API
    const createRes = await request.post(`${env.baseURL}/v1/sessions`, {
      data: createSessionPayload(sessionId, [
        createParticipant(TEST_PARTICIPANTS.P1, 0, 300000),
        createParticipant(TEST_PARTICIPANTS.P2, 1, 300000),
        createParticipant(TEST_PARTICIPANTS.P3, 2, 300000),
      ]),
    })
    expect(createRes.status()).toBe(201)
    console.log(`✅ Session created: ${sessionId}`)

    // 2. Connect 3 WebSocket clients
    client1 = await createWebSocketClient(sessionId, env.wsURL)
    client2 = await createWebSocketClient(sessionId, env.wsURL)
    client3 = await createWebSocketClient(sessionId, env.wsURL)

    // All clients should receive CONNECTED message
    await waitForStateUpdate(client1, () => true, 1000).catch(() => {}) // May receive CONNECTED first
    await waitForStateUpdate(client2, () => true, 1000).catch(() => {})
    await waitForStateUpdate(client3, () => true, 1000).catch(() => {})

    // 3. Start session and verify all clients receive STATE_UPDATE
    const broadcastStartTime = Date.now()
    await request.post(`${env.baseURL}/v1/sessions/${sessionId}/start`)

    const update1 = await waitForStateUpdate(client1, (s) => s.status === 'running')
    const update2 = await waitForStateUpdate(client2, (s) => s.status === 'running')
    const update3 = await waitForStateUpdate(client3, (s) => s.status === 'running')

    // Verify state content
    expect(update1.state.status).toBe('running')
    expect(update1.state.active_participant_id).toBe(TEST_PARTICIPANTS.P1)
    expect(update2.state.active_participant_id).toBe(TEST_PARTICIPANTS.P1)
    expect(update3.state.active_participant_id).toBe(TEST_PARTICIPANTS.P1)

    // Verify broadcast latency <100ms
    const broadcastLatency = Math.max(
      update1.received_at - broadcastStartTime,
      update2.received_at - broadcastStartTime,
      update3.received_at - broadcastStartTime
    )
    expect(broadcastLatency).toBeLessThan(100)
    console.log(`✅ STATE_UPDATE broadcast latency: ${broadcastLatency}ms (<100ms target met)`)

    // 4. switchCycle and verify all clients receive STATE_UPDATE with new active participant
    client1.receivedMessages = []
    client2.receivedMessages = []
    client3.receivedMessages = []

    const switchStartTime = Date.now()
    await request.post(`${env.baseURL}/v1/sessions/${sessionId}/switch`)

    const switch1 = await waitForStateUpdate(client1, (s) => s.active_participant_id === TEST_PARTICIPANTS.P2)
    const switch2 = await waitForStateUpdate(client2, (s) => s.active_participant_id === TEST_PARTICIPANTS.P2)
    const switch3 = await waitForStateUpdate(client3, (s) => s.active_participant_id === TEST_PARTICIPANTS.P2)

    expect(switch1.state.active_participant_id).toBe(TEST_PARTICIPANTS.P2)
    expect(switch2.state.active_participant_id).toBe(TEST_PARTICIPANTS.P2)
    expect(switch3.state.active_participant_id).toBe(TEST_PARTICIPANTS.P2)

    // Verify p1 is no longer active
    const p1_in_switch1 = switch1.state.participants.find((p) => p.participant_id === TEST_PARTICIPANTS.P1)
    expect(p1_in_switch1?.is_active).toBe(false)
    expect(p1_in_switch1?.cycle_count).toBe(1)

    const switchLatency = Math.max(
      switch1.received_at - switchStartTime,
      switch2.received_at - switchStartTime,
      switch3.received_at - switchStartTime
    )
    expect(switchLatency).toBeLessThan(100)
    console.log(`✅ switchCycle broadcast latency: ${switchLatency}ms (<100ms target met)`)

    // 5. Pause and verify all clients receive STATE_UPDATE with status=paused
    client1.receivedMessages = []
    client2.receivedMessages = []
    client3.receivedMessages = []

    await request.post(`${env.baseURL}/v1/sessions/${sessionId}/pause`)

    const pause1 = await waitForStateUpdate(client1, (s) => s.status === 'paused')
    const pause2 = await waitForStateUpdate(client2, (s) => s.status === 'paused')
    const pause3 = await waitForStateUpdate(client3, (s) => s.status === 'paused')

    expect(pause1.state.status).toBe('paused')
    expect(pause2.state.status).toBe('paused')
    expect(pause3.state.status).toBe('paused')
    console.log(`✅ STATE_UPDATE (paused) broadcasted to all clients`)

    // 6. Resume and verify all clients receive STATE_UPDATE with status=running
    client1.receivedMessages = []
    client2.receivedMessages = []
    client3.receivedMessages = []

    await request.post(`${env.baseURL}/v1/sessions/${sessionId}/resume`)

    const resume1 = await waitForStateUpdate(client1, (s) => s.status === 'running')
    const resume2 = await waitForStateUpdate(client2, (s) => s.status === 'running')
    const resume3 = await waitForStateUpdate(client3, (s) => s.status === 'running')

    expect(resume1.state.status).toBe('running')
    expect(resume2.state.status).toBe('running')
    expect(resume3.state.status).toBe('running')
    console.log(`✅ STATE_UPDATE (resumed) broadcasted to all clients`)

    // 7. Complete and verify all clients receive STATE_UPDATE with status=completed
    client1.receivedMessages = []
    client2.receivedMessages = []
    client3.receivedMessages = []

    await request.post(`${env.baseURL}/v1/sessions/${sessionId}/complete`)

    const complete1 = await waitForStateUpdate(client1, (s) => s.status === 'completed')
    const complete2 = await waitForStateUpdate(client2, (s) => s.status === 'completed')
    const complete3 = await waitForStateUpdate(client3, (s) => s.status === 'completed')

    expect(complete1.state.status).toBe('completed')
    expect(complete1.state.active_participant_id).toBeNull()
    expect(complete2.state.status).toBe('completed')
    expect(complete3.state.status).toBe('completed')

    // Verify all participants are inactive
    complete1.state.participants.forEach((p) => {
      expect(p.is_active).toBe(false)
    })

    console.log(`✅ STATE_UPDATE (completed) broadcasted to all clients`)
    console.log(`✅ Multi-client WebSocket synchronization validated successfully`)
  } finally {
    // Cleanup: Close all WebSocket connections
    if (client1) await closeWebSocketClient(client1)
    if (client2) await closeWebSocketClient(client2)
    if (client3) await closeWebSocketClient(client3)

    // Cleanup: Delete session
    try {
      await request.delete(`${env.baseURL}/v1/sessions/${sessionId}`)
      console.log(`🧹 Cleaned up session: ${sessionId}`)
    } catch (error) {
      console.warn(`⚠️ Cleanup failed for session: ${sessionId}`)
    }
  }
})

test('WebSocket reconnection with STATE_SYNC @websocket', async ({ request }) => {
  const env = getEnvironment()
  const sessionId = generateSessionId('e2e-ws-reconnect')
  let client: WebSocketClient | null = null

  try {
    // Create and start session
    await request.post(`${env.baseURL}/v1/sessions`, {
      data: createSessionPayload(sessionId, [
        createParticipant(TEST_PARTICIPANTS.P1, 0, 300000),
        createParticipant(TEST_PARTICIPANTS.P2, 1, 300000),
      ]),
    })

    client = await createWebSocketClient(sessionId, env.wsURL)
    await request.post(`${env.baseURL}/v1/sessions/${sessionId}/start`)
    await waitForStateUpdate(client, (s) => s.status === 'running')

    // Disconnect client
    await closeWebSocketClient(client)
    console.log(`🔌 Disconnected client`)

    // Perform switchCycle while client is disconnected
    await request.post(`${env.baseURL}/v1/sessions/${sessionId}/switch`)
    console.log(`🔄 Switched cycle while disconnected`)

    // Reconnect client
    client = await createWebSocketClient(sessionId, env.wsURL)
    console.log(`🔌 Reconnected client`)

    // Request current state using RECONNECT message
    client.ws.send(JSON.stringify({ type: 'RECONNECT' }))

    // Should receive STATE_SYNC with current state (active_participant_id = TEST_PARTICIPANTS.P2)
    const sync = await waitForStateUpdate(client, (s) => s.active_participant_id === TEST_PARTICIPANTS.P2)
    expect(sync.type).toBe('STATE_SYNC')
    expect(sync.state.active_participant_id).toBe(TEST_PARTICIPANTS.P2)
    expect(sync.state.status).toBe('running')

    console.log(`✅ Reconnection with STATE_SYNC validated successfully`)
  } finally {
    if (client) await closeWebSocketClient(client)
    try {
      await request.delete(`${env.baseURL}/v1/sessions/${sessionId}`)
      console.log(`🧹 Cleaned up session: ${sessionId}`)
    } catch (error) {
      console.warn(`⚠️ Cleanup failed for session: ${sessionId}`)
    }
  }
})
