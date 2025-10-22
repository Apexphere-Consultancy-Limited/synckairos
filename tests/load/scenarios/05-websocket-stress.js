import http from 'k6/http'
import ws from 'k6/ws'
import { check, sleep } from 'k6'
import { generateSession } from '../utils/generators.js'
import { assertWebSocketDelivery } from '../utils/assertions.js'
import { getThresholds } from '../config/thresholds.js'
import { Counter } from 'k6/metrics'

export const options = {
  stages: [
    { duration: '2m', target: 1000 }, // 1k WebSocket connections
    { duration: '5m', target: 5000 }, // 5k connections
    { duration: '5m', target: 10000 }, // 10k connections (CRITICAL)
    { duration: '5m', target: 10000 }, // Sustain at 10k
    { duration: '2m', target: 0 },
  ],
  thresholds: getThresholds('websocket-stress'),
}

const websocketDeliveryTime = new Counter('websocket_delivery_time')

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000'
const WS_URL = __ENV.WS_URL || 'ws://localhost:3000/ws'

export default function () {
  const sessionConfig = generateSession({
    participantCount: 2,
    timePerParticipantMs: 180000,
    scenario: 'websocket-stress',
  })

  // Create session
  const createRes = http.post(
    `${BASE_URL}/v1/sessions`,
    JSON.stringify(sessionConfig),
    { headers: { 'Content-Type': 'application/json' } }
  )

  if (createRes.status !== 201) return

  const sessionId = sessionConfig.session_id

  // Connect WebSocket
  const wsUrl = `${WS_URL}?sessionId=${sessionId}`
  let messageCount = 0
  let requestTime = 0

  ws.connect(wsUrl, {}, function (socket) {
    socket.on('open', () => {
      // Start session after WebSocket connected
      requestTime = Date.now()
      http.post(`${BASE_URL}/v1/sessions/${sessionId}/start`)
    })

    socket.on('message', (data) => {
      const deliveryTime = Date.now() - requestTime
      const message = JSON.parse(data)

      messageCount++

      if (message.type === 'STATE_UPDATE') {
        websocketDeliveryTime.add(deliveryTime)
        assertWebSocketDelivery(deliveryTime)

        // Trigger another update
        if (messageCount < 10) {
          requestTime = Date.now()
          http.post(`${BASE_URL}/v1/sessions/${sessionId}/switch`, null, {
            tags: { operation: 'switchCycle' },
          })
        }
      }
    })

    socket.on('close', () => {
      // Connection closed
    })

    socket.on('error', (err) => {
      console.error('WebSocket error:', err)
    })

    // Keep connection open for 60 seconds
    socket.setTimeout(() => {
      socket.close()
    }, 60000)
  })

  sleep(1)
}
