/**
 * E2E Test: Delete Session Operations
 *
 * Tags: @comprehensive @api
 * Goal: Validate session deletion and subsequent operations
 *
 * Covered Endpoints:
 * - DELETE /v1/sessions/:id
 */

import { test, expect } from '@playwright/test'
import { getEnvironment } from './setup/environments'

const createdSessions: string[] = []

test.afterEach(async ({ request }) => {
  const env = getEnvironment()
  for (const sessionId of createdSessions) {
    try {
      await request.delete(`${env.baseURL}/v1/sessions/${sessionId}`)
      console.log(`🧹 Cleaned up session: ${sessionId}`)
    } catch (error) {
      // Session might already be deleted in the test - that's ok
    }
  }
  createdSessions.length = 0
})

test('delete session lifecycle @comprehensive @api', async ({ request }) => {
  const env = getEnvironment()
  const sessionId = `e2e-delete-${Date.now()}`
  createdSessions.push(sessionId)

  // Create session
  await request.post(`${env.baseURL}/v1/sessions`, {
    data: {
      session_id: sessionId,
      sync_mode: 'per_participant',
      participants: [{ participant_id: 'p1', total_time_ms: 300000 }]
    }
  })

  // Delete session
  const deleteRes = await request.delete(`${env.baseURL}/v1/sessions/${sessionId}`)
  expect(deleteRes.status()).toBe(204)

  console.log(`✅ Session deleted successfully`)

  // Verify 404 on subsequent GET
  const getRes = await request.get(`${env.baseURL}/v1/sessions/${sessionId}`)
  expect(getRes.status()).toBe(404)

  // Verify operations on deleted session fail with 404
  const startRes = await request.post(`${env.baseURL}/v1/sessions/${sessionId}/start`)
  expect(startRes.status()).toBe(404)

  const switchRes = await request.post(`${env.baseURL}/v1/sessions/${sessionId}/switch`)
  expect(switchRes.status()).toBe(404)

  console.log(`✅ All operations on deleted session return 404`)
})

test('delete running session @comprehensive', async ({ request }) => {
  const env = getEnvironment()
  const sessionId = `e2e-delete-running-${Date.now()}`
  createdSessions.push(sessionId)

  await request.post(`${env.baseURL}/v1/sessions`, {
    data: {
      session_id: sessionId,
      sync_mode: 'per_participant',
      participants: [{ participant_id: 'p1', total_time_ms: 300000 }]
    }
  })

  await request.post(`${env.baseURL}/v1/sessions/${sessionId}/start`)

  // Delete running session - should succeed
  const deleteRes = await request.delete(`${env.baseURL}/v1/sessions/${sessionId}`)
  expect(deleteRes.status()).toBe(204)

  // Verify session is gone
  const getRes = await request.get(`${env.baseURL}/v1/sessions/${sessionId}`)
  expect(getRes.status()).toBe(404)

  console.log(`✅ Running session deleted successfully`)
})

test('delete completed session @comprehensive', async ({ request }) => {
  const env = getEnvironment()
  const sessionId = `e2e-delete-completed-${Date.now()}`
  createdSessions.push(sessionId)

  await request.post(`${env.baseURL}/v1/sessions`, {
    data: {
      session_id: sessionId,
      sync_mode: 'per_participant',
      participants: [{ participant_id: 'p1', total_time_ms: 300000 }]
    }
  })

  await request.post(`${env.baseURL}/v1/sessions/${sessionId}/start`)
  await request.post(`${env.baseURL}/v1/sessions/${sessionId}/complete`)

  // Delete completed session - should succeed
  const deleteRes = await request.delete(`${env.baseURL}/v1/sessions/${sessionId}`)
  expect(deleteRes.status()).toBe(204)

  console.log(`✅ Completed session deleted successfully`)
})

test('delete non-existent session @comprehensive', async ({ request }) => {
  const env = getEnvironment()

  // Try to delete non-existent session
  const deleteRes = await request.delete(`${env.baseURL}/v1/sessions/nonexistent`)
  expect(deleteRes.status()).toBe(404)
  const errorData = await deleteRes.json()
  expect(errorData.error).toBeDefined()

  console.log(`✅ Delete non-existent session returns 404: ${errorData.error}`)
})
