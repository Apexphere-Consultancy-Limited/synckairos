/**
 * E2E Test: Pause and Resume Operations
 *
 * Tags: @comprehensive @api
 * Goal: Validate pause and resume functionality preserves time_remaining correctly
 *
 * Covered Endpoints:
 * - POST /v1/sessions/:id/pause
 * - POST /v1/sessions/:id/resume
 */

import { test, expect } from '@playwright/test'
import { getEnvironment } from './setup/environments'
import { SessionResponseSchema } from '../../src/api/schemas/session'
import { generateSessionId, createParticipant, createSessionPayload, TEST_PARTICIPANTS } from './test-utils'

const createdSessions: string[] = []

test.afterEach(async ({ request }) => {
  const env = getEnvironment()
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

test('pause and resume session @comprehensive @api', async ({ request }) => {
  const env = getEnvironment()
  const sessionId = generateSessionId('e2e-pause')
  createdSessions.push(sessionId)

  // Create and start session
  await request.post(`${env.baseURL}/v1/sessions`, {
    data: createSessionPayload(sessionId, [
      createParticipant(TEST_PARTICIPANTS.P1, 0, 300000),
      createParticipant(TEST_PARTICIPANTS.P2, 1, 300000),
    ])
  })

  await request.post(`${env.baseURL}/v1/sessions/${sessionId}/start`)

  // Wait 2 seconds then pause
  await new Promise(resolve => setTimeout(resolve, 2000))

  const pauseRes = await request.post(`${env.baseURL}/v1/sessions/${sessionId}/pause`)
  expect(pauseRes.status()).toBe(200)
  const pausedJson = await pauseRes.json()

  // Validate with Zod schema
  const pausedResult = SessionResponseSchema.safeParse(pausedJson)
  expect(pausedResult.success).toBe(true)

  const { data: pausedState } = pausedResult.data!
  expect(pausedState.status).toBe('paused')

  // Get time_remaining from the active participant
  const activeParticipant = pausedState.participants.find(p => p.is_active)
  expect(activeParticipant).toBeDefined()
  const savedTimeRemaining = activeParticipant!.time_remaining_ms

  // Verify time_remaining is approximately 298000ms (300000 - 2000)
  expect(savedTimeRemaining).toBeLessThan(300000)
  expect(savedTimeRemaining).toBeGreaterThan(295000)

  console.log(`✅ Paused with ${savedTimeRemaining}ms remaining`)

  // Wait 1 second while paused
  await new Promise(resolve => setTimeout(resolve, 1000))

  // Resume and verify time_remaining didn't change
  const resumeRes = await request.post(`${env.baseURL}/v1/sessions/${sessionId}/resume`)
  expect(resumeRes.status()).toBe(200)
  const resumedJson = await resumeRes.json()

  // Validate with Zod schema
  const resumedResult = SessionResponseSchema.safeParse(resumedJson)
  expect(resumedResult.success).toBe(true)

  const { data: resumedState } = resumedResult.data!
  expect(resumedState.status).toBe('running')

  // Get time_remaining from the active participant after resume
  const resumedActiveParticipant = resumedState.participants.find(p => p.is_active)
  expect(resumedActiveParticipant).toBeDefined()
  const resumedTimeRemaining = resumedActiveParticipant!.time_remaining_ms

  // Time remaining should be approximately the same (±50ms tolerance)
  expect(Math.abs(resumedTimeRemaining - savedTimeRemaining)).toBeLessThan(50)

  console.log(`✅ Resumed with ${resumedTimeRemaining}ms remaining after 1s pause (±50ms tolerance met)`)

  // Continue session to verify it works after resume
  const switchRes = await request.post(`${env.baseURL}/v1/sessions/${sessionId}/switch`)
  expect(switchRes.status()).toBe(200)
  const switchJson = await switchRes.json()

  // Switch response has { data: { active_participant_id, ... } }
  expect(switchJson.data.active_participant_id).toBe(TEST_PARTICIPANTS.P2)

  console.log(`✅ Session continues normally after resume`)
})

test('pause during cycle transition @comprehensive', async ({ request }) => {
  const env = getEnvironment()
  const sessionId = generateSessionId('e2e-pause-transition')
  createdSessions.push(sessionId)

  await request.post(`${env.baseURL}/v1/sessions`, {
    data: createSessionPayload(sessionId, [
      createParticipant(TEST_PARTICIPANTS.P1, 0, 300000),
      createParticipant(TEST_PARTICIPANTS.P2, 1, 300000),
    ])
  })

  await request.post(`${env.baseURL}/v1/sessions/${sessionId}/start`)

  // Fire switch and pause concurrently
  const [switchRes, pauseRes] = await Promise.all([
    request.post(`${env.baseURL}/v1/sessions/${sessionId}/switch`),
    request.post(`${env.baseURL}/v1/sessions/${sessionId}/pause`)
  ])

  // Both should succeed or one should fail gracefully
  expect([200, 409]).toContain(switchRes.status())
  expect([200, 409]).toContain(pauseRes.status())

  // Final state should be consistent
  const getRes = await request.get(`${env.baseURL}/v1/sessions/${sessionId}`)
  const stateResponse = await getRes.json()
  const state = stateResponse.data
  expect(['running', 'paused']).toContain(state.status)

  console.log(`✅ Concurrent pause/switch handled gracefully (final status: ${state.status})`)
})
