import http from 'k6/http'
import { check, sleep } from 'k6'
import { generateSession } from '../utils/generators.js'
import { assertSwitchCyclePerformance } from '../utils/assertions.js'
import { getThresholds } from '../config/thresholds.js'

export const options = {
  stages: [
    { duration: '2m', target: 100 }, // Ramp up to 100 VUs
    { duration: '3m', target: 500 }, // Ramp up to 500 VUs
    { duration: '5m', target: 1000 }, // Ramp up to 1000 VUs (1k sessions)
    { duration: '5m', target: 1000 }, // Stay at 1000 VUs
    { duration: '2m', target: 0 }, // Ramp down
  ],
  thresholds: getThresholds('1k-concurrent'),
}

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000'

export default function () {
  const sessionConfig = generateSession({
    participantCount: 2,
    timePerParticipantMs: 120000, // 2 minutes per participant
    scenario: '1k-concurrent',
  })

  // Create and start session
  const createRes = http.post(
    `${BASE_URL}/v1/sessions`,
    JSON.stringify(sessionConfig),
    { headers: { 'Content-Type': 'application/json' } }
  )

  if (createRes.status !== 201) return

  const sessionId = sessionConfig.session_id
  http.post(`${BASE_URL}/v1/sessions/${sessionId}/start`)

  // Perform multiple switches
  for (let i = 0; i < 10; i++) {
    const switchRes = http.post(
      `${BASE_URL}/v1/sessions/${sessionId}/switch`,
      null,
      { tags: { operation: 'switchCycle' } }
    )
    assertSwitchCyclePerformance(switchRes)
    sleep(0.5) // 500ms between switches
  }

  // Complete session
  http.post(`${BASE_URL}/v1/sessions/${sessionId}/complete`)
  sleep(1)
}
