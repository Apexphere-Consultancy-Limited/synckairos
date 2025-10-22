# Task 3.5: Load Testing with k6

**Phase:** 3 - Testing & Quality
**Component:** Load Testing (Performance Validation)
**Priority:** ⭐ **CRITICAL PATH**
**Estimated Time:** 1-2 days (8-16 hours)
**Status:** ⚪ Pending
**Dependencies:** Phase 2 complete (all components operational)

---

## Objective

Validate SyncKairos v2.0 performance under realistic load conditions using k6. Ensure the system meets all performance targets with 10,000+ concurrent sessions and validates the distributed-first architecture under stress.

**Key Focus:** Prove the system can handle production-scale load with <50ms switchCycle p95 and <100ms WebSocket delivery p95.

---

## Success Criteria

- [ ] ✅ 10,000+ concurrent sessions supported without errors
- [ ] ✅ switchCycle() p95 latency <50ms under load
- [ ] ✅ WebSocket delivery p95 <100ms under load
- [ ] ✅ No errors under peak load (10k sessions)
- [ ] ✅ Memory usage stable (no leaks in 5-minute sustained load)
- [ ] ✅ DBWriteQueue processes writes without unbounded growth
- [ ] ✅ Redis operations <5ms (p95)
- [ ] ✅ All load test scenarios documented with results
- [ ] ✅ Performance comparison against targets completed
- [ ] ✅ Bottlenecks identified and documented (if any)

---

## Day 1: Setup & Scenario Creation (8 hours)

### Morning: Environment Setup (2 hours)

#### 1. Install k6 (15 minutes)

**macOS:**
```bash
brew install k6
```

**Linux:**
```bash
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6
```

**Verify installation:**
```bash
k6 version
```

#### 2. Create Directory Structure (5 minutes)

```bash
mkdir -p tests/load/scenarios
mkdir -p tests/load/utils
mkdir -p tests/load/config
```

**File Structure:**
```
tests/load/
├── scenarios/
│   ├── 01-baseline.js
│   ├── 02-concurrent-sessions-1k.js
│   ├── 03-concurrent-sessions-10k.js
│   ├── 04-high-frequency-switching.js
│   ├── 05-websocket-stress.js
│   └── 06-sustained-load.js
├── utils/
│   ├── generators.js
│   └── assertions.js
└── config/
    └── thresholds.js
```

#### 3. Add Gauge Metrics to Application (1.5 hours)

**File:** `src/api/middlewares/metrics.ts`

Add the following metrics:

```typescript
import promClient from 'prom-client'

// Active sessions gauge
export const activeSessions = new promClient.Gauge({
  name: 'synckairos_active_sessions',
  help: 'Current number of active sessions in Redis',
  registers: [register],
})

// WebSocket connections gauge
export const websocketConnections = new promClient.Gauge({
  name: 'synckairos_websocket_connections',
  help: 'Current number of WebSocket connections',
  registers: [register],
})

// DBWriteQueue size gauge
export const dbWriteQueueSize = new promClient.Gauge({
  name: 'synckairos_db_write_queue_size',
  help: 'Current depth of DBWriteQueue',
  registers: [register],
})
```

**Update locations:**
- **RedisStateManager**: Update `activeSessions` when sessions are created/deleted
- **WebSocketServer**: Update `websocketConnections` on connect/disconnect
- **DBWriteQueue**: Update `dbWriteQueueSize` when jobs are added/processed

**Test metrics:**
```bash
curl http://localhost:3000/metrics | grep synckairos_active_sessions
curl http://localhost:3000/metrics | grep synckairos_websocket_connections
curl http://localhost:3000/metrics | grep synckairos_db_write_queue_size
```

### Afternoon: Helper Utilities (3 hours)

#### 4. Create Test Data Generators (1 hour)

**File:** `tests/load/utils/generators.js`

```javascript
import { randomUUID } from 'crypto';

/**
 * Generate a valid session configuration
 * @param {Object} options - Configuration options
 * @returns {Object} - Session config for POST /v1/sessions
 */
export function generateSession(options = {}) {
  const {
    participantCount = 2,
    timePerParticipantMs = 60000, // 1 minute
    syncMode = 'per_participant',
    incrementMs = 0,
  } = options;

  const sessionId = randomUUID();
  const participants = [];

  for (let i = 0; i < participantCount; i++) {
    participants.push({
      participant_id: randomUUID(),
      participant_index: i,
      total_time_ms: timePerParticipantMs,
    });
  }

  return {
    session_id: sessionId,
    sync_mode: syncMode,
    participants,
    time_per_cycle_ms: timePerParticipantMs,
    increment_ms: incrementMs,
    auto_advance: true,
    metadata: {
      test: 'load-test',
      timestamp: Date.now(),
    },
  };
}

/**
 * Generate batch of sessions
 * @param {number} count - Number of sessions to generate
 * @param {Object} options - Session options
 * @returns {Array} - Array of session configs
 */
export function generateSessionBatch(count, options = {}) {
  const sessions = [];
  for (let i = 0; i < count; i++) {
    sessions.push(generateSession(options));
  }
  return sessions;
}

/**
 * Generate random participant ID from session
 * @param {Object} session - Session object
 * @returns {string} - Random participant ID
 */
export function getRandomParticipantId(session) {
  const participants = session.participants || [];
  if (participants.length === 0) return null;
  const randomIndex = Math.floor(Math.random() * participants.length);
  return participants[randomIndex].participant_id;
}
```

#### 5. Create Performance Assertions (1 hour)

**File:** `tests/load/utils/assertions.js`

```javascript
import { check } from 'k6';

/**
 * Assert response time is within target
 * @param {Response} response - HTTP response
 * @param {number} targetMs - Target time in ms
 * @param {string} operation - Operation name for logging
 */
export function assertResponseTime(response, targetMs, operation = 'request') {
  return check(response, {
    [`${operation} response time <${targetMs}ms`]: (r) =>
      r.timings.duration < targetMs,
  });
}

/**
 * Assert switchCycle performance
 * @param {Response} response - Switch cycle response
 */
export function assertSwitchCyclePerformance(response) {
  return check(response, {
    'switch cycle status 200': (r) => r.status === 200,
    'switch cycle response time <50ms': (r) => r.timings.duration < 50,
    'switch cycle returns session_id': (r) => {
      const body = JSON.parse(r.body);
      return body.session_id !== undefined;
    },
  });
}

/**
 * Assert WebSocket message delivery time
 * @param {number} deliveryTimeMs - Time from request to WebSocket message
 */
export function assertWebSocketDelivery(deliveryTimeMs) {
  return deliveryTimeMs < 100;
}

/**
 * Check for errors in response
 * @param {Response} response - HTTP response
 */
export function assertNoErrors(response) {
  return check(response, {
    'status is 2xx or 409': (r) =>
      (r.status >= 200 && r.status < 300) || r.status === 409,
    'no 5xx errors': (r) => r.status < 500,
  });
}

/**
 * Assert optimistic locking conflicts are acceptable
 * @param {Response} response - HTTP response
 * @param {number} maxConflictRate - Max acceptable conflict rate (0-1)
 */
export function assertOptimisticLocking(response, maxConflictRate = 0.1) {
  // 409 conflicts are expected and acceptable under concurrent load
  return check(response, {
    'status is 200 or 409 (optimistic lock conflict)': (r) =>
      r.status === 200 || r.status === 409,
  });
}
```

#### 6. Create Threshold Configuration (1 hour)

**File:** `tests/load/config/thresholds.js`

```javascript
/**
 * Performance thresholds for all load tests
 * Based on SyncKairos v2.0 performance targets
 */
export const thresholds = {
  // HTTP request duration
  http_req_duration: [
    'p(95)<100', // 95% of requests under 100ms
    'p(99)<250', // 99% of requests under 250ms
  ],

  // Switch cycle specific (hot path)
  'http_req_duration{operation:switchCycle}': [
    'p(50)<10', // 50% under 10ms
    'p(95)<50', // 95% under 50ms (CRITICAL)
    'p(99)<100', // 99% under 100ms
  ],

  // WebSocket delivery time
  'websocket_delivery_time': [
    'p(95)<100', // 95% under 100ms (CRITICAL)
  ],

  // Error rate
  http_req_failed: [
    'rate<0.01', // Error rate below 1%
  ],

  // Request rate
  http_reqs: [
    'rate>100', // At least 100 requests per second
  ],

  // Iteration duration (end-to-end test time)
  iteration_duration: [
    'p(95)<5000', // 95% of iterations under 5 seconds
  ],
};

/**
 * Get thresholds for specific scenario
 * @param {string} scenario - Scenario name
 * @returns {Object} - Thresholds configuration
 */
export function getThresholds(scenario) {
  const scenarioThresholds = {
    baseline: thresholds,
    '1k-concurrent': {
      ...thresholds,
      http_reqs: ['rate>500'], // Higher request rate for concurrent
    },
    '10k-concurrent': {
      ...thresholds,
      http_reqs: ['rate>1000'], // Very high request rate
      'http_req_duration{operation:switchCycle}': [
        'p(50)<15', // Allow slightly higher latency under extreme load
        'p(95)<50', // Still must meet 50ms target
        'p(99)<100',
      ],
    },
    'high-frequency': {
      ...thresholds,
      'http_req_duration{operation:switchCycle}': [
        'p(50)<5', // Very fast for high-frequency
        'p(95)<50',
        'p(99)<100',
      ],
    },
    'websocket-stress': {
      ...thresholds,
      'websocket_delivery_time': [
        'p(50)<50', // 50% under 50ms
        'p(95)<100', // 95% under 100ms (CRITICAL)
        'p(99)<250',
      ],
    },
    sustained: {
      ...thresholds,
      http_req_failed: ['rate<0.005'], // Even lower error rate for sustained
    },
  };

  return scenarioThresholds[scenario] || thresholds;
}
```

### Evening: Test Scenarios (3 hours)

#### 7. Scenario 1: Baseline Test (30 minutes)

**File:** `tests/load/scenarios/01-baseline.js`

**Purpose:** Establish performance baseline with 100 sessions

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';
import { generateSession } from '../utils/generators.js';
import { assertSwitchCyclePerformance, assertNoErrors } from '../utils/assertions.js';
import { getThresholds } from '../config/thresholds.js';

export const options = {
  vus: 10, // 10 virtual users
  duration: '2m', // 2 minute test
  thresholds: getThresholds('baseline'),
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export default function () {
  // 1. Create session
  const sessionConfig = generateSession({
    participantCount: 2,
    timePerParticipantMs: 60000,
  });

  const createRes = http.post(
    `${BASE_URL}/v1/sessions`,
    JSON.stringify(sessionConfig),
    {
      headers: { 'Content-Type': 'application/json' },
    }
  );

  assertNoErrors(createRes);
  check(createRes, {
    'session created': (r) => r.status === 201,
  });

  if (createRes.status !== 201) {
    return; // Skip rest if creation failed
  }

  const sessionId = sessionConfig.session_id;

  sleep(0.1); // Small delay

  // 2. Start session
  const startRes = http.post(`${BASE_URL}/v1/sessions/${sessionId}/start`);
  assertNoErrors(startRes);

  sleep(0.1);

  // 3. Perform 5 switch cycles (hot path testing)
  for (let i = 0; i < 5; i++) {
    const switchRes = http.post(
      `${BASE_URL}/v1/sessions/${sessionId}/switch`,
      null,
      {
        tags: { operation: 'switchCycle' }, // Tag for threshold tracking
      }
    );

    assertSwitchCyclePerformance(switchRes);
    sleep(0.05); // 50ms between switches
  }

  // 4. Get current state
  const getRes = http.get(`${BASE_URL}/v1/sessions/${sessionId}`);
  assertNoErrors(getRes);

  sleep(0.1);

  // 5. Complete session
  const completeRes = http.post(
    `${BASE_URL}/v1/sessions/${sessionId}/complete`
  );
  assertNoErrors(completeRes);

  sleep(0.5); // Cooldown
}
```

**Expected Results:**
- All requests successful
- switchCycle p95 <10ms (low load baseline)
- Establish baseline metrics for comparison

#### 8. Scenario 2: 1,000 Concurrent Sessions (45 minutes)

**File:** `tests/load/scenarios/02-concurrent-sessions-1k.js`

**Purpose:** Validate performance with 1,000 concurrent sessions

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';
import { generateSession } from '../utils/generators.js';
import { assertSwitchCyclePerformance } from '../utils/assertions.js';
import { getThresholds } from '../config/thresholds.js';

export const options = {
  stages: [
    { duration: '2m', target: 100 }, // Ramp up to 100 VUs
    { duration: '3m', target: 500 }, // Ramp up to 500 VUs
    { duration: '5m', target: 1000 }, // Ramp up to 1000 VUs (1k sessions)
    { duration: '5m', target: 1000 }, // Stay at 1000 VUs
    { duration: '2m', target: 0 }, // Ramp down
  ],
  thresholds: getThresholds('1k-concurrent'),
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export default function () {
  const sessionConfig = generateSession({
    participantCount: 2,
    timePerParticipantMs: 120000, // 2 minutes per participant
  });

  // Create and start session
  const createRes = http.post(
    `${BASE_URL}/v1/sessions`,
    JSON.stringify(sessionConfig),
    { headers: { 'Content-Type': 'application/json' } }
  );

  if (createRes.status !== 201) return;

  const sessionId = sessionConfig.session_id;
  http.post(`${BASE_URL}/v1/sessions/${sessionId}/start`);

  // Perform multiple switches
  for (let i = 0; i < 10; i++) {
    const switchRes = http.post(
      `${BASE_URL}/v1/sessions/${sessionId}/switch`,
      null,
      { tags: { operation: 'switchCycle' } }
    );
    assertSwitchCyclePerformance(switchRes);
    sleep(0.5); // 500ms between switches
  }

  // Complete session
  http.post(`${BASE_URL}/v1/sessions/${sessionId}/complete`);
  sleep(1);
}
```

**Expected Results:**
- 1,000 concurrent sessions handled
- switchCycle p95 <50ms
- No errors (<1% error rate)
- Redis memory usage monitored

#### 9. Scenario 3: 10,000 Concurrent Sessions (45 minutes)

**File:** `tests/load/scenarios/03-concurrent-sessions-10k.js`

**Purpose:** ⭐ **CRITICAL** - Validate 10k+ concurrent session target

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';
import { generateSession } from '../utils/generators.js';
import { assertSwitchCyclePerformance } from '../utils/assertions.js';
import { getThresholds } from '../config/thresholds.js';

export const options = {
  stages: [
    { duration: '5m', target: 1000 }, // Ramp up to 1k
    { duration: '5m', target: 5000 }, // Ramp up to 5k
    { duration: '10m', target: 10000 }, // Ramp up to 10k (CRITICAL)
    { duration: '10m', target: 10000 }, // Sustain at 10k
    { duration: '5m', target: 0 }, // Ramp down
  ],
  thresholds: getThresholds('10k-concurrent'),
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export default function () {
  const sessionConfig = generateSession({
    participantCount: 2,
    timePerParticipantMs: 300000, // 5 minutes per participant
  });

  // Create and start session
  const createRes = http.post(
    `${BASE_URL}/v1/sessions`,
    JSON.stringify(sessionConfig),
    { headers: { 'Content-Type': 'application/json' } }
  );

  if (createRes.status !== 201) return;

  const sessionId = sessionConfig.session_id;
  http.post(`${BASE_URL}/v1/sessions/${sessionId}/start`);

  // Fewer switches per session to reduce load
  for (let i = 0; i < 5; i++) {
    const switchRes = http.post(
      `${BASE_URL}/v1/sessions/${sessionId}/switch`,
      null,
      { tags: { operation: 'switchCycle' } }
    );
    assertSwitchCyclePerformance(switchRes);
    sleep(1); // 1 second between switches
  }

  // Complete session
  http.post(`${BASE_URL}/v1/sessions/${sessionId}/complete`);
  sleep(2);
}
```

**Expected Results:**
- 10,000+ concurrent sessions handled successfully
- switchCycle p95 <50ms (may be slightly higher but must stay under target)
- No errors under peak load
- System resources monitored (CPU, memory, Redis, PostgreSQL)

#### 10. Scenario 4: High-Frequency Switching (30 minutes)

**File:** `tests/load/scenarios/04-high-frequency-switching.js`

**Purpose:** Stress test switchCycle hot path with rapid switches

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';
import { generateSession } from '../utils/generators.js';
import { assertSwitchCyclePerformance, assertOptimisticLocking } from '../utils/assertions.js';
import { getThresholds } from '../config/thresholds.js';

export const options = {
  vus: 50, // 50 virtual users
  duration: '5m',
  thresholds: getThresholds('high-frequency'),
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export default function () {
  const sessionConfig = generateSession({
    participantCount: 4,
    timePerParticipantMs: 60000,
  });

  const createRes = http.post(
    `${BASE_URL}/v1/sessions`,
    JSON.stringify(sessionConfig),
    { headers: { 'Content-Type': 'application/json' } }
  );

  if (createRes.status !== 201) return;

  const sessionId = sessionConfig.session_id;
  http.post(`${BASE_URL}/v1/sessions/${sessionId}/start`);

  // Rapid switches: 10 per second for 10 seconds = 100 switches
  for (let i = 0; i < 100; i++) {
    const switchRes = http.post(
      `${BASE_URL}/v1/sessions/${sessionId}/switch`,
      null,
      { tags: { operation: 'switchCycle' } }
    );

    // 409 conflicts are expected and acceptable here
    assertOptimisticLocking(switchRes);

    sleep(0.01); // 10ms between switches = 100 switches/sec
  }

  http.post(`${BASE_URL}/v1/sessions/${sessionId}/complete`);
  sleep(0.5);
}
```

**Expected Results:**
- switchCycle maintains <50ms p95 under high frequency
- Optimistic locking works correctly (some 409 conflicts expected)
- No 5xx errors
- Hot path optimization validated

#### 11. Scenario 5: WebSocket Stress Test (30 minutes)

**File:** `tests/load/scenarios/05-websocket-stress.js`

**Purpose:** Validate WebSocket broadcasting under load with 10k+ connections

```javascript
import http from 'k6/http';
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { generateSession } from '../utils/generators.js';
import { assertWebSocketDelivery } from '../utils/assertions.js';
import { getThresholds } from '../config/thresholds.js';
import { Counter } from 'k6/metrics';

export const options = {
  stages: [
    { duration: '2m', target: 1000 }, // 1k WebSocket connections
    { duration: '5m', target: 5000 }, // 5k connections
    { duration: '5m', target: 10000 }, // 10k connections (CRITICAL)
    { duration: '5m', target: 10000 }, // Sustain at 10k
    { duration: '2m', target: 0 },
  ],
  thresholds: getThresholds('websocket-stress'),
};

const websocketDeliveryTime = new Counter('websocket_delivery_time');

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const WS_URL = __ENV.WS_URL || 'ws://localhost:3000/ws';

export default function () {
  const sessionConfig = generateSession({
    participantCount: 2,
    timePerParticipantMs: 180000,
  });

  // Create session
  const createRes = http.post(
    `${BASE_URL}/v1/sessions`,
    JSON.stringify(sessionConfig),
    { headers: { 'Content-Type': 'application/json' } }
  );

  if (createRes.status !== 201) return;

  const sessionId = sessionConfig.session_id;

  // Connect WebSocket
  const wsUrl = `${WS_URL}?sessionId=${sessionId}`;
  let messageCount = 0;
  let requestTime = 0;

  ws.connect(wsUrl, {}, function (socket) {
    socket.on('open', () => {
      // Start session after WebSocket connected
      requestTime = Date.now();
      http.post(`${BASE_URL}/v1/sessions/${sessionId}/start`);
    });

    socket.on('message', (data) => {
      const deliveryTime = Date.now() - requestTime;
      const message = JSON.parse(data);

      messageCount++;

      if (message.type === 'STATE_UPDATE') {
        websocketDeliveryTime.add(deliveryTime);
        assertWebSocketDelivery(deliveryTime);

        // Trigger another update
        if (messageCount < 10) {
          requestTime = Date.now();
          http.post(`${BASE_URL}/v1/sessions/${sessionId}/switch`, null, {
            tags: { operation: 'switchCycle' },
          });
        }
      }
    });

    socket.on('close', () => {
      // Connection closed
    });

    // Keep connection open for 60 seconds
    socket.setTimeout(() => {
      socket.close();
    }, 60000);
  });

  sleep(1);
}
```

**Expected Results:**
- 10,000+ WebSocket connections maintained
- Message delivery p95 <100ms
- Heartbeat mechanism works under load
- Cross-instance broadcasting validated

#### 12. Scenario 6: Sustained Load Test (30 minutes)

**File:** `tests/load/scenarios/06-sustained-load.js`

**Purpose:** Detect memory leaks and queue growth with 5-minute sustained load

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';
import { generateSession } from '../utils/generators.js';
import { assertSwitchCyclePerformance } from '../utils/assertions.js';
import { getThresholds } from '../config/thresholds.js';

export const options = {
  vus: 500, // 500 concurrent virtual users
  duration: '5m', // 5 minutes sustained
  thresholds: getThresholds('sustained'),
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export default function () {
  const sessionConfig = generateSession({
    participantCount: 3,
    timePerParticipantMs: 90000,
  });

  const createRes = http.post(
    `${BASE_URL}/v1/sessions`,
    JSON.stringify(sessionConfig),
    { headers: { 'Content-Type': 'application/json' } }
  );

  if (createRes.status !== 201) return;

  const sessionId = sessionConfig.session_id;
  http.post(`${BASE_URL}/v1/sessions/${sessionId}/start`);

  // Continuous switching for duration of test
  for (let i = 0; i < 20; i++) {
    const switchRes = http.post(
      `${BASE_URL}/v1/sessions/${sessionId}/switch`,
      null,
      { tags: { operation: 'switchCycle' } }
    );
    assertSwitchCyclePerformance(switchRes);
    sleep(1);
  }

  http.post(`${BASE_URL}/v1/sessions/${sessionId}/complete`);
  sleep(2);
}
```

**Expected Results:**
- Memory usage remains stable over 5 minutes
- No memory leaks detected
- DBWriteQueue doesn't grow unbounded
- Error rate stays <0.5%

---

## Day 2: Test Execution & Documentation (8 hours)

### Morning: Test Execution (4 hours)

#### 13. Run All Scenarios (3 hours)

**Pre-test checklist:**
- [ ] Server running locally or in test environment
- [ ] Redis running and accessible
- [ ] PostgreSQL running and accessible
- [ ] Prometheus metrics endpoint accessible at `/metrics`
- [ ] No other load on the system
- [ ] Monitoring tools ready (htop, Redis CLI, pg stats)

**Execution order:**

```bash
# 1. Baseline (2 minutes)
k6 run tests/load/scenarios/01-baseline.js

# 2. 1k Concurrent Sessions (17 minutes)
k6 run tests/load/scenarios/02-concurrent-sessions-1k.js

# 3. 10k Concurrent Sessions (35 minutes) ⭐ CRITICAL
k6 run tests/load/scenarios/03-concurrent-sessions-10k.js

# 4. High-Frequency Switching (5 minutes)
k6 run tests/load/scenarios/04-high-frequency-switching.js

# 5. WebSocket Stress (19 minutes)
k6 run tests/load/scenarios/05-websocket-stress.js

# 6. Sustained Load (5 minutes)
k6 run tests/load/scenarios/06-sustained-load.js
```

**Monitoring during tests:**

Terminal 1: **k6 execution**
```bash
k6 run tests/load/scenarios/03-concurrent-sessions-10k.js
```

Terminal 2: **System monitoring**
```bash
htop
```

Terminal 3: **Redis monitoring**
```bash
redis-cli
> INFO memory
> INFO stats
> DBSIZE
```

Terminal 4: **PostgreSQL monitoring**
```bash
psql -U postgres -d synckairos
SELECT count(*) FROM sessions;
SELECT count(*) FROM sync_events;
```

Terminal 5: **Prometheus metrics**
```bash
watch -n 1 'curl -s http://localhost:3000/metrics | grep synckairos'
```

#### 14. Capture Results (1 hour)

For each test, capture:

1. **k6 Summary Output**
   - Save complete console output to files
   - `k6 run scenario.js > results/scenario-output.txt 2>&1`

2. **Performance Metrics**
   - http_req_duration (p50, p95, p99)
   - switchCycle duration (p50, p95, p99)
   - WebSocket delivery time (p50, p95, p99)
   - Request rate (RPS)
   - Error rate

3. **System Metrics**
   - CPU usage (%)
   - Memory usage (MB)
   - Redis memory (MB)
   - PostgreSQL connections
   - DBWriteQueue size

4. **Prometheus Metrics Screenshots**
   - Active sessions graph
   - WebSocket connections graph
   - DBWriteQueue size graph

### Afternoon: Documentation & Analysis (4 hours)

#### 15. Create LOAD_TEST_RESULTS.md (2 hours)

**File:** `docs/project-tracking/LOAD_TEST_RESULTS.md`

Document structure:

```markdown
# Load Testing Results

**Date:** 2025-10-22
**System:** SyncKairos v2.0
**Tool:** k6
**Duration:** Full test suite run

## Executive Summary

- ✅/❌ 10,000+ concurrent sessions supported
- ✅/❌ switchCycle() p95 <50ms under load
- ✅/❌ WebSocket delivery p95 <100ms under load
- ✅/❌ All performance targets met

## Test Environment

- **Server:** [specs]
- **Redis:** [version, configuration]
- **PostgreSQL:** [version, configuration]
- **Node.js:** [version]
- **Network:** [local/remote]

## Scenario 1: Baseline Test

### Configuration
- VUs: 10
- Duration: 2 minutes
- Sessions: ~100

### Results
[Table with p50/p95/p99 for all metrics]

### Analysis
[Interpretation of results]

## Scenario 2: 1,000 Concurrent Sessions
...

## Scenario 3: 10,000 Concurrent Sessions ⭐ CRITICAL
...

## Performance Comparison

| Metric | Target | Baseline | 1k | 10k | Status |
|--------|--------|----------|-----|-----|--------|
| switchCycle p95 | <50ms | Xms | Xms | Xms | ✅/❌ |
| WebSocket delivery p95 | <100ms | Xms | Xms | Xms | ✅/❌ |
| ... | ... | ... | ... | ... | ... |

## Bottlenecks Identified
[List any performance bottlenecks found]

## Recommendations
[Optimization recommendations if needed]

## Conclusion
[Final assessment of system readiness]
```

#### 16. Performance Analysis (1.5 hours)

Compare results against targets:

**Performance Targets:**
- switchCycle() p95 <50ms ← **CRITICAL**
- WebSocket delivery p95 <100ms ← **CRITICAL**
- 10,000+ concurrent sessions ← **CRITICAL**
- Redis GET <5ms
- Redis SET <5ms
- Error rate <1%
- Memory stable (no leaks)

**Analysis questions:**
- Did all tests meet performance targets?
- Were there any errors or failures?
- How did performance degrade with load?
- Were there any bottlenecks identified?
- Is memory usage stable over time?
- Does DBWriteQueue grow unbounded?

#### 17. Create Summary Report (30 minutes)

Update PHASE_3.md with:
- Load testing completion status
- Performance results summary
- Link to LOAD_TEST_RESULTS.md

---

## Acceptance Checklist

### Test Execution
- [ ] All 6 scenarios executed successfully
- [ ] Results captured for all scenarios
- [ ] System metrics monitored during tests
- [ ] Prometheus metrics captured
- [ ] No critical failures during tests

### Performance Validation
- [ ] switchCycle() p95 <50ms validated
- [ ] WebSocket delivery p95 <100ms validated
- [ ] 10,000+ concurrent sessions validated
- [ ] Redis operations <5ms validated
- [ ] Error rate <1% validated
- [ ] Memory usage stable (no leaks)

### Documentation
- [ ] LOAD_TEST_RESULTS.md created
- [ ] All test scenarios documented
- [ ] Performance comparison table completed
- [ ] Bottlenecks identified and documented
- [ ] Recommendations provided
- [ ] PHASE_3.md updated

### Deliverables
- [ ] 6 k6 test scenario files
- [ ] Test utility files (generators, assertions)
- [ ] Configuration files (thresholds)
- [ ] Complete test results documentation
- [ ] Performance analysis report
- [ ] Gauge metrics implemented

---

## Files to Create

**Test Scenarios (6 files):**
- `tests/load/scenarios/01-baseline.js`
- `tests/load/scenarios/02-concurrent-sessions-1k.js`
- `tests/load/scenarios/03-concurrent-sessions-10k.js`
- `tests/load/scenarios/04-high-frequency-switching.js`
- `tests/load/scenarios/05-websocket-stress.js`
- `tests/load/scenarios/06-sustained-load.js`

**Utilities (2 files):**
- `tests/load/utils/generators.js`
- `tests/load/utils/assertions.js`

**Configuration (1 file):**
- `tests/load/config/thresholds.js`

**Documentation (1 file):**
- `docs/project-tracking/LOAD_TEST_RESULTS.md`

**Code Updates:**
- `src/api/middlewares/metrics.ts` (add gauge metrics)
- `src/state/RedisStateManager.ts` (update activeSessions gauge)
- `src/websocket/WebSocketServer.ts` (update websocketConnections gauge)
- `src/db/DBWriteQueue.ts` (update dbWriteQueueSize gauge)

---

## Notes

### Important Considerations

1. **System Resources**
   - Ensure adequate resources for 10k test
   - Monitor system during high load
   - May need to increase ulimit for file descriptors

2. **Redis Configuration**
   - Ensure maxmemory is sufficient
   - Monitor memory usage during tests
   - Consider enabling memory eviction policies

3. **PostgreSQL Configuration**
   - Increase max_connections if needed
   - Monitor connection pool
   - DBWriteQueue async writes should not block

4. **Test Environment**
   - Run on dedicated hardware if possible
   - Close unnecessary applications
   - Ensure stable network connection

### Troubleshooting

**If tests fail:**
- Check server logs for errors
- Verify Redis/PostgreSQL connections
- Monitor system resources
- Reduce load if system is overwhelmed
- Check rate limiting configuration

**If performance targets not met:**
- Profile hot path code
- Check for N+1 queries
- Verify Redis connection pooling
- Review optimistic locking conflicts
- Consider horizontal scaling

---

**Last Updated:** 2025-10-22
**Status:** ⚪ Pending - Ready to start
