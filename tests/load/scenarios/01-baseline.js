import http from 'k6/http'
import { check, sleep } from 'k6'
import { generateSession } from '../utils/generators.js'
import { assertSwitchCyclePerformance, assertNoErrors } from '../utils/assertions.js'
import { getThresholds } from '../config/thresholds.js'

export const options = {
  vus: 10, // 10 virtual users
  duration: '2m', // 2 minute test
  thresholds: getThresholds('baseline'),
}

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000'

export default function () {
  // 1. Create session
  const sessionConfig = generateSession({
    participantCount: 2,
    timePerParticipantMs: 60000,
    scenario: 'baseline',
  })

  const createRes = http.post(
    `${BASE_URL}/v1/sessions`,
    JSON.stringify(sessionConfig),
    {
      headers: { 'Content-Type': 'application/json' },
    }
  )

  assertNoErrors(createRes)
  check(createRes, {
    'session created': (r) => r.status === 201,
  })

  if (createRes.status !== 201) {
    return // Skip rest if creation failed
  }

  const sessionId = sessionConfig.session_id

  sleep(0.1) // Small delay

  // 2. Start session
  const startRes = http.post(`${BASE_URL}/v1/sessions/${sessionId}/start`)
  assertNoErrors(startRes)

  sleep(0.1)

  // 3. Perform 5 switch cycles (hot path testing)
  for (let i = 0; i < 5; i++) {
    const switchRes = http.post(
      `${BASE_URL}/v1/sessions/${sessionId}/switch`,
      null,
      {
        tags: { operation: 'switchCycle' }, // Tag for threshold tracking
      }
    )

    assertSwitchCyclePerformance(switchRes)
    sleep(0.05) // 50ms between switches
  }

  // 4. Get current state
  const getRes = http.get(`${BASE_URL}/v1/sessions/${sessionId}`)
  assertNoErrors(getRes)

  sleep(0.1)

  // 5. Complete session
  const completeRes = http.post(
    `${BASE_URL}/v1/sessions/${sessionId}/complete`
  )
  assertNoErrors(completeRes)

  sleep(0.5) // Cooldown
}
