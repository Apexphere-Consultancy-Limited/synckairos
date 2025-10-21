# SyncKairos - Real-Time Synchronization Service

## Table of Contents
1. [Overview](#overview)
2. [Use Cases](#use-cases)
3. [Architecture](#architecture)
4. [Database Schema](#database-schema)
5. [REST API Specification](#rest-api-specification)
6. [WebSocket Protocol](#websocket-protocol)
7. [Sync Engine Implementation](#sync-engine-implementation)
8. [Frontend SDK Client](#frontend-sdk-client)
9. [React Integration](#react-integration)
10. [Deployment Strategy](#deployment-strategy)
11. [Performance Requirements](#performance-requirements)
12. [Integration Examples](#integration-examples)

---

## Overview

### Purpose
**SyncKairos** is a standalone, high-performance real-time synchronization service for precise, synchronized timers and states across multiple clients. It provides sub-100ms latency and zero visible time corrections for any application requiring synchronized timing.

### Why Universal Synchronization?
SyncKairos is designed to synchronize time across any application or use case:

**Gaming:**
- ♟️ **Chess** - Classical, Blitz, Bullet with increment
- 🎯 **Quiz Games** - Per-question or total game timers
- 🃏 **Card Games** - Turn timers for Poker, UNO, etc.
- 🎮 **Strategy Games** - Turn-based games like Civilization
- 🧩 **Puzzle Games** - Timed challenges
- 🎲 **Board Games** - Digital versions of any turn-based board game

**Live Events:**
- 🎤 **Concerts** - Synchronized countdowns across venues
- 🏆 **Auctions** - Bid timers synchronized for all participants
- 📺 **Live Shows** - Synchronized event timing for global audiences
- ⚽ **Sports** - Match timers, halftime clocks

**Business & Productivity:**
- 💼 **Meetings** - Synchronized meeting timers
- 📊 **Presentations** - Slide timers for speakers
- 🏃 **Sprints** - Agile sprint timers
- ☕ **Break Rooms** - Shared break timers

**Education:**
- 📝 **Exams** - Synchronized test timers across classrooms
- 🏫 **Classroom Activities** - Activity timers
- 📚 **Study Sessions** - Group study timers

**Other:**
- 🧘 **Meditation** - Group meditation session timers
- 🍳 **Cooking** - Multi-device cooking timers
- 🎆 **Countdowns** - Global synchronized countdowns (New Year, product launches)
- 🏋️ **Fitness** - Workout interval timers, group class sync

### Key Features
- ✅ **Universal** - Works with any application requiring synchronized timing
- ✅ **Multi-client support** - Unlimited participants per session
- ✅ **Flexible sync modes** - Per-participant, per-turn, global, or count-up
- ✅ **Sub-100ms latency** for all operations
- ✅ **Zero visible corrections** (calculation-based, not countdown)
- ✅ **Perfect synchronization** across all clients worldwide
- ✅ **Scalable to 50,000+ concurrent sessions**
- ✅ **Standalone deployment** (own database or shared infrastructure)
- ✅ **WebSocket real-time updates**
- ✅ **NTP-style time sync** for client drift correction
- ✅ **Audit logging** for replay, analytics, and compliance
- ✅ **Pause/Resume** support
- ✅ **Multiple modes** (countdown, count-up, hybrid, recurring)

### Core Principle: "Calculate, Don't Count"

Instead of counting down locally, calculate time from authoritative timestamps:

```
time_remaining = base_time - (current_server_time - turn_start_time)
```

This ensures all clients always calculate the same value from the same source of truth.

---

## Use Cases

### Use Case 1: Chess Game (Per-Player with Increment)
```typescript
// Chess: 10 minutes per player + 3 second increment per move
await syncClient.createSession({
  session_id: "chess-game-123",
  sync_mode: "per_participant",  // Maps to: per-player
  participants: [
    { participant_id: "white-player", total_time_ms: 600000 },
    { participant_id: "black-player", total_time_ms: 600000 }
  ],
  increment_ms: 3000,
  active_participant_id: "white-player"
})
```

### Use Case 2: Quiz Game (Global Timer per Question)
```typescript
// Quiz: 30 seconds per question, global countdown
await syncClient.createSession({
  session_id: "quiz-game-456",
  sync_mode: "global",  // Single timer for all students
  time_per_cycle_ms: 30000,  // Maps to: time per question
  auto_advance: true,
  action_on_timeout: { type: "skip_cycle" }  // Skip question
})
```

### Use Case 3: Auction (Per-Item Timer)
```typescript
// Auction: 30 seconds per item, rotates between bidders
await syncClient.createSession({
  session_id: "auction-789",
  sync_mode: "per_cycle",  // Maps to: per auction item
  participants: [
    { participant_id: "bidder1" },
    { participant_id: "bidder2" },
    { participant_id: "bidder3" },
    { participant_id: "bidder4" },
    { participant_id: "bidder5" },
    { participant_id: "bidder6" }
  ],
  time_per_cycle_ms: 30000,  // 30 seconds per bid round
  action_on_timeout: { type: "skip_cycle" }  // Move to next item
})
```

### Use Case 4: Speedrun Challenge (Count-Up Timer)
```typescript
// Speedrun: Track how long it takes to complete
await syncClient.createSession({
  session_id: "speedrun-999",
  sync_mode: "count_up",
  participants: [{ participant_id: "runner1" }],
  max_time_ms: 3600000  // 1 hour max
})
```

### Use Case 5: Team Competition (Team Timers)
```typescript
// Team Competition: Each team has 5 minutes total
await syncClient.createSession({
  session_id: "team-competition-111",
  sync_mode: "per_group",  // Maps to: per team
  groups: [
    { group_id: "team_red", total_time_ms: 300000, members: ["p1", "p2", "p3"] },
    { group_id: "team_blue", total_time_ms: 300000, members: ["p4", "p5", "p6"] }
  ],
  active_group_id: "team_red"
})
```

---

## Architecture

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│              Any Client Application                         │
│  ├─ Games / Live Events / Meetings / Exams / etc.         │
│  └─ useSyncKairos hook (SDK client)                       │
└────────────────┬────────────────────────────────────────────┘
                 │ REST + WebSocket
                 ▼
┌─────────────────────────────────────────────────────────────┐
│                  SyncKairos Service (Node.js)               │
│  ├─ REST API (Express/Hono)                                │
│  ├─ WebSocket Server (ws/Socket.io)                        │
│  ├─ Sync Engine (in-memory + DB sync)                      │
│  └─ Time Validation & Calculation Logic                    │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│         Database (Supabase or PostgreSQL)                   │
│  ├─ sync_sessions table                                    │
│  ├─ sync_participants table                                │
│  └─ sync_events table (audit log)                          │
└─────────────────────────────────────────────────────────────┘
```

### Service Boundaries

**Name:** `synckairos`
**Deployment:** Standalone service (can use its own database or shared instance)
**Communication:** REST API + WebSocket for real-time updates
**Language:** Node.js/TypeScript (or any language)
**Database:** PostgreSQL (via Supabase or self-hosted)
**Protocol:** JSON over HTTP/HTTPS and WebSocket

---

## Database Schema

### Table: `sync_sessions`

Stores the current state of each synchronized timing session.

```sql
CREATE TYPE sync_mode AS ENUM (
  'per_participant',  -- Each participant has own timer (chess players, exam students)
  'per_cycle',        -- Fixed time per cycle/turn (auction bids, meeting agenda items)
  'per_group',        -- Group-based timers (team competitions, breakout rooms)
  'global',           -- Single timer for entire session (countdown, meditation)
  'count_up'          -- Stopwatch mode (speedruns, elapsed time tracking)
);

CREATE TYPE sync_status AS ENUM (
  'pending',       -- Session created but not started
  'running',       -- Session is active
  'paused',        -- Session is paused
  'expired',       -- Time ran out
  'completed',     -- Session completed normally
  'cancelled'      -- Session cancelled/abandoned
);

CREATE TABLE sync_sessions (
  -- Primary key
  session_id UUID PRIMARY KEY,

  -- Sync configuration
  sync_mode sync_mode NOT NULL,
  time_per_cycle_ms INTEGER,          -- For per_cycle mode
  increment_ms INTEGER DEFAULT 0,     -- Time added per cycle
  max_time_ms INTEGER,                -- Maximum time limit (for count_up mode)

  -- Current state
  active_participant_id UUID,         -- Current active participant
  active_group_id UUID,               -- Current active group
  cycle_started_at TIMESTAMPTZ,       -- When current cycle began
  status sync_status DEFAULT 'pending',

  -- Actions & Rules
  action_on_timeout JSONB,            -- What happens when time expires
  auto_advance BOOLEAN DEFAULT false, -- Auto-switch cycle on timeout

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- For distributed systems (optimistic locking)
  version INTEGER DEFAULT 1,

  -- Additional application-specific metadata
  metadata JSONB
);

-- Indexes for performance
CREATE INDEX idx_sync_sessions_status ON sync_sessions(status);
CREATE INDEX idx_sync_sessions_active_participant ON sync_sessions(active_participant_id);
CREATE INDEX idx_sync_sessions_updated ON sync_sessions(updated_at);
```

### Table: `sync_participants`

Stores per-participant timing data (for per_participant and per_group modes).

```sql
CREATE TABLE sync_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sync_sessions(session_id) ON DELETE CASCADE,

  -- Participant/Group identification
  participant_id UUID,                -- Individual participant
  group_id UUID,                      -- Group (if applicable)
  participant_index INTEGER NOT NULL, -- Cycle order (0, 1, 2, ...)

  -- Time tracking
  total_time_ms INTEGER NOT NULL,     -- Total time remaining
  time_used_ms INTEGER DEFAULT 0,     -- Time already used
  cycle_count INTEGER DEFAULT 0,      -- Number of cycles taken

  -- Status
  is_active BOOLEAN DEFAULT false,
  has_expired BOOLEAN DEFAULT false,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_sync_participants_session ON sync_participants(session_id);
CREATE INDEX idx_sync_participants_participant ON sync_participants(participant_id);
CREATE INDEX idx_sync_participants_group ON sync_participants(group_id);
CREATE UNIQUE INDEX idx_sync_participants_session_participant ON sync_participants(session_id, participant_id);
```

### Table: `sync_events`

Audit log for all synchronization events (for replay, debugging, and analytics).

```sql
CREATE TABLE sync_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sync_sessions(session_id) ON DELETE CASCADE,

  -- Event details
  event_type VARCHAR(50) NOT NULL,    -- start, cycle_switch, pause, resume, expire, complete
  participant_id UUID,                -- Participant involved (if applicable)
  group_id UUID,                      -- Group involved (if applicable)

  -- Time snapshot
  time_remaining_ms INTEGER,
  time_elapsed_ms INTEGER,
  timestamp TIMESTAMPTZ DEFAULT NOW(),

  -- Additional data
  metadata JSONB                      -- Event-specific data
);

-- Indexes
CREATE INDEX idx_sync_events_session ON sync_events(session_id, timestamp DESC);
CREATE INDEX idx_sync_events_type ON sync_events(event_type);
CREATE INDEX idx_sync_events_participant ON sync_events(participant_id);
```

### Example Action Configuration

```json
{
  "action_on_timeout": {
    "type": "auto_action",
    "action": "default",           // Trigger default action (poker fold, quiz skip, etc)
    "notify_participants": true
  }
}

{
  "action_on_timeout": {
    "type": "skip_cycle",
    "penalty": {
      "points": -10                // Deduct points for timeout
    }
  }
}

{
  "action_on_timeout": {
    "type": "end_session",
    "outcome": "timeout",
    "winner_by": "time"            // For competitive sessions
  }
}
```

---

## REST API Specification

### Base URL
```
Production: https://api.synckairos.io/v1
Development: http://localhost:3000/v1
```

### Authentication
All endpoints require authentication via JWT token:
```
Authorization: Bearer <jwt_token>
```

---

### 1. Create Session

**Endpoint:** `POST /sessions`

**Description:** Creates a new synchronized session.

**Request Body (Chess Example):**
```json
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "sync_mode": "per_participant",
  "participants": [
    {
      "participant_id": "participant1-uuid",
      "participant_index": 0,
      "total_time_ms": 600000
    },
    {
      "participant_id": "participant2-uuid",
      "participant_index": 1,
      "total_time_ms": 600000
    }
  ],
  "increment_ms": 3000,
  "active_participant_id": "participant1-uuid",
  "auto_advance": false,
  "action_on_timeout": {
    "type": "end_session",
    "outcome": "timeout"
  }
}
```

**Request Body (Exam Example):**
```json
{
  "session_id": "exam-123",
  "sync_mode": "global",
  "time_per_cycle_ms": 3600000,
  "auto_advance": false,
  "action_on_timeout": {
    "type": "end_session",
    "outcome": "time_expired"
  }
}
```

**Response:** `201 Created`
```json
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "sync_mode": "per_participant",
  "status": "pending",
  "participants": [
    {
      "participant_id": "participant1-uuid",
      "total_time_ms": 600000,
      "is_active": false
    },
    {
      "participant_id": "participant2-uuid",
      "total_time_ms": 600000,
      "is_active": false
    }
  ],
  "version": 1,
  "created_at": "2025-10-20T14:30:00.000Z"
}
```

---

### 2. Start Session

**Endpoint:** `POST /sessions/:session_id/start`

**Description:** Starts the session (transitions from 'pending' to 'running').

**Response:** `200 OK`
```json
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "running",
  "cycle_started_at": "2025-10-20T14:30:00.000Z",
  "active_participant_id": "participant1-uuid"
}
```

---

### 3. Switch Cycle

**Endpoint:** `POST /sessions/:session_id/switch`

**Description:** Switches to the next participant/group. This is the **critical performance path**.

**Request Body:**
```json
{
  "current_participant_id": "participant1-uuid",
  "next_participant_id": "participant2-uuid"  // Optional: auto-detect if omitted
}
```

**Response (Success):** `200 OK`
```json
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "active_participant_id": "participant2-uuid",
  "cycle_started_at": "2025-10-20T14:30:05.123Z",
  "participants": [
    {
      "participant_id": "participant1-uuid",
      "total_time_ms": 598000,
      "is_active": false
    },
    {
      "participant_id": "participant2-uuid",
      "total_time_ms": 600000,
      "is_active": true
    }
  ],
  "status": "running"
}
```

**Response (Time Expired):** `200 OK`
```json
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "expired",
  "expired_participant_id": "participant1-uuid",
  "participants": [
    {
      "participant_id": "participant1-uuid",
      "total_time_ms": 0,
      "has_expired": true
    },
    {
      "participant_id": "participant2-uuid",
      "total_time_ms": 543000,
      "has_expired": false
    }
  ],
  "action_applied": {
    "type": "end_session",
    "outcome": "timeout",
    "winner": "participant2-uuid"
  }
}
```

---

### 4. Get Session State

**Endpoint:** `GET /sessions/:session_id`

**Description:** Retrieves the current session state with calculated time remaining.

**Response:** `200 OK`
```json
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "sync_mode": "per_participant",
  "status": "running",
  "active_participant_id": "participant1-uuid",
  "cycle_started_at": "2025-10-20T14:30:00.000Z",
  "participants": [
    {
      "participant_id": "participant1-uuid",
      "total_time_ms": 595000,
      "is_active": true
    },
    {
      "participant_id": "participant2-uuid",
      "total_time_ms": 600000,
      "is_active": false
    }
  ],
  "server_time": "2025-10-20T14:30:05.000Z"
}
```

---

### 5. Pause Session

**Endpoint:** `POST /sessions/:session_id/pause`

**Description:** Pauses the session.

**Response:** `200 OK`
```json
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "paused",
  "paused_at": "2025-10-20T14:35:00.000Z",
  "participants": [
    {
      "participant_id": "participant1-uuid",
      "total_time_ms": 595000
    }
  ]
}
```

---

### 6. Resume Session

**Endpoint:** `POST /sessions/:session_id/resume`

**Description:** Resumes a paused session.

**Response:** `200 OK`
```json
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "running",
  "cycle_started_at": "2025-10-20T14:36:00.000Z",
  "active_participant_id": "participant1-uuid"
}
```

---

### 7. Complete Session

**Endpoint:** `POST /sessions/:session_id/complete`

**Description:** Marks the session as completed (finished normally).

**Response:** `200 OK`
```json
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "completed",
  "completed_at": "2025-10-20T14:40:00.000Z"
}
```

---

### 8. Delete Session

**Endpoint:** `DELETE /sessions/:session_id`

**Description:** Removes the session (cancelled/abandoned).

**Response:** `200 OK`
```json
{
  "success": true,
  "message": "Session deleted for 550e8400-e29b-41d4-a716-446655440000"
}
```

---

### 9. Get Server Time (NTP Sync)

**Endpoint:** `GET /time`

**Description:** Returns server's current time for client synchronization.

**Response:** `200 OK`
```json
{
  "server_time": "2025-10-20T14:30:05.123Z",
  "timestamp_ms": 1729435805123
}
```

---

### 10. Add Participant to Session

**Endpoint:** `POST /sessions/:session_id/participants`

**Description:** Adds a new participant to an existing session (for dynamic sessions).

**Request Body:**
```json
{
  "participant_id": "participant3-uuid",
  "participant_index": 2,
  "total_time_ms": 600000
}
```

**Response:** `200 OK`

---

### 11. Update Participant Time

**Endpoint:** `PATCH /sessions/:session_id/participants/:participant_id`

**Description:** Manually adjust a participant's time (admin/moderator action).

**Request Body:**
```json
{
  "total_time_ms": 300000,
  "reason": "Technical issue compensation"
}
```

**Response:** `200 OK`

---

## WebSocket Protocol

### Connection

**WebSocket URL:** `wss://ws.synckairos.io/sessions/:session_id`

**Authentication:** JWT token as query parameter:
```
wss://ws.synckairos.io/sessions/550e8400-e29b-41d4-a716-446655440000?token=<jwt>
```

---

### Server → Client Events

#### 1. Session Update
Sent when session state changes (cycles, pauses, resumes).

```json
{
  "type": "SESSION_UPDATE",
  "payload": {
    "session_id": "550e8400-e29b-41d4-a716-446655440000",
    "active_participant_id": "participant2-uuid",
    "cycle_started_at": "2025-10-20T14:30:05.123Z",
    "participants": [
      {
        "participant_id": "participant1-uuid",
        "total_time_ms": 598000,
        "is_active": false
      },
      {
        "participant_id": "participant2-uuid",
        "total_time_ms": 600000,
        "is_active": true
      }
    ],
    "server_time_ms": 1729435805123
  }
}
```

#### 2. Time Expired
Sent when a participant/group runs out of time.

```json
{
  "type": "TIME_EXPIRED",
  "payload": {
    "session_id": "550e8400-e29b-41d4-a716-446655440000",
    "expired_participant_id": "participant1-uuid",
    "action_applied": {
      "type": "end_session",
      "outcome": "timeout",
      "winner": "participant2-uuid"
    }
  }
}
```

#### 3. Time Warning
Sent when time is running low (configurable threshold).

```json
{
  "type": "TIME_WARNING",
  "payload": {
    "session_id": "550e8400-e29b-41d4-a716-446655440000",
    "participant_id": "participant1-uuid",
    "time_remaining_ms": 10000,
    "threshold": "low"  // "low" | "critical"
  }
}
```

#### 4. Pong (Heartbeat)
Response to client PING for time sync.

```json
{
  "type": "PONG",
  "client_timestamp": 1729435800000,
  "server_timestamp": 1729435800050
}
```

---

### Client → Server Events

#### 1. Ping (Heartbeat)
Send every 5 seconds for connection health and time sync.

```json
{
  "type": "PING",
  "timestamp": 1729435800000
}
```

#### 2. Subscribe to Participant
Subscribe to specific participant's time updates.

```json
{
  "type": "SUBSCRIBE_PARTICIPANT",
  "participant_id": "participant1-uuid"
}
```

---

## Sync Engine Implementation

### Core Class: `SyncEngine`

```typescript
// src/engine/SyncEngine.ts

import { SupabaseClient } from '@supabase/supabase-js'

export type SyncMode = 'per_participant' | 'per_cycle' | 'per_group' | 'global' | 'count_up'
export type SyncStatus = 'pending' | 'running' | 'paused' | 'expired' | 'completed' | 'cancelled'

export interface SyncParticipant {
  participant_id: string
  group_id?: string
  participant_index: number
  total_time_ms: number
  time_used_ms: number
  cycle_count: number
  is_active: boolean
  has_expired: boolean
}

export interface SyncState {
  session_id: string
  sync_mode: SyncMode
  time_per_cycle_ms?: number
  increment_ms: number
  max_time_ms?: number
  active_participant_id?: string
  active_group_id?: string
  cycle_started_at?: Date
  status: SyncStatus
  action_on_timeout?: any
  auto_advance: boolean
  participants: SyncParticipant[]
  version: number
  metadata?: any
}

export interface SwitchCycleResult {
  session_id: string
  active_participant_id?: string
  cycle_started_at: Date
  participants: SyncParticipant[]
  status: SyncStatus
  expired_participant_id?: string
  action_applied?: any
}

export class SyncEngine {
  private db: SupabaseClient
  private activeSessions: Map<string, SyncState> = new Map()

  constructor(supabaseClient: SupabaseClient) {
    this.db = supabaseClient
  }

  /**
   * Create a new sync session
   */
  async createSession(config: {
    session_id: string
    sync_mode: SyncMode
    participants?: Array<{ participant_id: string; participant_index: number; total_time_ms: number }>
    time_per_cycle_ms?: number
    increment_ms?: number
    max_time_ms?: number
    active_participant_id?: string
    auto_advance?: boolean
    action_on_timeout?: any
    metadata?: any
  }): Promise<SyncState> {
    const {
      session_id,
      sync_mode,
      participants = [],
      time_per_cycle_ms,
      increment_ms = 0,
      max_time_ms,
      active_participant_id,
      auto_advance = false,
      action_on_timeout,
      metadata
    } = config

    // Create sync state
    const syncState: SyncState = {
      session_id,
      sync_mode,
      time_per_cycle_ms,
      increment_ms,
      max_time_ms,
      active_participant_id,
      status: 'pending',
      auto_advance,
      action_on_timeout,
      participants: [],
      version: 1,
      metadata
    }

    // Insert session state
    const { error: sessionError } = await this.db
      .from('sync_sessions')
      .insert({
        session_id,
        sync_mode,
        time_per_cycle_ms,
        increment_ms,
        max_time_ms,
        active_participant_id,
        status: 'pending',
        auto_advance,
        action_on_timeout,
        metadata,
        version: 1
      })

    if (sessionError) {
      throw new Error(`Failed to create session: ${sessionError.message}`)
    }

    // Insert participants
    if (participants.length > 0) {
      const participantRecords = participants.map(p => ({
        session_id,
        participant_id: p.participant_id,
        participant_index: p.participant_index,
        total_time_ms: p.total_time_ms,
        time_used_ms: 0,
        cycle_count: 0,
        is_active: p.participant_id === active_participant_id
      }))

      const { error: participantsError } = await this.db
        .from('sync_participants')
        .insert(participantRecords)

      if (participantsError) {
        throw new Error(`Failed to insert participants: ${participantsError.message}`)
      }

      syncState.participants = participantRecords
    }

    // Cache
    this.activeSessions.set(session_id, syncState)

    // Log event
    await this.logEvent(session_id, 'session_created', { sync_mode, participant_count: participants.length })

    return syncState
  }

  /**
   * Start the session
   */
  async startSession(sessionId: string): Promise<SyncState> {
    const session = await this.getSession(sessionId)

    if (session.status !== 'pending') {
      throw new Error(`Session is already ${session.status}`)
    }

    session.status = 'running'
    session.cycle_started_at = new Date()
    session.version += 1

    // Update DB
    await this.db
      .from('sync_sessions')
      .update({
        status: 'running',
        cycle_started_at: session.cycle_started_at.toISOString(),
        started_at: session.cycle_started_at.toISOString(),
        version: session.version
      })
      .eq('session_id', sessionId)

    this.activeSessions.set(sessionId, session)
    await this.logEvent(sessionId, 'session_started', { active_participant_id: session.active_participant_id })
    await this.broadcastUpdate(sessionId, session)

    return session
  }

  /**
   * Switch cycle (CRITICAL PERFORMANCE PATH)
   */
  async switchCycle(
    sessionId: string,
    currentParticipantId?: string,
    nextParticipantId?: string
  ): Promise<SwitchCycleResult> {
    const session = await this.getSession(sessionId)

    if (session.status !== 'running') {
      throw new Error(`Session is ${session.status}, cannot switch cycle`)
    }

    const now = new Date()
    const elapsed = session.cycle_started_at
      ? now.getTime() - session.cycle_started_at.getTime()
      : 0

    let expiredParticipantId: string | undefined
    let actionApplied: any

    // Update current participant's time
    if (session.sync_mode === 'per_participant' || session.sync_mode === 'per_group') {
      const currentParticipant = session.participants.find(p => p.is_active)

      if (currentParticipant) {
        currentParticipant.total_time_ms -= elapsed

        if (currentParticipant.total_time_ms <= 0) {
          // Time expired!
          currentParticipant.total_time_ms = 0
          currentParticipant.has_expired = true
          expiredParticipantId = currentParticipant.participant_id
          session.status = 'expired'

          // Apply action
          actionApplied = session.action_on_timeout
        } else {
          // Add increment
          currentParticipant.total_time_ms += session.increment_ms
        }

        currentParticipant.time_used_ms += elapsed
        currentParticipant.cycle_count += 1
        currentParticipant.is_active = false

        // Update participant in DB
        await this.db
          .from('sync_participants')
          .update({
            total_time_ms: currentParticipant.total_time_ms,
            time_used_ms: currentParticipant.time_used_ms,
            cycle_count: currentParticipant.cycle_count,
            is_active: false,
            has_expired: currentParticipant.has_expired
          })
          .eq('session_id', sessionId)
          .eq('participant_id', currentParticipant.participant_id)
      }
    }

    // Activate next participant (if no expiration)
    if (!expiredParticipantId) {
      let nextParticipant: SyncParticipant | undefined

      if (nextParticipantId) {
        nextParticipant = session.participants.find(p => p.participant_id === nextParticipantId)
      } else {
        // Auto-detect next participant based on participant_index
        const currentParticipant = session.participants.find(p => p.is_active) || session.participants[0]
        const currentIndex = currentParticipant.participant_index
        const nextIndex = (currentIndex + 1) % session.participants.length
        nextParticipant = session.participants.find(p => p.participant_index === nextIndex)
      }

      if (nextParticipant) {
        nextParticipant.is_active = true
        session.active_participant_id = nextParticipant.participant_id

        // Update in DB
        await this.db
          .from('sync_participants')
          .update({ is_active: true })
          .eq('session_id', sessionId)
          .eq('participant_id', nextParticipant.participant_id)
      }
    }

    // Update session state
    session.cycle_started_at = now
    session.version += 1

    await this.db
      .from('sync_sessions')
      .update({
        active_participant_id: session.active_participant_id,
        cycle_started_at: session.cycle_started_at.toISOString(),
        status: session.status,
        version: session.version
      })
      .eq('session_id', sessionId)

    this.activeSessions.set(sessionId, session)
    await this.logEvent(sessionId, 'cycle_switched', {
      from_participant: currentParticipantId,
      to_participant: session.active_participant_id,
      expired: !!expiredParticipantId
    })
    await this.broadcastUpdate(sessionId, session)

    return {
      session_id: sessionId,
      active_participant_id: session.active_participant_id,
      cycle_started_at: session.cycle_started_at,
      participants: session.participants,
      status: session.status,
      expired_participant_id: expiredParticipantId,
      action_applied: actionApplied
    }
  }

  /**
   * Get current session state (with calculated times)
   */
  async getCurrentState(sessionId: string): Promise<SyncState> {
    const session = await this.getSession(sessionId)

    if (session.status !== 'running') {
      return session
    }

    // Calculate current time for active participant
    const now = Date.now()
    const elapsed = session.cycle_started_at
      ? now - session.cycle_started_at.getTime()
      : 0

    const currentState = JSON.parse(JSON.stringify(session)) // Deep copy

    if (session.sync_mode === 'per_participant' || session.sync_mode === 'per_group') {
      const activeParticipant = currentState.participants.find((p: SyncParticipant) => p.is_active)
      if (activeParticipant) {
        activeParticipant.total_time_ms = Math.max(0, activeParticipant.total_time_ms - elapsed)
      }
    }

    return currentState
  }

  /**
   * Pause session
   */
  async pauseSession(sessionId: string): Promise<SyncState> {
    const session = await this.getSession(sessionId)

    if (session.status !== 'running') {
      throw new Error('Session is not running')
    }

    // Calculate and save current participant's time
    const now = Date.now()
    const elapsed = session.cycle_started_at
      ? now - session.cycle_started_at.getTime()
      : 0

    const activeParticipant = session.participants.find(p => p.is_active)
    if (activeParticipant && (session.sync_mode === 'per_participant' || session.sync_mode === 'per_group')) {
      activeParticipant.total_time_ms = Math.max(0, activeParticipant.total_time_ms - elapsed)

      await this.db
        .from('sync_participants')
        .update({ total_time_ms: activeParticipant.total_time_ms })
        .eq('session_id', sessionId)
        .eq('participant_id', activeParticipant.participant_id)
    }

    session.status = 'paused'
    session.version += 1

    await this.db
      .from('sync_sessions')
      .update({ status: 'paused', version: session.version })
      .eq('session_id', sessionId)

    this.activeSessions.set(sessionId, session)
    await this.logEvent(sessionId, 'session_paused', {})
    await this.broadcastUpdate(sessionId, session)

    return session
  }

  /**
   * Resume session
   */
  async resumeSession(sessionId: string): Promise<SyncState> {
    const session = await this.getSession(sessionId)

    if (session.status !== 'paused') {
      throw new Error('Session is not paused')
    }

    session.status = 'running'
    session.cycle_started_at = new Date()
    session.version += 1

    await this.db
      .from('sync_sessions')
      .update({
        status: 'running',
        cycle_started_at: session.cycle_started_at.toISOString(),
        version: session.version
      })
      .eq('session_id', sessionId)

    this.activeSessions.set(sessionId, session)
    await this.logEvent(sessionId, 'session_resumed', {})
    await this.broadcastUpdate(sessionId, session)

    return session
  }

  /**
   * Complete session (when session finishes)
   */
  async completeSession(sessionId: string): Promise<SyncState> {
    const session = await this.getSession(sessionId)

    session.status = 'completed'
    const completedAt = new Date()

    await this.db
      .from('sync_sessions')
      .update({
        status: 'completed',
        completed_at: completedAt.toISOString()
      })
      .eq('session_id', sessionId)

    this.activeSessions.delete(sessionId)
    await this.logEvent(sessionId, 'session_completed', {})

    return session
  }

  /**
   * Delete session
   */
  async deleteSession(sessionId: string): Promise<void> {
    await this.db.from('sync_sessions').delete().eq('session_id', sessionId)
    this.activeSessions.delete(sessionId)
  }

  /**
   * Get session from cache or DB
   */
  private async getSession(sessionId: string): Promise<SyncState> {
    let session = this.activeSessions.get(sessionId)

    if (!session) {
      // Load from DB
      const { data: sessionData, error: sessionError } = await this.db
        .from('sync_sessions')
        .select('*')
        .eq('session_id', sessionId)
        .single()

      if (sessionError || !sessionData) {
        throw new Error(`Session not found: ${sessionId}`)
      }

      const { data: participantsData, error: participantsError } = await this.db
        .from('sync_participants')
        .select('*')
        .eq('session_id', sessionId)
        .order('participant_index')

      if (participantsError) {
        throw new Error(`Failed to load participants: ${participantsError.message}`)
      }

      session = {
        ...sessionData,
        cycle_started_at: sessionData.cycle_started_at ? new Date(sessionData.cycle_started_at) : undefined,
        participants: participantsData || []
      } as SyncState

      this.activeSessions.set(sessionId, session)
    }

    return session
  }

  /**
   * Log event to audit table
   */
  private async logEvent(sessionId: string, eventType: string, metadata: any) {
    await this.db.from('sync_events').insert({
      session_id: sessionId,
      event_type: eventType,
      metadata
    })
  }

  /**
   * Broadcast update via WebSocket (implemented by WS layer)
   */
  private async broadcastUpdate(sessionId: string, session: SyncState) {
    // WebSocket broadcast implementation
  }
}
```

---

## Frontend SDK Client

```typescript
// src/sdk/SyncKairosClient.ts

export class SyncKairosClient {
  private apiUrl: string
  private wsUrl: string
  private socket: WebSocket | null = null
  private serverTimeOffset = 0
  private eventHandlers: Map<string, Function[]> = new Map()

  constructor(apiUrl: string, wsUrl: string) {
    this.apiUrl = apiUrl
    this.wsUrl = wsUrl
  }

  /**
   * Create a new sync session
   */
  async createSession(config: {
    session_id: string
    sync_mode: 'per_participant' | 'per_cycle' | 'per_group' | 'global' | 'count_up'
    participants?: Array<{ participant_id: string; participant_index: number; total_time_ms: number }>
    time_per_cycle_ms?: number
    increment_ms?: number
    max_time_ms?: number
    active_participant_id?: string
    auto_advance?: boolean
    action_on_timeout?: any
  }): Promise<any> {
    const response = await fetch(`${this.apiUrl}/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.getAuthToken()}`
      },
      body: JSON.stringify(config)
    })

    if (!response.ok) {
      throw new Error(`Failed to create session: ${response.statusText}`)
    }

    return response.json()
  }

  /**
   * Start session
   */
  async startSession(sessionId: string): Promise<any> {
    const response = await fetch(`${this.apiUrl}/sessions/${sessionId}/start`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.getAuthToken()}` }
    })

    if (!response.ok) {
      throw new Error(`Failed to start session: ${response.statusText}`)
    }

    return response.json()
  }

  /**
   * Switch cycle (advance to next participant or cycle)
   */
  async switchCycle(sessionId: string, currentParticipantId?: string, nextParticipantId?: string): Promise<any> {
    const response = await fetch(`${this.apiUrl}/sessions/${sessionId}/switch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.getAuthToken()}`
      },
      body: JSON.stringify({ current_participant_id: currentParticipantId, next_participant_id: nextParticipantId })
    })

    if (!response.ok) {
      throw new Error(`Failed to switch cycle: ${response.statusText}`)
    }

    const result = await response.json()

    if (result.expired_participant_id) {
      this.emit('timeout_occurred', result)
    }

    return result
  }

  /**
   * Get session state
   */
  async getSession(sessionId: string): Promise<any> {
    const response = await fetch(`${this.apiUrl}/sessions/${sessionId}`, {
      headers: { 'Authorization': `Bearer ${this.getAuthToken()}` }
    })

    if (!response.ok) {
      throw new Error(`Failed to get session: ${response.statusText}`)
    }

    return response.json()
  }

  /**
   * Pause session
   */
  async pauseSession(sessionId: string): Promise<any> {
    const response = await fetch(`${this.apiUrl}/sessions/${sessionId}/pause`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.getAuthToken()}` }
    })

    if (!response.ok) {
      throw new Error(`Failed to pause session: ${response.statusText}`)
    }

    return response.json()
  }

  /**
   * Resume session
   */
  async resumeSession(sessionId: string): Promise<any> {
    const response = await fetch(`${this.apiUrl}/sessions/${sessionId}/resume`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.getAuthToken()}` }
    })

    if (!response.ok) {
      throw new Error(`Failed to resume session: ${response.statusText}`)
    }

    return response.json()
  }

  /**
   * Complete session
   */
  async completeSession(sessionId: string): Promise<any> {
    const response = await fetch(`${this.apiUrl}/sessions/${sessionId}/complete`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.getAuthToken()}` }
    })

    if (!response.ok) {
      throw new Error(`Failed to complete session: ${response.statusText}`)
    }

    return response.json()
  }

  /**
   * Delete session
   */
  async deleteSession(sessionId: string): Promise<void> {
    await fetch(`${this.apiUrl}/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${this.getAuthToken()}` }
    })
  }

  /**
   * Connect WebSocket for real-time updates
   */
  connectWebSocket(sessionId: string, onUpdate: (state: any) => void) {
    const token = this.getAuthToken()
    this.socket = new WebSocket(`${this.wsUrl}/sessions/${sessionId}?token=${token}`)

    this.socket.onopen = () => {
      console.log(`WebSocket connected for session ${sessionId}`)
      this.startHeartbeat()
    }

    this.socket.onmessage = (event) => {
      const message = JSON.parse(event.data)

      switch (message.type) {
        case 'SESSION_UPDATE':
          onUpdate(message.payload)
          break
        case 'TIMEOUT_OCCURRED':
          this.emit('timeout_occurred', message.payload)
          break
        case 'TIMEOUT_WARNING':
          this.emit('timeout_warning', message.payload)
          break
        case 'PONG':
          this.updateServerTimeOffset(message)
          break
      }
    }

    this.socket.onerror = (error) => {
      console.error('WebSocket error:', error)
      this.emit('error', error)
    }

    this.socket.onclose = () => {
      console.log('WebSocket disconnected')
      this.emit('disconnect', {})
    }
  }

  /**
   * Sync server time
   */
  async syncServerTime() {
    const t0 = Date.now()
    const response = await fetch(`${this.apiUrl}/time`)
    const t1 = Date.now()
    const { timestamp_ms: serverTime } = await response.json()

    const roundTripTime = t1 - t0
    this.serverTimeOffset = serverTime - t0 - (roundTripTime / 2)
  }

  /**
   * Get server time
   */
  getServerTime(): number {
    return Date.now() + this.serverTimeOffset
  }

  /**
   * Event emitter
   */
  on(event: string, handler: Function) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, [])
    }
    this.eventHandlers.get(event)!.push(handler)
  }

  private emit(event: string, data: any) {
    const handlers = this.eventHandlers.get(event)
    if (handlers) {
      handlers.forEach(handler => handler(data))
    }
  }

  private startHeartbeat() {
    setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({
          type: 'PING',
          timestamp: Date.now()
        }))
      }
    }, 5000)
  }

  private updateServerTimeOffset(pong: { client_timestamp: number, server_timestamp: number }) {
    const now = Date.now()
    const roundTrip = now - pong.client_timestamp
    this.serverTimeOffset = pong.server_timestamp - pong.client_timestamp - (roundTrip / 2)
  }

  private getAuthToken(): string {
    // Implement based on your auth system
    return ''
  }

  disconnect() {
    this.socket?.close()
    this.socket = null
  }
}
```

---

## React Integration

### React Hook: `useSyncKairos`

```typescript
// src/hooks/useSyncKairos.ts

import { useState, useEffect, useRef } from 'react'
import { SyncKairosClient } from '../sdk/SyncKairosClient'

export function useSyncKairos(
  sessionId: string,
  syncClient: SyncKairosClient,
  participantId?: string
) {
  const [sessionState, setSessionState] = useState<any>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const now = useNow(100)
  const reconnectAttempts = useRef(0)

  // Load initial state
  useEffect(() => {
    async function loadSession() {
      try {
        const state = await syncClient.getSession(sessionId)
        setSessionState(state)
        await syncClient.syncServerTime()
      } catch (err: any) {
        console.error('Failed to load session:', err)
        setError(err.message)
      }
    }

    loadSession()
  }, [sessionId, syncClient])

  // Subscribe to WebSocket
  useEffect(() => {
    syncClient.connectWebSocket(sessionId, (newState: any) => {
      setSessionState(newState)
      setIsConnected(true)
      reconnectAttempts.current = 0
    })

    syncClient.on('disconnect', () => {
      setIsConnected(false)
      // Reconnect logic...
    })

    syncClient.on('error', (err: any) => {
      setError(err.message)
    })

    return () => {
      syncClient.disconnect()
    }
  }, [sessionId, syncClient])

  /**
   * Calculate time remaining for a participant
   */
  function getParticipantTime(targetParticipantId: string): number {
    if (!sessionState || sessionState.status !== 'running') {
      const participant = sessionState?.participants?.find((p: any) => p.participant_id === targetParticipantId)
      return participant?.total_time_ms || 0
    }

    const participant = sessionState.participants.find((p: any) => p.participant_id === targetParticipantId)
    if (!participant) return 0

    if (!participant.is_active) {
      return participant.total_time_ms
    }

    // Calculate elapsed time
    const serverNow = syncClient.getServerTime()
    const cycleStartMs = new Date(sessionState.cycle_started_at).getTime()
    const elapsed = serverNow - cycleStartMs

    return Math.max(0, participant.total_time_ms - elapsed)
  }

  /**
   * Get all participants with calculated times
   */
  function getAllParticipantTimes(): Record<string, number> {
    if (!sessionState?.participants) return {}

    const times: Record<string, number> = {}
    sessionState.participants.forEach((participant: any) => {
      times[participant.participant_id] = getParticipantTime(participant.participant_id)
    })
    return times
  }

  return {
    sessionState,
    getParticipantTime,
    getAllParticipantTimes,
    activeParticipantId: sessionState?.active_participant_id,
    status: sessionState?.status,
    isConnected,
    error,

    // Actions
    startSession: () => syncClient.startSession(sessionId),
    switchCycle: (nextParticipantId?: string) => syncClient.switchCycle(sessionId, participantId, nextParticipantId),
    pauseSession: () => syncClient.pauseSession(sessionId),
    resumeSession: () => syncClient.resumeSession(sessionId),
    completeSession: () => syncClient.completeSession(sessionId)
  }
}

function useNow(intervalMs: number = 100): number {
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(interval)
  }, [intervalMs])

  return now
}
```

---

## Deployment Strategy

Same as chess clock service (see original document), but with broader applicability.

---

## Performance Requirements

| Metric | Target | Expected |
|--------|--------|----------|
| Cycle switch latency | < 50ms | 20-30ms |
| WebSocket update delivery | < 100ms | 50-80ms |
| Server time sync accuracy | < 50ms | 10-30ms |
| Time calculation accuracy | ±10ms | ±5ms |
| Concurrent sessions | 10,000+ | 50,000+ |

---

## Integration Examples

### Example 1: Chess Integration

```typescript
// Chess game integration
const syncClient = new SyncKairosClient(API_URL, WS_URL)

// Create sync session when game starts
// sync_mode: "per_participant"  // Maps to: per-player in chess
await syncClient.createSession({
  session_id: chessGame.id,
  sync_mode: 'per_participant',
  participants: [
    { participant_id: whitePlayer.id, participant_index: 0, total_time_ms: 600000 },
    { participant_id: blackPlayer.id, participant_index: 1, total_time_ms: 600000 }
  ],
  increment_ms: 3000,
  active_participant_id: whitePlayer.id,
  action_on_timeout: { type: 'game_over', winner: 'opponent' }
})

// Start session
await syncClient.startSession(chessGame.id)

// Use in component
const { getParticipantTime, switchCycle } = useSyncKairos(chessGame.id, syncClient, user.id)

// After each move
await switchCycle()
```

### Example 2: Quiz Game Integration

```typescript
// Quiz game integration
// sync_mode: "per_cycle"  // Maps to: per-question in quiz
await syncClient.createSession({
  session_id: quiz.id,
  sync_mode: 'per_cycle',
  time_per_cycle_ms: 30000,  // 30 seconds per question
  auto_advance: true,
  action_on_timeout: { type: 'skip_question' }
})

await syncClient.startSession(quiz.id)

// Component
const { sessionState, getParticipantTime } = useSyncKairos(quiz.id, syncClient)

// Display countdown
<QuizTimer timeMs={getParticipantTime('global')} />

// Auto-advance on timeout
syncClient.on('timeout_occurred', () => {
  skipQuestion()
  switchCycle()
})
```

### Example 3: Poker Game Integration

```typescript
// Poker game integration
// sync_mode: "per_cycle"  // Maps to: per-turn in poker
await syncClient.createSession({
  session_id: poker.id,
  sync_mode: 'per_cycle',
  participants: players.map((p, i) => ({
    participant_id: p.id,
    participant_index: i,
    total_time_ms: 0  // Not used in per_cycle mode
  })),
  time_per_cycle_ms: 30000,
  active_participant_id: dealer.id,
  auto_advance: true,
  action_on_timeout: { type: 'auto_fold' }
})

// Auto-fold on timeout
syncClient.on('timeout_occurred', ({ expired_participant_id }) => {
  foldPlayer(expired_participant_id)
})
```

---

## Conclusion

**SyncKairos** is a universal, high-performance real-time synchronization service that goes beyond games. It provides precise, synchronized timing for any application requiring coordinated time across multiple clients:

**Applications:**
- 🎮 **Gaming** - Chess, poker, quiz games, any turn-based game
- 🎤 **Live Events** - Concerts, auctions, sports, live shows
- 💼 **Business** - Meetings, presentations, sprints, break timers
- 📚 **Education** - Exams, classroom activities, study sessions
- 🧘 **Lifestyle** - Meditation, cooking, fitness, global countdowns

### Key Benefits

1. **Universal** - One service, unlimited use cases
2. **Scalable** - 50,000+ concurrent sessions worldwide
3. **Accurate** - Sub-100ms synchronization across all clients
4. **Flexible** - Multiple sync modes for different scenarios
5. **Maintainable** - Centralized sync logic, audit trails
6. **Brandable** - Clean API, professional service

### The Perfect Moment, Synchronized

> "SyncKairos synchronizes the perfect moment, everywhere."

---

**Service Name:** SyncKairos
**Package Name:** `synckairos`
**Document Version:** 3.0 (Universal)
**Last Updated:** 2025-10-20
**Author:** SyncKairos Development Team
**Status:** Ready for Implementation
**URL:** https://synckairos.io
