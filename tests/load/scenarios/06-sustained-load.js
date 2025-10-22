import http from 'k6/http'
import { check, sleep } from 'k6'
import { generateSession } from '../utils/generators.js'
import { assertSwitchCyclePerformance } from '../utils/assertions.js'
import { getThresholds } from '../config/thresholds.js'

export const options = {
  vus: 500, // 500 concurrent virtual users
  duration: '5m', // 5 minutes sustained
  thresholds: getThresholds('sustained'),
}

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000'

export default function () {
  const sessionConfig = generateSession({
    participantCount: 3,
    timePerParticipantMs: 90000,
    scenario: 'sustained',
  })

  const createRes = http.post(
    `${BASE_URL}/v1/sessions`,
    JSON.stringify(sessionConfig),
    { headers: { 'Content-Type': 'application/json' } }
  )

  if (createRes.status !== 201) return

  const sessionId = sessionConfig.session_id
  http.post(`${BASE_URL}/v1/sessions/${sessionId}/start`)

  // Continuous switching for duration of test
  for (let i = 0; i < 20; i++) {
    const switchRes = http.post(
      `${BASE_URL}/v1/sessions/${sessionId}/switch`,
      null,
      { tags: { operation: 'switchCycle' } }
    )
    assertSwitchCyclePerformance(switchRes)
    sleep(1)
  }

  http.post(`${BASE_URL}/v1/sessions/${sessionId}/complete`)
  sleep(2)
}
