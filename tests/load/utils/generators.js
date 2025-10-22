// Test Data Generators for k6 Load Tests
// Generates session configurations and test data

import { randomUUID } from 'crypto';

/**
 * Generate a valid session configuration
 * @param {Object} options - Configuration options
 * @param {number} options.participantCount - Number of participants (default: 2)
 * @param {number} options.timePerParticipantMs - Time per participant in ms (default: 60000)
 * @param {string} options.syncMode - Sync mode (default: 'per_participant')
 * @param {number} options.incrementMs - Increment time in ms (default: 0)
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
      scenario: options.scenario || 'unknown',
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
 * @param {Object} session - Session object with participants array
 * @returns {string|null} - Random participant ID or null if no participants
 */
export function getRandomParticipantId(session) {
  const participants = session.participants || [];
  if (participants.length === 0) return null;
  const randomIndex = Math.floor(Math.random() * participants.length);
  return participants[randomIndex].participant_id;
}

/**
 * Get next participant ID in rotation
 * @param {Object} session - Session object
 * @param {string} currentParticipantId - Current participant ID
 * @returns {string|null} - Next participant ID or null
 */
export function getNextParticipantId(session, currentParticipantId) {
  const participants = session.participants || [];
  if (participants.length === 0) return null;

  const currentIndex = participants.findIndex(
    p => p.participant_id === currentParticipantId
  );

  if (currentIndex === -1) return participants[0].participant_id;

  const nextIndex = (currentIndex + 1) % participants.length;
  return participants[nextIndex].participant_id;
}
