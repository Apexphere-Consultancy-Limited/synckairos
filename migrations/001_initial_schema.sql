-- =====================================================
-- Migration: 001 Initial Schema
-- Description: Create PostgreSQL schema for AUDIT TRAIL
-- Note: Redis is PRIMARY source of truth, PostgreSQL is AUDIT only
-- =====================================================

-- =====================================================
-- ENUMS
-- =====================================================

-- Drop existing types if they exist (idempotent migrations)
DROP TYPE IF EXISTS sync_mode CASCADE;
DROP TYPE IF EXISTS sync_status CASCADE;

-- Synchronization modes
CREATE TYPE sync_mode AS ENUM (
  'per_participant',
  'per_cycle',
  'per_group',
  'global',
  'count_up'
);

-- Session status
CREATE TYPE sync_status AS ENUM (
  'pending',
  'running',
  'paused',
  'expired',
  'completed',
  'cancelled'
);

-- =====================================================
-- TABLES
-- =====================================================

-- Drop existing tables if they exist (idempotent migrations)
DROP TABLE IF EXISTS sync_participants CASCADE;
DROP TABLE IF EXISTS sync_events CASCADE;
DROP TABLE IF EXISTS sync_sessions CASCADE;

-- Synchronization sessions audit trail
CREATE TABLE sync_sessions (
  -- Primary key
  session_id UUID PRIMARY KEY,

  -- Configuration
  sync_mode sync_mode NOT NULL,
  time_per_cycle_ms INTEGER,
  increment_ms INTEGER DEFAULT 0,
  max_time_ms INTEGER,

  -- Lifecycle timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Final state
  final_status sync_status,
  total_cycles INTEGER DEFAULT 0,
  total_participants INTEGER DEFAULT 0,

  -- Metadata (flexible JSONB for additional data)
  metadata JSONB DEFAULT '{}',

  -- Audit fields
  last_updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Event log for all synchronization state changes
CREATE TABLE sync_events (
  -- Primary key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Session reference
  session_id UUID NOT NULL,

  -- Event details
  event_type VARCHAR(50) NOT NULL,
  participant_id UUID,
  group_id UUID,

  -- Timing snapshot
  time_remaining_ms INTEGER,
  time_elapsed_ms INTEGER,
  cycle_number INTEGER,

  -- Event timestamp
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Full state snapshot (for recovery)
  state_snapshot JSONB,

  -- Additional metadata
  metadata JSONB DEFAULT '{}'
);

-- Denormalized participant data for analytics (optional)
CREATE TABLE sync_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL,
  participant_id UUID NOT NULL,

  -- Participant configuration
  total_time_ms INTEGER NOT NULL,
  group_id UUID,

  -- Statistics
  total_cycles INTEGER DEFAULT 0,
  total_time_active_ms INTEGER DEFAULT 0,

  -- Timestamps
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  first_active_at TIMESTAMPTZ,
  last_active_at TIMESTAMPTZ,

  -- Metadata
  metadata JSONB DEFAULT '{}'
);

-- =====================================================
-- CONSTRAINTS
-- =====================================================

-- Ensure unique session-participant combinations
ALTER TABLE sync_participants
  ADD CONSTRAINT unique_session_participant UNIQUE (session_id, participant_id);

-- =====================================================
-- COMMENTS
-- =====================================================

-- Table comments
COMMENT ON TABLE sync_sessions IS 'Audit trail for synchronization sessions. Redis is PRIMARY source of truth.';
COMMENT ON TABLE sync_events IS 'Event log for all synchronization state changes. Used for audit, analytics, and recovery.';
COMMENT ON TABLE sync_participants IS 'Denormalized participant data for analytics queries.';

-- Column comments for sync_sessions
COMMENT ON COLUMN sync_sessions.session_id IS 'Unique session identifier';
COMMENT ON COLUMN sync_sessions.sync_mode IS 'Synchronization mode: per_participant, per_cycle, per_group, global, count_up';
COMMENT ON COLUMN sync_sessions.metadata IS 'Flexible JSONB field for additional session data';

-- Column comments for sync_events
COMMENT ON COLUMN sync_events.event_type IS 'Event types: session_created, session_started, cycle_switched, session_paused, session_resumed, session_completed, session_cancelled, participant_added, participant_removed';
COMMENT ON COLUMN sync_events.state_snapshot IS 'Full session state at time of event. Used for recovery if Redis data is lost.';
