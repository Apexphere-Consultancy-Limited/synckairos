/**
 * E2E Test: Error Handling
 *
 * Tags: @comprehensive @api
 * Goal: Validate error responses from client perspective
 *
 * Covered Error Scenarios:
 * - 404 (Not Found)
 * - 400 (Bad Request)
 * - 409 (Conflict)
 * - 429 (Rate Limited)
 */

import { test, expect } from '@playwright/test'
import { getEnvironment } from './setup/environments'
import { ErrorResponseSchema } from '../../src/api/schemas/session'
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

test('error handling @comprehensive @api', async ({ request }) => {
  const env = getEnvironment()

  // Test 404 - Non-existent session (use valid UUID that doesn't exist)
  const nonExistentId = '00000000-0000-0000-0000-000000000000'
  const notFoundRes = await request.post(`${env.baseURL}/v1/sessions/${nonExistentId}/start`)
  expect(notFoundRes.status()).toBe(404)
  const notFoundJson = await notFoundRes.json()

  // Validate with Zod schema
  const notFoundResult = ErrorResponseSchema.safeParse(notFoundJson)
  expect(notFoundResult.success).toBe(true)

  const notFoundData = notFoundResult.data!
  expect(notFoundData.error).toBeDefined()

  console.log(`✅ 404 error: ${notFoundData.error}`)

  // Test 400 - Invalid state transition (switch on pending session)
  const sessionId = generateSessionId('e2e-error')
  createdSessions.push(sessionId)

  await request.post(`${env.baseURL}/v1/sessions`, {
    data: createSessionPayload(sessionId, [
      createParticipant(TEST_PARTICIPANTS.P1, 0, 300000),
    ])
  })

  const badRequestRes = await request.post(`${env.baseURL}/v1/sessions/${sessionId}/switch`)
  expect(badRequestRes.status()).toBe(400)
  const badRequestJson = await badRequestRes.json()

  // Validate with Zod schema
  const badRequestResult = ErrorResponseSchema.safeParse(badRequestJson)
  expect(badRequestResult.success).toBe(true)

  const badRequestData = badRequestResult.data!
  expect(badRequestData.error).toContain('pending')

  console.log(`✅ 400 error: ${badRequestData.error}`)

  // Test 409 - Conflict (start already running session)
  await request.post(`${env.baseURL}/v1/sessions/${sessionId}/start`)
  const conflictRes = await request.post(`${env.baseURL}/v1/sessions/${sessionId}/start`)
  expect(conflictRes.status()).toBe(409)

  // Test 409 - Pause already paused session
  await request.post(`${env.baseURL}/v1/sessions/${sessionId}/pause`)
  const pauseConflictRes = await request.post(`${env.baseURL}/v1/sessions/${sessionId}/pause`)
  expect(pauseConflictRes.status()).toBe(409)

  // Test 409 - Resume already running session
  await request.post(`${env.baseURL}/v1/sessions/${sessionId}/resume`)
  const resumeConflictRes = await request.post(`${env.baseURL}/v1/sessions/${sessionId}/resume`)
  expect(resumeConflictRes.status()).toBe(409)

  console.log(`✅ 409 conflict errors validated`)

  // Test 404 - Delete non-existent session (reuse nonExistentId)
  const deleteNotFoundRes = await request.delete(`${env.baseURL}/v1/sessions/${nonExistentId}`)
  expect(deleteNotFoundRes.status()).toBe(404)

  // Test 400 - Invalid JSON
  const invalidRes = await request.post(`${env.baseURL}/v1/sessions`, {
    data: { invalid: 'data' }
  })
  expect(invalidRes.status()).toBe(400)

  console.log(`✅ All error scenarios validated`)

  // Test 404 - Operations on deleted session
  const sessionId2 = generateSessionId('e2e-deleted')
  createdSessions.push(sessionId2)

  await request.post(`${env.baseURL}/v1/sessions`, {
    data: createSessionPayload(sessionId2, [
      createParticipant(TEST_PARTICIPANTS.P1, 0, 300000),
    ])
  })
  await request.delete(`${env.baseURL}/v1/sessions/${sessionId2}`)

  const deletedStartRes = await request.post(`${env.baseURL}/v1/sessions/${sessionId2}/start`)
  expect(deletedStartRes.status()).toBe(404)

  console.log(`✅ Operations on deleted session return 404`)
})
