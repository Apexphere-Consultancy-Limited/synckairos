# SyncKairos - API Reference

**Version:** 2.0
**Last Updated:** 2025-10-20

---

## Base URL

```
Production: https://api.synckairos.io/v1
Development: http://localhost:3000/v1
```

## Authentication

All endpoints require authentication via JWT token:
```
Authorization: Bearer <jwt_token>
```

---

## REST API Endpoints

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
