/**
 * E2E Test: Edge Cases
 *
 * Tags: @comprehensive
 * Goal: Validate system handles edge cases correctly
 *
 * Test Cases:
 * - Single participant sessions
 * - Sessions with 100 participants
 * - Very long session IDs
 * - Unicode participant IDs
 * - Time expiration edge cases
 * - Concurrent operations
 * - Invalid state transitions
 */

import { test, expect } from '@playwright/test'
import { getEnvironment } from './setup/environments'
import {
  SessionResponseSchema,
  SwitchCycleResponseSchema,
} from '../../src/types/api-contracts'

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

test('single participant session @comprehensive', async ({ request }) => {
  const env = getEnvironment()
  const sessionId = `e2e-single-${Date.now()}`
  createdSessions.push(sessionId)

  // Create session with 1 participant
  await request.post(`${env.baseURL}/v1/sessions`, {
    data: {
      session_id: sessionId,
      sync_mode: 'per_participant',
      participants: [{ participant_id: 'p1', total_time_ms: 300000 }]
    }
  })

  await request.post(`${env.baseURL}/v1/sessions/${sessionId}/start`)

  // Switch should work but stay on same participant
  const switchRes = await request.post(`${env.baseURL}/v1/sessions/${sessionId}/switch`)
  expect(switchRes.status()).toBe(200)
  const switchJson = await switchRes.json()

  // Validate with Zod schema
  const switchResult = SwitchCycleResponseSchema.safeParse(switchJson)
  expect(switchResult.success).toBe(true)

  const switchData = switchResult.data!
  expect(switchData.new_active_participant_id).toBe('p1')

  console.log(`✅ Single participant session handles switch correctly`)
})

test('session with 100 participants @comprehensive', async ({ request }) => {
  const env = getEnvironment()
  const sessionId = `e2e-many-${Date.now()}`
  createdSessions.push(sessionId)

  // Create session with 100 participants
  const participants = []
  for (let i = 1; i <= 100; i++) {
    participants.push({ participant_id: `p${i}`, total_time_ms: 300000 })
  }

  const createRes = await request.post(`${env.baseURL}/v1/sessions`, {
    data: {
      session_id: sessionId,
      sync_mode: 'per_participant',
      participants
    }
  })
  expect(createRes.status()).toBe(201)

  await request.post(`${env.baseURL}/v1/sessions/${sessionId}/start`)

  // Switch multiple times
  for (let i = 0; i < 5; i++) {
    const switchRes = await request.post(`${env.baseURL}/v1/sessions/${sessionId}/switch`)
    expect(switchRes.status()).toBe(200)
  }

  console.log(`✅ Session with 100 participants handled successfully`)
})

test('very long session ID @comprehensive', async ({ request }) => {
  const env = getEnvironment()
  // 255 character session ID
  const sessionId = 'e2e-' + 'x'.repeat(251)
  createdSessions.push(sessionId)

  const createRes = await request.post(`${env.baseURL}/v1/sessions`, {
    data: {
      session_id: sessionId,
      sync_mode: 'per_participant',
      participants: [{ participant_id: 'p1', total_time_ms: 300000 }]
    }
  })
  expect(createRes.status()).toBe(201)

  console.log(`✅ Very long session ID (255 chars) accepted`)
})

test('unicode participant IDs @comprehensive', async ({ request }) => {
  const env = getEnvironment()
  const sessionId = `e2e-unicode-${Date.now()}`
  createdSessions.push(sessionId)

  const createRes = await request.post(`${env.baseURL}/v1/sessions`, {
    data: {
      session_id: sessionId,
      sync_mode: 'per_participant',
      participants: [
        { participant_id: '参加者1', total_time_ms: 300000 },
        { participant_id: 'مشارك٢', total_time_ms: 300000 },
        { participant_id: '参加者👤', total_time_ms: 300000 }
      ]
    }
  })
  expect(createRes.status()).toBe(201)

  await request.post(`${env.baseURL}/v1/sessions/${sessionId}/start`)
  const switchRes = await request.post(`${env.baseURL}/v1/sessions/${sessionId}/switch`)
  expect(switchRes.status()).toBe(200)

  console.log(`✅ Unicode participant IDs handled correctly`)
})

test('time expiration edge case @comprehensive', async ({ request }) => {
  const env = getEnvironment()
  const sessionId = `e2e-expire-${Date.now()}`
  createdSessions.push(sessionId)

  // Create session with very short duration for p1
  await request.post(`${env.baseURL}/v1/sessions`, {
    data: {
      session_id: sessionId,
      sync_mode: 'per_participant',
      participants: [
        { participant_id: 'p1', total_time_ms: 100 }, // 100ms - very short
        { participant_id: 'p2', total_time_ms: 300000 }
      ]
    }
  })

  await request.post(`${env.baseURL}/v1/sessions/${sessionId}/start`)

  // Wait for p1's time to expire
  await new Promise(resolve => setTimeout(resolve, 200))

  // Get state - should handle time expiration gracefully
  const getRes = await request.get(`${env.baseURL}/v1/sessions/${sessionId}`)
  const stateJson = await getRes.json()

  // Validate with Zod schema
  const stateResult = SessionResponseSchema.safeParse(stateJson)
  expect(stateResult.success).toBe(true)

  const state = stateResult.data!
  // Verify system handled time expiration gracefully
  expect(state.status).toBe('running')
  expect(state.time_remaining_ms).toBeLessThanOrEqual(0)

  console.log(`✅ Time expiration handled gracefully`)
})

test('concurrent switchCycle operations @comprehensive', async ({ request }) => {
  const env = getEnvironment()
  const sessionId = `e2e-concurrent-${Date.now()}`
  createdSessions.push(sessionId)

  await request.post(`${env.baseURL}/v1/sessions`, {
    data: {
      session_id: sessionId,
      sync_mode: 'per_participant',
      participants: [
        { participant_id: 'p1', total_time_ms: 300000 },
        { participant_id: 'p2', total_time_ms: 300000 }
      ]
    }
  })

  await request.post(`${env.baseURL}/v1/sessions/${sessionId}/start`)

  // Fire 5 concurrent switch requests
  const promises = []
  for (let i = 0; i < 5; i++) {
    promises.push(request.post(`${env.baseURL}/v1/sessions/${sessionId}/switch`))
  }

  const results = await Promise.all(promises)

  // Count success vs conflict responses
  const successCount = results.filter(res => res.status() === 200).length
  const conflictCount = results.filter(res => res.status() === 409).length

  // All should succeed or fail with 409 (optimistic locking)
  results.forEach(res => {
    expect([200, 409]).toContain(res.status())
  })

  // Optimistic locking should cause MOST requests to fail with 409
  // Only 1-2 should succeed due to race conditions
  expect(successCount).toBeLessThanOrEqual(2)
  expect(conflictCount).toBeGreaterThanOrEqual(3)

  // Final state should be consistent
  const getRes = await request.get(`${env.baseURL}/v1/sessions/${sessionId}`)
  const stateJson = await getRes.json()

  // Validate with Zod schema
  const stateResult = SessionResponseSchema.safeParse(stateJson)
  expect(stateResult.success).toBe(true)

  const state = stateResult.data!
  expect(['p1', 'p2']).toContain(state.active_participant_id)

  console.log(`✅ Concurrent operations handled safely: ${successCount} succeeded, ${conflictCount} failed with 409 (optimistic locking verified)`)
})

test('complete session without starting @comprehensive', async ({ request }) => {
  const env = getEnvironment()
  const sessionId = `e2e-complete-pending-${Date.now()}`
  createdSessions.push(sessionId)

  await request.post(`${env.baseURL}/v1/sessions`, {
    data: {
      session_id: sessionId,
      sync_mode: 'per_participant',
      participants: [{ participant_id: 'p1', total_time_ms: 300000 }]
    }
  })

  // Complete without starting - implementation allows this (no status validation)
  const completeRes = await request.post(`${env.baseURL}/v1/sessions/${sessionId}/complete`)
  expect(completeRes.status()).toBe(200)
  const data = await completeRes.json()
  expect(data.data.status).toBe('completed')

  console.log(`✅ Complete without start succeeds (implementation allows completing from any status)`)
})
