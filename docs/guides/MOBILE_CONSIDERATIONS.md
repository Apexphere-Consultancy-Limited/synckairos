# SyncKairos - Mobile Client Considerations

**Version:** 2.0
**Last Updated:** 2025-10-21
**Status:** Backend Requirements for Mobile Compatibility

---

## Executive Summary

This document outlines the **backend requirements and considerations** to ensure SyncKairos is fully compatible with future native mobile clients (iOS and Android apps that will be built separately).

**Scope:** This is a **backend-only project**. Mobile apps will be separate projects that consume this API. This document focuses on what the backend needs to provide for mobile compatibility.

---

## Mobile Client Challenges (Backend Perspective)

### 1. Network Reliability

Mobile networks are unreliable:
- WiFi ↔ Cellular transitions
- Signal loss (tunnels, elevators)
- Network quality fluctuations
- High latency on poor connections

**Backend Requirements:**
- ✅ Robust WebSocket reconnection handling
- ✅ Graceful degradation when connections drop
- ✅ Idempotent endpoints (safe to retry)
- ✅ Optimized payload sizes
- ✅ Optional polling fallback for poor connections

### 2. Battery Consumption

Mobile clients need to minimize battery drain:
- Persistent WebSocket connections consume power
- Frequent polling is expensive
- Background processing is limited

**Backend Requirements:**
- ✅ Efficient WebSocket protocol (minimal heartbeats)
- ✅ Push notifications for critical events (wake app from background)
- ✅ Support for adaptive connection strategies
- ✅ Batch endpoints to reduce request count

### 3. Background Limitations

iOS and Android restrict background apps:
- WebSocket connections killed when app backgrounded
- Limited background processing time

**Backend Requirements:**
- ✅ Push notifications via Firebase (APNs for iOS, FCM for Android)
- ✅ Session state preservation (clients can reconnect anytime)
- ✅ No server-side timeouts for idle connections

### 4. Platform Differences

iOS and Android behave differently:

**Backend Requirements:**
- ✅ Platform-agnostic API (standard REST + WebSocket)
- ✅ Support for both APNs (iOS) and FCM (Android) push notifications
- ✅ CORS configured for mobile WebView (if needed)

---

## Backend Features for Mobile Compatibility

### 1. Push Notification Support

**Required:** Firebase Cloud Messaging (FCM) integration

**Why FCM:**
- Works for both iOS (via APNs) and Android
- Reliable delivery
- Free tier sufficient for most use cases

**Backend Implementation:**

```typescript
// src/services/PushNotificationService.ts
import admin from 'firebase-admin'

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  })
})

export class PushNotificationService {
  /**
   * Notify when participant time expires
   */
  async notifyTimeExpired(
    userId: string,
    sessionId: string,
    participantId: string
  ): Promise<void> {
    const tokens = await this.getUserDeviceTokens(userId)

    if (tokens.length === 0) return

    await admin.messaging().sendMulticast({
      tokens,
      notification: {
        title: 'Time Expired!',
        body: 'Your time has run out'
      },
      data: {
        type: 'TIME_EXPIRED',
        sessionId,
        participantId
      },
      // iOS-specific config
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
            contentAvailable: true  // Wake app
          }
        }
      },
      // Android-specific config
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channelId: 'time-critical'
        }
      }
    })
  }

  /**
   * Warning notification (10s, 5s, 1s remaining)
   */
  async notifyTimeWarning(
    userId: string,
    sessionId: string,
    timeRemainingMs: number
  ): Promise<void> {
    const tokens = await this.getUserDeviceTokens(userId)

    await admin.messaging().sendMulticast({
      tokens,
      notification: {
        title: 'Time Running Low',
        body: `${Math.floor(timeRemainingMs / 1000)} seconds remaining`
      },
      data: {
        type: 'TIME_WARNING',
        sessionId,
        timeRemainingMs: String(timeRemainingMs)
      }
    })
  }

  private async getUserDeviceTokens(userId: string): Promise<string[]> {
    // Query database for user's registered devices
    const result = await db.query(
      'SELECT device_token FROM user_devices WHERE user_id = $1 AND active = true',
      [userId]
    )
    return result.rows.map(row => row.device_token)
  }
}
```

**Integration with SyncEngine:**

```typescript
// src/engine/SyncEngine.ts
import { PushNotificationService } from '../services/PushNotificationService'

export class SyncEngine {
  private pushService: PushNotificationService

  async switchCycle(sessionId: string): Promise<SwitchCycleResult> {
    // ... existing logic ...

    // If time expired, send push notification
    if (currentParticipant?.has_expired) {
      await this.pushService.notifyTimeExpired(
        currentParticipant.user_id,
        sessionId,
        currentParticipant.participant_id
      )
    }

    // If time is low (< 10s), send warning
    if (activeParticipant.total_time_ms < 10000) {
      await this.pushService.notifyTimeWarning(
        activeParticipant.user_id,
        sessionId,
        activeParticipant.total_time_ms
      )
    }

    return result
  }
}
```

---

### 2. Device Registration Endpoints

Mobile clients need to register their device tokens for push notifications.

**Database Schema:**

```sql
CREATE TABLE user_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  device_token TEXT NOT NULL,
  platform VARCHAR(10) NOT NULL,  -- 'ios' or 'android'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  active BOOLEAN DEFAULT true,

  UNIQUE(user_id, device_token)
);

CREATE INDEX idx_user_devices_user_id ON user_devices(user_id);
CREATE INDEX idx_user_devices_active ON user_devices(user_id, active);
```

**API Endpoints:**

```typescript
// src/api/routes/devices.ts
import { Router } from 'express'
import { authenticate } from '../middlewares/auth'
import { z } from 'zod'

const router = Router()

const RegisterDeviceSchema = z.object({
  device_token: z.string().min(1),
  platform: z.enum(['ios', 'android'])
})

/**
 * POST /users/:userId/devices
 * Register device for push notifications
 */
router.post('/users/:userId/devices', authenticate, async (req, res) => {
  const { userId } = req.params

  // Ensure user can only register their own devices
  if (req.user.id !== userId) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  const result = RegisterDeviceSchema.safeParse(req.body)
  if (!result.success) {
    return res.status(400).json({ errors: result.error.errors })
  }

  const { device_token, platform } = result.data

  await db.query(
    `INSERT INTO user_devices (user_id, device_token, platform)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, device_token)
     DO UPDATE SET updated_at = NOW(), active = true`,
    [userId, device_token, platform]
  )

  res.json({ success: true })
})

/**
 * DELETE /users/:userId/devices/:token
 * Unregister device (on logout or app uninstall)
 */
router.delete('/users/:userId/devices/:token', authenticate, async (req, res) => {
  const { userId, token } = req.params

  if (req.user.id !== userId) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  await db.query(
    'UPDATE user_devices SET active = false WHERE user_id = $1 AND device_token = $2',
    [userId, token]
  )

  res.json({ success: true })
})

export default router
```

---

### 3. Mobile-Optimized Endpoints

**a) Polling Fallback (for poor connections)**

When WebSocket is unreliable, allow polling:

```typescript
// src/api/routes/sessions.ts

/**
 * GET /sessions/:id/poll
 * Optimized polling endpoint for mobile clients with poor connections
 * Returns 304 Not Modified if state hasn't changed
 */
router.get('/sessions/:id/poll', authenticate, async (req, res) => {
  const { id } = req.params
  const { since_version } = req.query

  const state = await syncEngine.getCurrentState(id)

  // Only return if version changed (reduce bandwidth)
  if (since_version && state.version <= parseInt(since_version as string)) {
    return res.status(304).end() // Not Modified
  }

  // Set cache headers
  res.set('Cache-Control', 'no-cache, must-revalidate')
  res.json(state)
})
```

**b) Batch Endpoint (reduce requests)**

Mobile clients may need multiple sessions:

```typescript
/**
 * POST /sessions/batch
 * Get multiple sessions in one request
 */
router.post('/sessions/batch', authenticate, async (req, res) => {
  const { session_ids } = req.body

  if (!Array.isArray(session_ids) || session_ids.length > 50) {
    return res.status(400).json({ error: 'Invalid session_ids (max 50)' })
  }

  const states = await Promise.all(
    session_ids.map(id => syncEngine.getCurrentState(id).catch(() => null))
  )

  res.json({
    sessions: states.filter(s => s !== null)
  })
})
```

**c) Lightweight State Endpoint**

For bandwidth-constrained connections:

```typescript
/**
 * GET /sessions/:id/summary
 * Lightweight summary (no full state)
 */
router.get('/sessions/:id/summary', authenticate, async (req, res) => {
  const state = await syncEngine.getCurrentState(req.params.id)

  res.json({
    session_id: state.session_id,
    status: state.status,
    active_participant_id: state.active_participant_id,
    version: state.version,
    // Omit full participants array, metadata, etc.
  })
})
```

---

### 4. WebSocket Enhancements for Mobile

**a) Adaptive Heartbeat**

Allow clients to request different heartbeat intervals:

```typescript
// src/websocket/WebSocketServer.ts
import WebSocket from 'ws'

export class WebSocketServer {
  private handleConnection(ws: WebSocket, req: any) {
    const userAgent = req.headers['user-agent'] || ''
    const isMobile = /iPhone|Android|Mobile/.test(userAgent)

    // Mobile devices get longer heartbeat (save battery)
    const heartbeatInterval = isMobile ? 30000 : 15000

    const heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping()
      }
    }, heartbeatInterval)

    ws.on('close', () => clearInterval(heartbeat))
  }
}
```

**b) Connection Quality Headers**

Help clients decide between WebSocket and polling:

```typescript
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    websocket_available: true,
    polling_available: true,
    recommended_strategy: 'websocket' // or 'polling' if under load
  })
})
```

---

### 5. HTTP/2 Support

HTTP/2 improves mobile performance:
- Multiplexing (multiple requests over single connection)
- Header compression
- Server push (optional)

**Implementation:**

```typescript
// src/index.ts
import http2 from 'http2'
import fs from 'fs'
import express from 'express'

const app = express()

// HTTP/2 server (requires HTTPS)
const server = http2.createSecureServer({
  key: fs.readFileSync(process.env.SSL_KEY_PATH!),
  cert: fs.readFileSync(process.env.SSL_CERT_PATH!),
  allowHTTP1: true  // Fallback to HTTP/1.1
}, app)

server.listen(3000)
```

**Benefits for mobile:**
- Single TCP connection (saves battery)
- Less bandwidth usage
- Faster parallel requests

---

### 6. CORS Configuration

Mobile apps (especially hybrid WebView apps) need proper CORS:

```typescript
// src/index.ts
import cors from 'cors'

app.use(cors({
  origin: (origin, callback) => {
    // Allow mobile apps (capacitor://, ionic://, etc.)
    const allowedOrigins = [
      /^https:\/\/.*\.synckairos\.io$/,
      /^capacitor:\/\/localhost$/,
      /^ionic:\/\/localhost$/,
      /^http:\/\/localhost:.*$/  // Development
    ]

    if (!origin || allowedOrigins.some(pattern => pattern.test(origin))) {
      callback(null, true)
    } else {
      callback(new Error('Not allowed by CORS'))
    }
  },
  credentials: true
}))
```

---

### 7. Idempotency for Reliability

Mobile clients may retry failed requests. Make critical endpoints idempotent:

```typescript
/**
 * POST /sessions/:id/switch
 * Idempotent cycle switching using idempotency keys
 */
router.post('/sessions/:id/switch', authenticate, async (req, res) => {
  const { id } = req.params
  const idempotencyKey = req.headers['idempotency-key'] as string

  if (!idempotencyKey) {
    return res.status(400).json({ error: 'Idempotency-Key header required' })
  }

  // Check if request already processed
  const cached = await redis.get(`idempotency:${idempotencyKey}`)
  if (cached) {
    return res.json(JSON.parse(cached))
  }

  // Process request
  const result = await syncEngine.switchCycle(id)

  // Cache result for 24 hours
  await redis.setex(
    `idempotency:${idempotencyKey}`,
    86400,
    JSON.stringify(result)
  )

  res.json(result)
})
```

---

### 8. Payload Optimization

Minimize response sizes for mobile:

**a) Gzip Compression**

```typescript
import compression from 'compression'

app.use(compression({
  level: 6,  // Balance between speed and compression
  threshold: 1024  // Only compress responses > 1KB
}))
```

**b) Field Selection**

Allow clients to request only needed fields:

```typescript
/**
 * GET /sessions/:id?fields=status,active_participant_id
 */
router.get('/sessions/:id', authenticate, async (req, res) => {
  const state = await syncEngine.getCurrentState(req.params.id)

  const fields = req.query.fields as string | undefined
  if (fields) {
    const requestedFields = fields.split(',')
    const filtered = Object.fromEntries(
      Object.entries(state).filter(([key]) => requestedFields.includes(key))
    )
    return res.json(filtered)
  }

  res.json(state)
})
```

---

## Dependencies for Mobile Support

Add to backend `package.json`:

```json
{
  "dependencies": {
    "firebase-admin": "^11.11.0",   // Push notifications
    "compression": "^1.7.4"          // Gzip compression
  }
}
```

---

## Environment Variables

Add to `.env`:

```bash
# Push Notifications (Firebase)
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# SSL for HTTP/2 (optional)
SSL_KEY_PATH=/path/to/server-key.pem
SSL_CERT_PATH=/path/to/server-cert.pem
```

---

## Database Schema Additions

```sql
-- User devices for push notifications
CREATE TABLE user_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_token TEXT NOT NULL,
  platform VARCHAR(10) NOT NULL CHECK (platform IN ('ios', 'android')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  active BOOLEAN DEFAULT true,

  UNIQUE(user_id, device_token)
);

CREATE INDEX idx_user_devices_user_id ON user_devices(user_id);
CREATE INDEX idx_user_devices_active ON user_devices(user_id, active);

-- Idempotency tracking (optional, can use Redis instead)
CREATE TABLE idempotency_keys (
  key VARCHAR(255) PRIMARY KEY,
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_idempotency_created ON idempotency_keys(created_at);

-- Cleanup old keys (keep for 24 hours)
-- Run as cron job or background task
DELETE FROM idempotency_keys WHERE created_at < NOW() - INTERVAL '24 hours';
```

---

## Testing Mobile Compatibility

### 1. Network Simulation

Test with poor network conditions:

```bash
# Install network throttling tool
npm install -g throttle

# Simulate 3G connection
throttle -u 750 -d 250 -l 100 node dist/index.js
```

### 2. WebSocket Reconnection Test

```typescript
// tests/websocket-reconnection.test.ts
import { describe, it, expect } from 'vitest'
import WebSocket from 'ws'

describe('WebSocket Reconnection', () => {
  it('should handle client disconnection gracefully', async () => {
    const ws = new WebSocket('ws://localhost:3001/sessions/123')

    // Wait for connection
    await new Promise(resolve => ws.on('open', resolve))

    // Simulate network drop
    ws.terminate()

    // Reconnect
    const ws2 = new WebSocket('ws://localhost:3001/sessions/123')
    await new Promise(resolve => ws2.on('open', resolve))

    // Should receive current state
    const message = await new Promise(resolve => {
      ws2.on('message', (data) => resolve(JSON.parse(data.toString())))
    })

    expect(message.type).toBe('STATE_SYNC')
  })
})
```

### 3. Push Notification Test

```typescript
// tests/push-notifications.test.ts
import { PushNotificationService } from '../src/services/PushNotificationService'

describe('Push Notifications', () => {
  it('should send notification when time expires', async () => {
    const service = new PushNotificationService()

    await expect(
      service.notifyTimeExpired('user-123', 'session-456', 'participant-789')
    ).resolves.not.toThrow()
  })
})
```

---

## Monitoring Mobile Clients

Track mobile-specific metrics:

```typescript
// src/monitoring/metrics.ts
import { Counter, Histogram } from 'prom-client'

// Mobile client requests
const mobileRequestsCounter = new Counter({
  name: 'synckairos_mobile_requests_total',
  help: 'Total requests from mobile clients',
  labelNames: ['platform', 'endpoint']
})

// Push notification delivery
const pushNotificationCounter = new Counter({
  name: 'synckairos_push_notifications_total',
  help: 'Total push notifications sent',
  labelNames: ['platform', 'type', 'status']
})

// WebSocket connection duration (mobile vs web)
const connectionDuration = new Histogram({
  name: 'synckairos_websocket_duration_seconds',
  help: 'WebSocket connection duration',
  labelNames: ['client_type'],
  buckets: [1, 5, 10, 30, 60, 300, 600, 1800, 3600]
})
```

---

## Documentation for Client Developers

Provide clear API documentation for mobile app developers:

### OpenAPI Spec

Generate OpenAPI/Swagger spec:

```typescript
// src/api/openapi.ts
export const openApiSpec = {
  openapi: '3.0.0',
  info: {
    title: 'SyncKairos API',
    version: '2.0.0',
    description: 'Real-time synchronization service for mobile and web clients'
  },
  servers: [
    { url: 'https://api.synckairos.io/v1', description: 'Production' },
    { url: 'http://localhost:3000/v1', description: 'Development' }
  ],
  paths: {
    '/sessions': {
      post: {
        summary: 'Create a new session',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateSessionRequest' }
            }
          }
        },
        responses: {
          '201': {
            description: 'Session created',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Session' }
              }
            }
          }
        }
      }
    }
    // ... other endpoints
  },
  components: {
    schemas: {
      // Type definitions
    }
  }
}

// Serve at /api-docs
app.get('/api-docs', (req, res) => {
  res.json(openApiSpec)
})
```

### WebSocket Protocol Documentation

```markdown
# WebSocket Protocol

## Connection
wss://api.synckairos.io/sessions/{session_id}?token={jwt_token}

## Client → Server Messages

### PING (Heartbeat)
{
  "type": "PING",
  "timestamp": 1730000000000
}

### SUBSCRIBE_PARTICIPANT
{
  "type": "SUBSCRIBE_PARTICIPANT",
  "participant_id": "uuid"
}

## Server → Client Messages

### PONG
{
  "type": "PONG",
  "client_timestamp": 1730000000000,
  "server_timestamp": 1730000000050
}

### STATE_UPDATE
{
  "type": "STATE_UPDATE",
  "sessionId": "uuid",
  "state": { /* full session state */ },
  "timestamp": 1730000000000
}

### TIME_EXPIRED
{
  "type": "TIME_EXPIRED",
  "sessionId": "uuid",
  "expired_participant_id": "uuid"
}
```

---

## Summary

### Backend Features for Mobile Compatibility

✅ **Push Notifications**
- Firebase Cloud Messaging (FCM)
- APNs for iOS, FCM for Android
- Device registration endpoints

✅ **Network Resilience**
- WebSocket with automatic reconnection
- Polling fallback for poor connections
- Idempotent endpoints
- Optimized payloads (gzip, field selection)

✅ **Battery Optimization**
- Adaptive heartbeat intervals
- HTTP/2 support
- Batch endpoints
- Efficient WebSocket protocol

✅ **Mobile-Friendly API**
- CORS configured for mobile
- Standard REST + WebSocket (no vendor lock-in)
- Clear documentation (OpenAPI)

### What Mobile Apps Need to Implement

The mobile app developers will need to:
1. Implement WebSocket client with reconnection logic
2. Register for push notifications (FCM)
3. Handle background/foreground transitions
4. Implement local caching for offline support
5. Use idempotency keys for retry logic

### Backend Provides

1. ✅ RESTful API (create, start, switch, pause, etc.)
2. ✅ WebSocket for real-time updates
3. ✅ Push notifications (via Firebase)
4. ✅ Server time sync endpoint
5. ✅ Device registration endpoints
6. ✅ Mobile-optimized responses
7. ✅ Type definitions (can be exported)

---

**This backend is fully mobile-ready.** Mobile app developers can build native iOS and Android apps that consume this API without any backend changes needed.
