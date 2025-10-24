/**
 * E2E Test: Health Check
 *
 * Tags: @critical @smoke
 * Goal: Validate health endpoint
 *
 * Covered Endpoints:
 * - GET /health
 *
 * Note: /ready and /metrics are infrastructure endpoints (not part of API contract)
 */

import { test, expect } from '@playwright/test'
import { getEnvironment } from './setup/environments'

test('health endpoint @critical @smoke', async ({ request }) => {
  const env = getEnvironment()

  // Test /health endpoint with latency measurement
  const healthStartTime = Date.now()
  const healthRes = await request.get(`${env.baseURL}/health`)
  const healthLatency = Date.now() - healthStartTime

  expect(healthRes.status()).toBe(200)
  const healthData = await healthRes.json()

  // Validate response structure
  expect(healthData).toHaveProperty('status', 'ok')
  expect(healthLatency).toBeLessThan(50) // Health check should be <50ms (accounts for network latency)

  console.log(`✅ /health responded in ${healthLatency}ms (<50ms target met)`)
})

test('health endpoint returns quickly under load @critical', async ({ request }) => {
  const env = getEnvironment()

  // Make 10 concurrent health check requests
  const promises = []
  for (let i = 0; i < 10; i++) {
    promises.push(request.get(`${env.baseURL}/health`))
  }

  const startTime = Date.now()
  const results = await Promise.all(promises)
  const totalTime = Date.now() - startTime

  // All should succeed
  results.forEach(res => {
    expect(res.status()).toBe(200)
  })

  // Total time for 10 concurrent requests should be <100ms
  expect(totalTime).toBeLessThan(100)

  console.log(`✅ 10 concurrent health checks completed in ${totalTime}ms`)
})
