// Performance Assertions for k6 Load Tests
// Provides helper functions for validating performance targets

import { check } from 'k6';

/**
 * Assert response time is within target
 * @param {Response} response - HTTP response
 * @param {number} targetMs - Target time in ms
 * @param {string} operation - Operation name for logging
 * @returns {boolean} - True if check passed
 */
export function assertResponseTime(response, targetMs, operation = 'request') {
  return check(response, {
    [`${operation} response time <${targetMs}ms`]: (r) =>
      r.timings.duration < targetMs,
  });
}

/**
 * Assert switchCycle performance (hot path)
 * Target: <50ms, expected: 3-5ms
 * @param {Response} response - Switch cycle response
 * @returns {boolean} - True if all checks passed
 */
export function assertSwitchCyclePerformance(response) {
  return check(response, {
    'switch cycle status 200': (r) => r.status === 200,
    'switch cycle response time <50ms': (r) => r.timings.duration < 50,
    'switch cycle returns session_id': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.session_id !== undefined;
      } catch {
        return false;
      }
    },
    'switch cycle has active_participant_id': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.active_participant_id !== undefined;
      } catch {
        return false;
      }
    },
  });
}

/**
 * Assert WebSocket message delivery time
 * Target: <100ms
 * @param {number} deliveryTimeMs - Time from request to WebSocket message
 * @returns {boolean} - True if delivery time is acceptable
 */
export function assertWebSocketDelivery(deliveryTimeMs) {
  return deliveryTimeMs < 100;
}

/**
 * Check for errors in response
 * @param {Response} response - HTTP response
 * @returns {boolean} - True if no errors
 */
export function assertNoErrors(response) {
  return check(response, {
    'status is 2xx or 409': (r) =>
      (r.status >= 200 && r.status < 300) || r.status === 409,
    'no 5xx errors': (r) => r.status < 500,
    'response has body': (r) => r.body && r.body.length > 0,
  });
}

/**
 * Assert optimistic locking conflicts are acceptable
 * 409 conflicts are expected and acceptable under concurrent load
 * @param {Response} response - HTTP response
 * @param {number} maxConflictRate - Max acceptable conflict rate (0-1) (default: 0.1)
 * @returns {boolean} - True if response is acceptable
 */
export function assertOptimisticLocking(response, maxConflictRate = 0.1) {
  return check(response, {
    'status is 200 or 409 (optimistic lock conflict)': (r) =>
      r.status === 200 || r.status === 409,
    'no 5xx errors (system healthy)': (r) => r.status < 500,
  });
}

/**
 * Assert session creation was successful
 * @param {Response} response - HTTP response
 * @returns {boolean} - True if session created
 */
export function assertSessionCreated(response) {
  return check(response, {
    'session created (status 201)': (r) => r.status === 201,
    'session has session_id': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.session_id !== undefined;
      } catch {
        return false;
      }
    },
    'session has participants': (r) => {
      try {
        const body = JSON.parse(r.body);
        return Array.isArray(body.participants) && body.participants.length > 0;
      } catch {
        return false;
      }
    },
  });
}

/**
 * Assert session state retrieval was successful
 * @param {Response} response - HTTP response
 * @returns {boolean} - True if state retrieved
 */
export function assertSessionState(response) {
  return check(response, {
    'state retrieved (status 200)': (r) => r.status === 200,
    'state has session_id': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.session_id !== undefined;
      } catch {
        return false;
      }
    },
    'state has status': (r) => {
      try {
        const body = JSON.parse(r.body);
        return ['pending', 'running', 'paused', 'completed'].includes(body.status);
      } catch {
        return false;
      }
    },
  });
}

/**
 * Custom metric for tracking errors
 * @param {Response} response - HTTP response
 * @returns {number} - 1 if error, 0 if success
 */
export function errorMetric(response) {
  return response.status >= 400 ? 1 : 0;
}
