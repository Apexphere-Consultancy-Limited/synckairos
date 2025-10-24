# SyncKairos E2E Testing Overview

**Version:** 1.0
**Last Updated:** 2025-10-24
**Status:** Ready for Implementation
**Framework:** Playwright

---

## Executive Summary

This document provides a high-level overview of the End-to-End (E2E) testing strategy for SyncKairos v2.0. E2E tests validate the complete system from a client perspective against running instances (local, staging, production).

**Key Gap Addressed:** Current integration tests use test harnesses. E2E tests validate against real running instances with actual WebSocket connections, HTTP requests, and infrastructure dependencies.

---

## Related Documents

- **[Test Scenarios](./TEST_SCENARIOS.md)** - Detailed test scenarios with implementation examples
- **[Environment Configuration](./ENVIRONMENTS.md)** - Environment setup and configuration
- **[Execution Guide](./EXECUTION.md)** - How to run tests in different environments
- **[CI/CD Integration](./CICD.md)** - GitHub Actions workflows for automated testing

---

## Current Testing Landscape

### ✅ What We Have

1. **Unit Tests** (`tests/unit/`)
   - >80% code coverage
   - RedisStateManager, SyncEngine, DBWriteQueue
   - Edge cases and error handling

2. **Integration Tests** (`tests/integration/`)
   - API endpoint tests (Supertest)
   - WebSocket connection tests
   - Multi-instance synchronization
   - Full-stack tests using test harnesses

3. **Performance Tests** (`tests/performance/`)
   - RedisStateManager benchmarks
   - API performance tests
   - Multi-instance performance

### ❌ What's Missing (E2E Tests)

1. Tests against **running instances** (not test harnesses)
2. **Real WebSocket connections** from client perspective
3. **Production deployment validation** (Fly.io staging/production)
4. **Complete user journey scenarios**
5. **Cross-browser WebSocket testing**
6. **Multi-client real-time synchronization validation**

---

## E2E Testing Strategy

### Core Approach

**Single Test Suite, Multiple Execution Contexts:**

E2E tests are the same regardless of environment. The difference is in the **environment configuration** and **test selection** via tags, not separate test implementations.

**Test Execution Strategy:**
- **Local Development:** Run ALL tests (`@comprehensive`) against `localhost:3000`
- **Staging Deployment:** Run SUBSET (`@smoke`) against `https://synckairos-staging.fly.dev`
- **Production Deployment:** Run CRITICAL ONLY (`@critical`) against production

**Key Principle:** Same test code, different `baseURL` and tag filters.

### Tag-Based Test Selection

- `@critical` - Must pass for deployment (health checks, basic CRUD)
- `@smoke` - Quick sanity checks post-deployment (subset of @critical)
- `@comprehensive` - Detailed testing for local development (all scenarios)
- `@websocket` - WebSocket-specific tests
- `@api` - REST API tests

---

## Test Framework: Playwright

**Why Playwright:**
- ✅ Real browser automation (Chrome, Firefox, Safari)
- ✅ Native WebSocket support for real-time sync testing
- ✅ Multi-tab/multi-client testing (critical for sync validation)
- ✅ Video recording of failures for debugging
- ✅ Screenshots on error for CI/CD diagnostics
- ✅ Network request interception
- ✅ Parallel test execution
- ✅ Excellent debugging tools (`--ui`, `--debug` modes)

**Use Cases:**
- Session lifecycle testing
- Multi-client real-time synchronization
- WebSocket event validation
- Complete user journey scenarios
- Error handling from client perspective

**Example:**
```typescript
import { test, expect } from '@playwright/test'
import { getEnvironment } from './setup/environments'

test('Complete session lifecycle @critical @smoke', async ({ request, page }) => {
  const env = getEnvironment()

  // Create session via REST API
  const response = await request.post(`${env.baseURL}/v1/sessions`, {
    data: { /* ... */ }
  })
  expect(response.status()).toBe(201)

  // Connect WebSocket from browser context
  const ws = await page.evaluateHandle((wsURL) => {
    return new WebSocket(`${wsURL}?session_id=e2e-test-1`)
  }, env.wsURL)

  // Validate events...
})
```

---

## Test Structure

```
tests/e2e/
├── README.md                          # E2E test documentation
├── playwright.config.ts               # Playwright configuration with environments
├── setup/
│   ├── start-server.ts               # Helper to start server for E2E (optional)
│   ├── cleanup.ts                    # Test data cleanup utilities
│   └── environments.ts               # Environment configurations (local/staging/prod)
├── session-lifecycle.e2e.test.ts     # @critical @smoke
├── websocket-sync.e2e.test.ts        # @critical @smoke
├── multi-client.e2e.test.ts          # @comprehensive
├── health.e2e.test.ts                # @critical @smoke
├── error-handling.e2e.test.ts        # @comprehensive
├── rate-limiting.e2e.test.ts         # @comprehensive
└── edge-cases.e2e.test.ts            # @comprehensive
```

---

## Quick Start

### Setup
```bash
# Install Playwright
pnpm add -D @playwright/test
pnpm exec playwright install

# Create test structure
mkdir -p tests/e2e/setup
```

### Run Tests
```bash
# Local (all tests)
./scripts/start-local.sh
pnpm test:e2e:local

# Staging (smoke tests)
pnpm test:e2e:staging

# Production (critical only)
pnpm test:e2e:production

# Interactive UI mode
pnpm test:e2e:ui

# Debug mode
pnpm test:e2e:debug
```

---

## Key Test Scenarios

See **[Test Scenarios](./TEST_SCENARIOS.md)** for detailed implementations.

1. **Session Lifecycle** (@critical @smoke)
   - Create → Start → Switch → Complete flow
   - Validates state transitions and persistence

2. **Multi-Client Sync** (@comprehensive @websocket)
   - 3+ clients connected via WebSocket
   - Validates real-time event broadcasting

3. **Health Checks** (@critical @smoke)
   - `/health`, `/ready`, `/metrics` endpoints
   - Validates infrastructure connectivity

4. **Error Handling** (@comprehensive @api)
   - 404, 400, 409, 429 error scenarios
   - Validates error responses and messages

5. **Rate Limiting** (@comprehensive @api)
   - 100 req/min threshold validation
   - Validates 429 responses

6. **Edge Cases** (@comprehensive)
   - Single participant, 100 participants
   - Unicode IDs, zero-duration, etc.

---

## Success Criteria

### E2E Test Coverage
- ✅ All 8 REST API endpoints tested E2E
- ✅ All WebSocket events tested
- ✅ Multi-client synchronization validated
- ✅ Complete session lifecycle covered
- ✅ Error handling tested from client perspective
- ✅ Deployment smoke tests pass on staging/production

### Functional Targets
- ✅ All critical paths validated (@critical tests pass)
- ✅ Session state transitions correct (pending → running → completed)
- ✅ Multi-client broadcast works correctly
- ✅ Error responses have correct status codes and messages
- ✅ Health endpoints return expected responses

### Reliability Targets
- ✅ E2E test success rate: >99%
- ✅ Zero flaky tests (runs pass consistently)
- ✅ Tests complete in <10 minutes
- ✅ Test failures provide actionable diagnostics

---

## Implementation Phases

### Phase 1: Foundation (Week 1)
- [ ] Set up Playwright with environment configuration
- [ ] Create E2E test structure (`tests/e2e/`)
- [ ] Implement environment configuration (`setup/environments.ts`)
- [ ] Implement Scenario 1: Session Lifecycle (@critical @smoke)
- [ ] Implement Scenario 3: Health Check (@critical @smoke)
- [ ] CI/CD integration for local E2E tests

### Phase 2: Real-Time Testing (Week 2)
- [ ] Implement Scenario 2: Multi-Client Sync (@comprehensive)
- [ ] Implement Scenario 4: Error Handling (@comprehensive)
- [ ] Add rate limiting tests (@comprehensive)
- [ ] Add test data cleanup utilities
- [ ] Add edge case tests (@comprehensive)

### Phase 3: Deployment Testing (Week 3)
- [ ] Implement staging smoke tests workflow
- [ ] Implement production critical tests workflow
- [ ] Add deployment validation
- [ ] Full CI/CD pipeline integration (local → staging → production)
- [ ] Documentation and runbook for E2E testing

---

## Maintenance & Best Practices

### Test Data Management
- Use unique session IDs per test: `e2e-${testName}-${timestamp}`
- Clean up test sessions after each test
- Use test database separate from development
- Reset Redis/PostgreSQL state between test runs

### Debugging Failed Tests
- Playwright video recordings available in `test-results/`
- Console logs captured for all tests
- Network requests logged
- Screenshots on failure
- Test retry on flakiness (max 2 retries)

### Test Reliability Monitoring
- Track E2E test duration over time
- Monitor test success rate (target: >99%)
- Track flaky test rate (target: 0%)
- Alert on test execution time increases (>10% degradation)

---

## Resources & References

### Documentation
- [Test Scenarios](./TEST_SCENARIOS.md) - Detailed test implementations
- [Execution Guide](./EXECUTION.md) - Running tests in different environments
- [Environment Configuration](./ENVIRONMENTS.md) - Setup and configuration
- [Testing Requirements](../../../.claude/skills/tester/references/testing_requirements.md)
- [API Documentation](../../api/README.md)
- [WebSocket Protocol](../../architecture/WEBSOCKET_PROTOCOL.md)

### Tools
- [Playwright Documentation](https://playwright.dev/)
- [Playwright Best Practices](https://playwright.dev/docs/best-practices)

### Examples
- Integration tests: `tests/integration/api-full-stack.test.ts`
- WebSocket tests: `tests/integration/websocket.test.ts`
- Multi-instance tests: `tests/integration/api-multi-instance.test.ts`

---

**Next Steps:** Begin Phase 1 - Set up Playwright and implement foundation tests

See **[Test Scenarios](./TEST_SCENARIOS.md)** for detailed scenario implementations and code examples.
