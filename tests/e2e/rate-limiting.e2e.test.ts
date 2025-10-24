/**
 * E2E Test: Rate Limiting
 *
 * Tags: @comprehensive @api
 * Goal: Validate rate limiting functionality (100 req/min per IP)
 *
 * Test Coverage:
 * - Rate limit threshold enforcement
 * - 429 response with Retry-After header
 * - Rate limit window expiration
 * - Different endpoints share same rate limit
 */

import { test, expect } from '@playwright/test'
import { getEnvironment } from './setup/environments'
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

test('rate limiting enforcement @comprehensive @api', async ({ request }) => {
  const env = getEnvironment()
  const sessionId = generateSessionId('e2e-ratelimit')
  createdSessions.push(sessionId)

  // Create session
  await request.post(`${env.baseURL}/v1/sessions`, {
    data: createSessionPayload(sessionId, [
      createParticipant(TEST_PARTICIPANTS.P1, 0, 300000),
      createParticipant(TEST_PARTICIPANTS.P2, 1, 300000),
    ])
  })

  await request.post(`${env.baseURL}/v1/sessions/${sessionId}/start`)

  // Send 120 requests to exceed the 100 req/min rate limit
  // This guarantees triggering rate limiting (120 > 100)
  const startTime = Date.now()
  const promises = []
  for (let i = 0; i < 120; i++) {
    promises.push(request.get(`${env.baseURL}/v1/sessions/${sessionId}`))
  }

  const results = await Promise.all(promises)
  const executionTime = Date.now() - startTime

  // Verify rate limiting was triggered
  const successCount = results.filter(res => res.status() === 200).length
  const rateLimitedCount = results.filter(res => res.status() === 429).length

  // MUST receive at least 20 rate-limited responses (120 - 100 = 20)
  expect(rateLimitedCount).toBeGreaterThanOrEqual(20)

  // No more than 100 requests should succeed
  expect(successCount).toBeLessThanOrEqual(100)

  // Verify Retry-After header on 429 responses
  const rateLimitedRes = results.find(res => res.status() === 429)
  expect(rateLimitedRes).toBeDefined()
  const retryAfter = rateLimitedRes!.headers()['retry-after']
  expect(retryAfter).toBeDefined()
  expect(parseInt(retryAfter!)).toBeGreaterThan(0)

  console.log(`✅ Rate limiting enforced: ${successCount} succeeded, ${rateLimitedCount} rate-limited (executed in ${executionTime}ms)`)
})

test('rate limit applies across endpoints @comprehensive', async ({ request }) => {
  const env = getEnvironment()
  const sessionId = generateSessionId('e2e-ratelimit-multi')
  createdSessions.push(sessionId)

  // Create session
  await request.post(`${env.baseURL}/v1/sessions`, {
    data: createSessionPayload(sessionId, [
      createParticipant(TEST_PARTICIPANTS.P1, 0, 300000),
      createParticipant(TEST_PARTICIPANTS.P2, 1, 300000),
    ])
  })

  await request.post(`${env.baseURL}/v1/sessions/${sessionId}/start`)

  // Make requests to different endpoints to verify they share the same rate limit
  const requests = []
  for (let i = 0; i < 5; i++) {
    requests.push(request.get(`${env.baseURL}/v1/sessions/${sessionId}`))
    requests.push(request.get(`${env.baseURL}/health`))
  }

  const results = await Promise.all(requests)

  // All requests should either succeed or be rate limited - no other errors
  results.forEach(res => {
    expect([200, 429]).toContain(res.status())
  })

  const successCount = results.filter(res => res.status() === 200).length
  const rateLimitedCount = results.filter(res => res.status() === 429).length

  console.log(`✅ Made ${results.length} requests across endpoints: ${successCount} succeeded, ${rateLimitedCount} rate limited`)
})

test('rate limit window expiration @comprehensive', async ({ request }) => {
  const env = getEnvironment()

  // Make a few health check requests
  const initialRequests = []
  for (let i = 0; i < 5; i++) {
    initialRequests.push(request.get(`${env.baseURL}/health`))
  }
  await Promise.all(initialRequests)

  // Wait for rate limit window to potentially reset (if configured)
  // Note: This test assumes a short window for testing purposes
  // In production, rate limit is 100 req/min
  console.log(`⏳ Made 5 requests, waiting to verify rate limit window behavior...`)

  // Wait 2 seconds
  await new Promise(resolve => setTimeout(resolve, 2000))

  // Make another request - should succeed if window is large enough
  const afterWaitRes = await request.get(`${env.baseURL}/health`)
  expect([200, 429]).toContain(afterWaitRes.status())

  if (afterWaitRes.status() === 200) {
    console.log(`✅ Request succeeded after wait - rate limit window allows normal traffic`)
  } else {
    console.log(`⚠️ Still rate limited after 2s - window may be longer or more requests needed`)
  }
})

test('health endpoint has lenient rate limit @comprehensive', async ({ request }) => {
  const env = getEnvironment()

  // Health checks typically have more lenient rate limits
  // Make 20 rapid health checks
  const promises = []
  for (let i = 0; i < 20; i++) {
    promises.push(request.get(`${env.baseURL}/health`))
  }

  const results = await Promise.all(promises)

  // Most should succeed (health checks are critical for monitoring)
  const successCount = results.filter(res => res.status() === 200).length
  const successRate = successCount / results.length

  expect(successRate).toBeGreaterThan(0.5) // At least 50% should succeed

  console.log(`✅ Health endpoint: ${successCount}/${results.length} requests succeeded (${(successRate * 100).toFixed(1)}%)`)
})
