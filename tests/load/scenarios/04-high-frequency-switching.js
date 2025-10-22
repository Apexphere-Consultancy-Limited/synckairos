import http from 'k6/http'
import { check, sleep } from 'k6'
import { generateSession } from '../utils/generators.js'
import { assertSwitchCyclePerformance, assertOptimisticLocking } from '../utils/assertions.js'
import { getThresholds } from '../config/thresholds.js'

export const options = {
  vus: 50, // 50 virtual users
  duration: '5m',
  thresholds: getThresholds('high-frequency'),
}

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000'

export default function () {
  const sessionConfig = generateSession({
    participantCount: 4,
    timePerParticipantMs: 60000,
    scenario: 'high-frequency',
  })

  const createRes = http.post(
    `${BASE_URL}/v1/sessions`,
    JSON.stringify(sessionConfig),
    { headers: { 'Content-Type': 'application/json' } }
  )

  if (createRes.status !== 201) return

  const sessionId = sessionConfig.session_id
  http.post(`${BASE_URL}/v1/sessions/${sessionId}/start`)

  // Rapid switches: 10 per second for 10 seconds = 100 switches
  for (let i = 0; i < 100; i++) {
    const switchRes = http.post(
      `${BASE_URL}/v1/sessions/${sessionId}/switch`,
      null,
      { tags: { operation: 'switchCycle' } }
    )

    // 409 conflicts are expected and acceptable here
    assertOptimisticLocking(switchRes)

    sleep(0.01) // 10ms between switches = 100 switches/sec
  }

  http.post(`${BASE_URL}/v1/sessions/${sessionId}/complete`)
  sleep(0.5)
}
