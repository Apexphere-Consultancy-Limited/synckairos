-- =====================================================
-- Migration: 002 Add Indexes
-- Description: Add performance indexes for audit queries
-- =====================================================

-- =====================================================
-- INDEXES FOR sync_sessions
-- =====================================================

-- Query sessions by creation time (analytics)
CREATE INDEX idx_sync_sessions_created ON sync_sessions(created_at DESC);

-- Query sessions by status (monitoring)
CREATE INDEX idx_sync_sessions_status ON sync_sessions(final_status) WHERE final_status IS NOT NULL;

-- Query sessions by mode (analytics)
CREATE INDEX idx_sync_sessions_mode ON sync_sessions(sync_mode);

-- =====================================================
-- INDEXES FOR sync_events
-- =====================================================

-- Query events by session (most common query)
CREATE INDEX idx_sync_events_session ON sync_events(session_id, timestamp DESC);

-- Query events by type (analytics)
CREATE INDEX idx_sync_events_type ON sync_events(event_type);

-- Query recent events (monitoring)
CREATE INDEX idx_sync_events_timestamp ON sync_events(timestamp DESC);

-- Query events by participant (analytics)
CREATE INDEX idx_sync_events_participant ON sync_events(participant_id) WHERE participant_id IS NOT NULL;

-- =====================================================
-- INDEXES FOR sync_participants
-- =====================================================

-- Query participants by session
CREATE INDEX idx_sync_participants_session ON sync_participants(session_id);

-- Query participants by group
CREATE INDEX idx_sync_participants_group ON sync_participants(group_id) WHERE group_id IS NOT NULL;
