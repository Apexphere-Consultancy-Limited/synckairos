/**
 * E2E Test: Health Check
 *
 * Tags: @critical @smoke
 * Goal: Validate health endpoint (documented in OpenAPI spec)
 *
 * Covered Endpoints:
 * - GET /health
 *
 * Note: /ready and /metrics are infrastructure endpoints (not part of API contract)
 */

import { test, expect } from '@playwright/test'
import { getEnvironment } from './setup/environments'
import { HealthResponseSchema } from '../../src/api/schemas/session'

test('health endpoint @critical @smoke', async ({ request }) => {
  const env = getEnvironment()

  // Test /health endpoint with latency measurement
  const healthStartTime = Date.now()
  const healthRes = await request.get(`${env.baseURL}/health`)
  const healthLatency = Date.now() - healthStartTime

  expect(healthRes.status()).toBe(200)
  const healthJson = await healthRes.json()

  // Validate with Zod schema
  const healthResult = HealthResponseSchema.safeParse(healthJson)
  expect(healthResult.success).toBe(true)

  const healthData = healthResult.data!
  expect(healthData.status).toBe('ok')
  expect(healthLatency).toBeLessThan(500) // E2E: Allow 500ms for Playwright HTTP client + network overhead

  console.log(`✅ /health responded in ${healthLatency}ms (<500ms E2E target met)`)
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

  // Total time for 10 concurrent requests should be <1000ms (E2E overhead)
  expect(totalTime).toBeLessThan(1000)

  console.log(`✅ 10 concurrent health checks completed in ${totalTime}ms (<1000ms E2E target met)`)
})
