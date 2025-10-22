// Performance Thresholds for k6 Load Tests
// Based on SyncKairos v2.0 performance targets

/**
 * Default performance thresholds for all load tests
 * Based on architecture requirements
 */
export const thresholds = {
  // HTTP request duration
  http_req_duration: [
    'p(95)<100', // 95% of requests under 100ms
    'p(99)<250', // 99% of requests under 250ms
  ],

  // Switch cycle specific (hot path) - CRITICAL
  'http_req_duration{operation:switchCycle}': [
    'p(50)<10', // 50% under 10ms
    'p(95)<50', // 95% under 50ms (CRITICAL REQUIREMENT)
    'p(99)<100', // 99% under 100ms
  ],

  // Session creation
  'http_req_duration{operation:createSession}': [
    'p(95)<100', // 95% under 100ms
  ],

  // WebSocket delivery time (custom metric)
  websocket_delivery_time: [
    'p(95)<100', // 95% under 100ms (CRITICAL REQUIREMENT)
  ],

  // Error rate
  http_req_failed: [
    'rate<0.01', // Error rate below 1%
  ],

  // Request rate (RPS)
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
    // Baseline test (100 sessions)
    baseline: {
      ...thresholds,
      http_reqs: ['rate>50'], // Lower rate for baseline
      'http_req_duration{operation:switchCycle}': [
        'p(50)<5', // Very fast for low load
        'p(95)<10', // Should be much better than target
        'p(99)<25',
      ],
    },

    // 1,000 concurrent sessions
    '1k-concurrent': {
      ...thresholds,
      http_reqs: ['rate>500'], // Higher request rate
      'http_req_duration{operation:switchCycle}': [
        'p(50)<10',
        'p(95)<50', // Must meet target
        'p(99)<100',
      ],
    },

    // 10,000 concurrent sessions (CRITICAL)
    '10k-concurrent': {
      ...thresholds,
      http_reqs: ['rate>1000'], // Very high request rate
      'http_req_duration{operation:switchCycle}': [
        'p(50)<15', // Allow slightly higher under extreme load
        'p(95)<50', // MUST still meet 50ms target
        'p(99)<100',
      ],
      http_req_duration: [
        'p(95)<150', // Allow slightly higher for overall requests
        'p(99)<300',
      ],
    },

    // High-frequency switching
    'high-frequency': {
      ...thresholds,
      'http_req_duration{operation:switchCycle}': [
        'p(50)<5', // Very fast for rapid switches
        'p(95)<50', // Must meet target even under stress
        'p(99)<100',
      ],
      http_req_failed: [
        'rate<0.15', // Allow up to 15% conflict rate (409s expected)
      ],
    },

    // WebSocket stress test
    'websocket-stress': {
      ...thresholds,
      websocket_delivery_time: [
        'p(50)<50', // 50% under 50ms
        'p(95)<100', // 95% under 100ms (CRITICAL)
        'p(99)<250',
      ],
      'http_req_duration{operation:switchCycle}': [
        'p(50)<10',
        'p(95)<50',
        'p(99)<100',
      ],
    },

    // Sustained load test (memory leak detection)
    sustained: {
      ...thresholds,
      http_req_failed: ['rate<0.005'], // Even lower error rate for sustained
      'http_req_duration{operation:switchCycle}': [
        'p(50)<10',
        'p(95)<50',
        'p(99)<100',
      ],
      // Memory should not grow unbounded
      iteration_duration: [
        'p(95)<3000', // Should complete quickly and consistently
      ],
    },
  };

  return scenarioThresholds[scenario] || thresholds;
}

/**
 * Get options for specific scenario
 * Combines thresholds with scenario-specific options
 * @param {string} scenario - Scenario name
 * @param {Object} customOptions - Additional options to merge
 * @returns {Object} - Complete k6 options object
 */
export function getScenarioOptions(scenario, customOptions = {}) {
  return {
    thresholds: getThresholds(scenario),
    ...customOptions,
  };
}
