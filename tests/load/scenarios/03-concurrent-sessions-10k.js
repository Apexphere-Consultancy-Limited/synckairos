import http from 'k6/http'
import { check, sleep } from 'k6'
import { generateSession } from '../utils/generators.js'
import { assertSwitchCyclePerformance } from '../utils/assertions.js'
import { getThresholds } from '../config/thresholds.js'

export const options = {
  stages: [
    { duration: '5m', target: 1000 }, // Ramp up to 1k
    { duration: '5m', target: 5000 }, // Ramp up to 5k
    { duration: '10m', target: 10000 }, // Ramp up to 10k (CRITICAL)
    { duration: '10m', target: 10000 }, // Sustain at 10k
    { duration: '5m', target: 0 }, // Ramp down
  ],
  thresholds: getThresholds('10k-concurrent'),
}

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000'

export default function () {
  const sessionConfig = generateSession({
    participantCount: 2,
    timePerParticipantMs: 300000, // 5 minutes per participant
    scenario: '10k-concurrent',
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

  // Fewer switches per session to reduce load
  for (let i = 0; i < 5; i++) {
    const switchRes = http.post(
      `${BASE_URL}/v1/sessions/${sessionId}/switch`,
      null,
      { tags: { operation: 'switchCycle' } }
    )
    assertSwitchCyclePerformance(switchRes)
    sleep(1) // 1 second between switches
  }

  // Complete session
  http.post(`${BASE_URL}/v1/sessions/${sessionId}/complete`)
  sleep(2)
}
