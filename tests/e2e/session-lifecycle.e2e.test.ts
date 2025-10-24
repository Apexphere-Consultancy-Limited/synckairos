/**
 * E2E Test: Session Lifecycle
 *
 * Tags: @critical @smoke
 * Goal: Validate entire session flow from creation to completion with performance measurement
 *
 * Covered Endpoints:
 * - POST /v1/sessions
 * - POST /v1/sessions/:id/start
 * - POST /v1/sessions/:id/switch
 * - POST /v1/sessions/:id/complete
 * - GET /v1/sessions/:id
 */

import { test, expect } from '@playwright/test'
import { getEnvironment } from './setup/environments'
import {
  SessionResponseSchema,
  SwitchCycleResponseSchema,
} from '../../src/api/schemas/session'
import { generateSessionId, createParticipant, createSessionPayload, TEST_PARTICIPANTS } from './test-utils'

const createdSessions: string[] = []

test.afterEach(async ({ request }) => {
  const env = getEnvironment()
  // Cleanup all sessions created during tests
  for (const sessionId of createdSessions) {
    try {
      await request.delete(`${env.baseURL}/v1/sessions/${sessionId}`)
      console.log(`🧹 Cleaned up session: ${sessionId}`)
    } catch (error) {
      console.warn(`⚠️ Cleanup failed for session: ${sessionId}`)
    }
  }
  createdSessions.length = 0
})

test('complete session lifecycle @critical @smoke', async ({ request }) => {
  const env = getEnvironment()
  const testStartTime = Date.now()

  // 1. Create session
  const sessionId = generateSessionId('e2e-lifecycle')
  createdSessions.push(sessionId)

  const createRes = await request.post(`${env.baseURL}/v1/sessions`, {
    data: createSessionPayload(sessionId, [
      createParticipant(TEST_PARTICIPANTS.P1, 0, 300000),
      createParticipant(TEST_PARTICIPANTS.P2, 1, 300000),
    ])
  })
  expect(createRes.status()).toBe(201)
  const sessionData = await createRes.json()

  // Validate with Zod schema
  const sessionResult = SessionResponseSchema.safeParse(sessionData)
  expect(sessionResult.success).toBe(true)

  const { data: session } = sessionResult.data!
  expect(session.session_id).toBeDefined()
  expect(session.status).toBe('pending')

  // 2. Start session
  const startRes = await request.post(`${env.baseURL}/v1/sessions/${session.session_id}/start`)
  expect(startRes.status()).toBe(200)
  const startJson = await startRes.json()

  // Validate with Zod schema
  const startResult = SessionResponseSchema.safeParse(startJson)
  expect(startResult.success).toBe(true)

  const { data: startData } = startResult.data!
  expect(startData.status).toBe('running')
  expect(startData.active_participant_id).toBe(TEST_PARTICIPANTS.P1)

  // 3. Switch cycle (HOT PATH - measure performance)
  const switchStartTime = Date.now()
  const switchRes = await request.post(`${env.baseURL}/v1/sessions/${session.session_id}/switch`)
  const switchLatency = Date.now() - switchStartTime

  expect(switchRes.status()).toBe(200)
  const switchJson = await switchRes.json()

  // Validate with Zod schema
  const switchResult = SwitchCycleResponseSchema.safeParse(switchJson)
  expect(switchResult.success).toBe(true)

  const { data: switchData } = switchResult.data!
  expect(switchData.active_participant_id).toBe(TEST_PARTICIPANTS.P2)
  expect(switchLatency).toBeLessThan(50) // Performance target: <50ms

  // 4. Complete session
  const completeRes = await request.post(`${env.baseURL}/v1/sessions/${session.session_id}/complete`)
  expect(completeRes.status()).toBe(200)

  // 5. Verify final state
  const getRes = await request.get(`${env.baseURL}/v1/sessions/${session.session_id}`)
  expect(getRes.status()).toBe(200)
  const finalJson = await getRes.json()

  // Validate with Zod schema
  const finalResult = SessionResponseSchema.safeParse(finalJson)
  expect(finalResult.success).toBe(true)

  const { data: finalSession } = finalResult.data!
  expect(finalSession.status).toBe('completed')

  // 6. Validate total flow performance
  const totalDuration = Date.now() - testStartTime
  expect(totalDuration).toBeLessThan(5000) // Performance target: <5 seconds

  console.log(`✅ Session lifecycle completed in ${totalDuration}ms (switchCycle: ${switchLatency}ms)`)
})

test('session lifecycle with pause and resume @critical', async ({ request }) => {
  const env = getEnvironment()
  const sessionId = generateSessionId('e2e-lifecycle-pause')
  createdSessions.push(sessionId)

  // Create and start session
  await request.post(`${env.baseURL}/v1/sessions`, {
    data: createSessionPayload(sessionId, [
      createParticipant(TEST_PARTICIPANTS.P1, 0, 300000),
      createParticipant(TEST_PARTICIPANTS.P2, 1, 300000),
    ])
  })

  await request.post(`${env.baseURL}/v1/sessions/${sessionId}/start`)

  // Pause
  const pauseRes = await request.post(`${env.baseURL}/v1/sessions/${sessionId}/pause`)
  expect(pauseRes.status()).toBe(200)

  // Resume
  const resumeRes = await request.post(`${env.baseURL}/v1/sessions/${sessionId}/resume`)
  expect(resumeRes.status()).toBe(200)

  // Complete
  const completeRes = await request.post(`${env.baseURL}/v1/sessions/${sessionId}/complete`)
  expect(completeRes.status()).toBe(200)
})
