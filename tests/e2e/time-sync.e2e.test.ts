/**
 * E2E Test: Time Synchronization
 *
 * Tags: @smoke @api
 * Goal: Validate time synchronization endpoint for distributed clients
 *
 * Covered Endpoints:
 * - GET /v1/time
 *
 * Why This Matters:
 * - Critical for "Calculate, Don't Count" principle
 * - Ensures clients can sync their clocks with server
 * - Validates consistent time across distributed system
 */

import { test, expect } from '@playwright/test'
import { getEnvironment } from './setup/environments'

test.describe('Time Synchronization', () => {
  test('GET /v1/time returns server timestamp @smoke', async ({ request }) => {
    const env = getEnvironment()

    const beforeRequest = Date.now()
    const res = await request.get(`${env.baseURL}/v1/time`)
    const afterRequest = Date.now()

    expect(res.status()).toBe(200)

    const data = await res.json()

    // Validate response structure
    expect(data.timestamp_ms).toBeDefined()
    expect(typeof data.timestamp_ms).toBe('number')
    expect(data.server_version).toBe('2.0.0')
    expect(data.drift_tolerance_ms).toBe(50)

    // Validate timestamp is reasonable (within request window ± tolerance)
    const serverTime = data.timestamp_ms
    expect(serverTime).toBeGreaterThanOrEqual(beforeRequest - data.drift_tolerance_ms)
    expect(serverTime).toBeLessThanOrEqual(afterRequest + data.drift_tolerance_ms)

    console.log(`✅ Server time: ${serverTime}ms`)
    console.log(`✅ Client time: ${Date.now()}ms`)
    console.log(`✅ Drift tolerance: ±${data.drift_tolerance_ms}ms`)
  })

  test('time endpoint responds quickly (<50ms) @smoke', async ({ request }) => {
    const env = getEnvironment()

    const startTime = Date.now()
    const res = await request.get(`${env.baseURL}/v1/time`)
    const latency = Date.now() - startTime

    expect(res.status()).toBe(200)
    expect(latency).toBeLessThan(50) // Must be fast for accurate sync

    console.log(`✅ Time sync responded in ${latency}ms (<50ms target met)`)
  })

  test('time endpoint is consistent across multiple calls', async ({ request }) => {
    const env = getEnvironment()

    // Make 5 sequential calls
    const timestamps: number[] = []
    for (let i = 0; i < 5; i++) {
      const res = await request.get(`${env.baseURL}/v1/time`)
      const data = await res.json()
      timestamps.push(data.timestamp_ms)
      await new Promise(resolve => setTimeout(resolve, 10)) // 10ms between calls
    }

    // Timestamps should be monotonically increasing
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeGreaterThan(timestamps[i - 1])
    }

    console.log(`✅ Timestamps are monotonically increasing: ${timestamps.join(', ')}`)
  })

  test('time endpoint handles concurrent requests', async ({ request }) => {
    const env = getEnvironment()

    // Make 10 concurrent requests
    const promises = []
    for (let i = 0; i < 10; i++) {
      promises.push(request.get(`${env.baseURL}/v1/time`))
    }

    const results = await Promise.all(promises)

    // All should succeed
    results.forEach(res => {
      expect(res.status()).toBe(200)
    })

    // Extract timestamps
    const timestamps = await Promise.all(results.map(res => res.json()))

    // All timestamps should be within a reasonable range of each other
    const values = timestamps.map(t => t.timestamp_ms)
    const min = Math.min(...values)
    const max = Math.max(...values)
    const range = max - min

    // Range should be small (all requests happened nearly simultaneously)
    expect(range).toBeLessThan(100) // Within 100ms of each other

    console.log(`✅ 10 concurrent requests completed successfully`)
    console.log(`✅ Timestamp range: ${range}ms (<100ms)`)
  })

  test('time endpoint is not rate limited', async ({ request }) => {
    const env = getEnvironment()

    // Make 20 rapid requests (more than typical rate limit)
    const promises = []
    for (let i = 0; i < 20; i++) {
      promises.push(request.get(`${env.baseURL}/v1/time`))
    }

    const results = await Promise.all(promises)

    // All should succeed (not rate limited)
    results.forEach(res => {
      expect(res.status()).toBe(200)
    })

    console.log('✅ Time sync endpoint is not rate limited (as expected)')
  })

  test('time endpoint allows accurate client-side time calculation', async ({ request }) => {
    const env = getEnvironment()

    // Simulate NTP-style time sync
    const t0 = Date.now() // Client request time
    const res = await request.get(`${env.baseURL}/v1/time`)
    const t1 = Date.now() // Client response time

    const data = await res.json()
    const serverTime = data.timestamp_ms

    // Calculate round-trip time
    const roundTripTime = t1 - t0

    // Estimate server time at midpoint of request
    const estimatedServerTimeAtMidpoint = serverTime
    const clientTimeAtMidpoint = t0 + roundTripTime / 2

    // Calculate offset
    const offset = estimatedServerTimeAtMidpoint - clientTimeAtMidpoint

    console.log(`✅ Round-trip time: ${roundTripTime}ms`)
    console.log(`✅ Estimated client-server offset: ${offset}ms`)
    console.log(`✅ Client can adjust timestamps by offset for accurate sync`)

    // Offset should be reasonable (within drift tolerance)
    expect(Math.abs(offset)).toBeLessThan(data.drift_tolerance_ms + roundTripTime)
  })
})
