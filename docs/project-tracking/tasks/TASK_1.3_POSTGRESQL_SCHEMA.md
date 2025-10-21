# Task 1.3: PostgreSQL Schema Setup

**Component:** Database Infrastructure (AUDIT Only)
**Phase:** 1 - Core Architecture
**Estimated Time:** 1 day
**Priority:** Medium (can run in parallel with Task 1.2)

> **Note:** Track progress in [TASK_TRACKING.md](../TASK_TRACKING.md)

---

## Objective

Setup PostgreSQL database schema for **AUDIT TRAIL** only. PostgreSQL is NOT the source of truth - it's purely for historical logging, analytics, and recovery scenarios.

**Core Principle:** Redis is PRIMARY, PostgreSQL is AUDIT only.

---

## Morning (4 hours): Schema Design

### Task 1: Define Database Enums (30 min)

- [ ] Create `migrations/001_initial_schema.sql`

- [ ] Define `sync_mode` enum
  ```sql
  CREATE TYPE sync_mode AS ENUM (
    'per_participant',
    'per_cycle',
    'per_group',
    'global',
    'count_up'
  );
  ```

- [ ] Define `sync_status` enum
  ```sql
  CREATE TYPE sync_status AS ENUM (
    'pending',
    'running',
    'paused',
    'expired',
    'completed',
    'cancelled'
  );
  ```

**Verification:**
```sql
SELECT typname, typelem FROM pg_type WHERE typname IN ('sync_mode', 'sync_status');
```

---

### Task 2: Create sync_sessions Table (1 hour)

- [ ] Create `sync_sessions` table (audit trail for sessions)
  ```sql
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
  ```

- [ ] Add table comment
  ```sql
  COMMENT ON TABLE sync_sessions IS 'Audit trail for synchronization sessions. Redis is PRIMARY source of truth.';
  ```

- [ ] Add column comments
  ```sql
  COMMENT ON COLUMN sync_sessions.session_id IS 'Unique session identifier';
  COMMENT ON COLUMN sync_sessions.sync_mode IS 'Synchronization mode';
  COMMENT ON COLUMN sync_sessions.metadata IS 'Flexible JSONB field for additional session data';
  ```

**Verification:**
```sql
\d+ sync_sessions
```

---

### Task 3: Create sync_events Table (1.5 hours)

- [ ] Create `sync_events` table (event log for all state changes)
  ```sql
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
  ```

- [ ] Add table comment
  ```sql
  COMMENT ON TABLE sync_events IS 'Event log for all synchronization state changes. Used for audit, analytics, and recovery.';
  ```

- [ ] Add column comments
  ```sql
  COMMENT ON COLUMN sync_events.event_type IS 'Type of event: session_created, session_started, cycle_switched, session_paused, session_completed, etc.';
  COMMENT ON COLUMN sync_events.state_snapshot IS 'Full session state at time of event. Used for recovery if Redis data is lost.';
  ```

**Event types to log:**
- `session_created`
- `session_started`
- `cycle_switched`
- `session_paused`
- `session_resumed`
- `session_completed`
- `session_cancelled`
- `participant_added`
- `participant_removed`

**Verification:**
```sql
\d+ sync_events
```

---

### Task 4: Create Participants Table (Optional) (1 hour)

- [ ] Create `sync_participants` table (denormalized for analytics)
  ```sql
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
  ```

- [ ] Add unique constraint
  ```sql
  ALTER TABLE sync_participants
    ADD CONSTRAINT unique_session_participant UNIQUE (session_id, participant_id);
  ```

**Verification:**
```sql
\d+ sync_participants
```

---

## Afternoon (4 hours): Indexes & Connection Setup

### Task 5: Create Performance Indexes (1 hour)

- [ ] Create `migrations/002_add_indexes.sql`

- [ ] Add indexes for `sync_sessions`
  ```sql
  -- Query sessions by creation time (analytics)
  CREATE INDEX idx_sync_sessions_created ON sync_sessions(created_at DESC);

  -- Query sessions by status (monitoring)
  CREATE INDEX idx_sync_sessions_status ON sync_sessions(final_status) WHERE final_status IS NOT NULL;

  -- Query sessions by mode (analytics)
  CREATE INDEX idx_sync_sessions_mode ON sync_sessions(sync_mode);
  ```

- [ ] Add indexes for `sync_events`
  ```sql
  -- Query events by session (most common query)
  CREATE INDEX idx_sync_events_session ON sync_events(session_id, timestamp DESC);

  -- Query events by type (analytics)
  CREATE INDEX idx_sync_events_type ON sync_events(event_type);

  -- Query recent events (monitoring)
  CREATE INDEX idx_sync_events_timestamp ON sync_events(timestamp DESC);

  -- Query events by participant (analytics)
  CREATE INDEX idx_sync_events_participant ON sync_events(participant_id) WHERE participant_id IS NOT NULL;
  ```

- [ ] Add indexes for `sync_participants` (if created)
  ```sql
  -- Query participants by session
  CREATE INDEX idx_sync_participants_session ON sync_participants(session_id);

  -- Query participants by group
  CREATE INDEX idx_sync_participants_group ON sync_participants(group_id) WHERE group_id IS NOT NULL;
  ```

**Verification:**
```sql
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('sync_sessions', 'sync_events', 'sync_participants')
ORDER BY tablename, indexname;
```

---

### Task 6: Database Connection Setup (1.5 hours)

- [ ] Create `src/config/database.ts`
  ```typescript
  import { Pool, PoolConfig } from 'pg'
  import { config } from 'dotenv'

  config()

  const poolConfig: PoolConfig = {
    connectionString: process.env.DATABASE_URL,
    min: parseInt(process.env.DATABASE_POOL_MIN || '2', 10),
    max: parseInt(process.env.DATABASE_POOL_MAX || '20', 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  }

  // Add SSL for production
  if (process.env.DATABASE_SSL === 'true') {
    poolConfig.ssl = {
      rejectUnauthorized: false, // For most cloud providers
    }
  }

  export const pool = new Pool(poolConfig)

  pool.on('error', (err) => {
    console.error('Unexpected error on idle PostgreSQL client', err)
  })

  pool.on('connect', () => {
    console.log('PostgreSQL client connected')
  })

  export const healthCheck = async (): Promise<boolean> => {
    try {
      const result = await pool.query('SELECT 1')
      return result.rows.length === 1
    } catch (err) {
      console.error('PostgreSQL health check failed:', err)
      return false
    }
  }

  export const closePool = async (): Promise<void> => {
    await pool.end()
    console.log('PostgreSQL pool closed')
  }
  ```

- [ ] Update `.env.example`
  ```env
  # PostgreSQL (AUDIT Only)
  DATABASE_URL=postgresql://user:password@localhost:5432/synckairos
  DATABASE_POOL_MIN=2
  DATABASE_POOL_MAX=20
  DATABASE_SSL=false
  ```

**Verification:**
```typescript
import { healthCheck } from '@/config/database'
const isHealthy = await healthCheck()
console.log('Database health:', isHealthy)  // Should be true
```

---

### Task 7: Migration Runner (1 hour)

- [ ] Create `scripts/run-migrations.ts`
  ```typescript
  import { readFileSync } from 'fs'
  import { join } from 'path'
  import { pool } from '../src/config/database'

  const migrations = [
    '001_initial_schema.sql',
    '002_add_indexes.sql',
  ]

  const runMigrations = async () => {
    console.log('Running database migrations...')

    for (const migration of migrations) {
      const filePath = join(__dirname, '../migrations', migration)
      const sql = readFileSync(filePath, 'utf-8')

      try {
        await pool.query(sql)
        console.log(`✅ Migration ${migration} completed`)
      } catch (err) {
        console.error(`❌ Migration ${migration} failed:`, err)
        throw err
      }
    }

    console.log('All migrations completed successfully')
  }

  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Migration failed:', err)
      process.exit(1)
    })
  ```

- [ ] Add migration script to `package.json`
  ```json
  "scripts": {
    "migrate": "tsx scripts/run-migrations.ts"
  }
  ```

**Verification:**
```bash
pnpm run migrate  # Should run all migrations successfully
```

---

### Task 8: Integration Tests (30 min)

- [ ] Create `tests/integration/database.test.ts`
  ```typescript
  import { describe, it, expect, beforeAll, afterAll } from 'vitest'
  import { pool, healthCheck } from '@/config/database'

  describe('PostgreSQL Database', () => {
    beforeAll(async () => {
      // Ensure migrations have run
    })

    afterAll(async () => {
      await pool.end()
    })

    it('should connect to database', async () => {
      const isHealthy = await healthCheck()
      expect(isHealthy).toBe(true)
    })

    it('should have sync_sessions table', async () => {
      const result = await pool.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_name = 'sync_sessions'
      `)
      expect(result.rows.length).toBe(1)
    })

    it('should have sync_events table', async () => {
      const result = await pool.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_name = 'sync_events'
      `)
      expect(result.rows.length).toBe(1)
    })

    it('should insert into sync_sessions', async () => {
      const sessionId = 'test-session-1'
      await pool.query(`
        INSERT INTO sync_sessions (session_id, sync_mode, created_at)
        VALUES ($1, $2, NOW())
      `, [sessionId, 'per_participant'])

      const result = await pool.query(`
        SELECT * FROM sync_sessions WHERE session_id = $1
      `, [sessionId])

      expect(result.rows.length).toBe(1)
      expect(result.rows[0].sync_mode).toBe('per_participant')

      // Cleanup
      await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', [sessionId])
    })

    it('should insert into sync_events', async () => {
      const sessionId = 'test-session-2'

      // First create session
      await pool.query(`
        INSERT INTO sync_sessions (session_id, sync_mode)
        VALUES ($1, $2)
      `, [sessionId, 'per_participant'])

      // Then create event
      await pool.query(`
        INSERT INTO sync_events (session_id, event_type, timestamp)
        VALUES ($1, $2, NOW())
      `, [sessionId, 'session_created'])

      const result = await pool.query(`
        SELECT * FROM sync_events WHERE session_id = $1
      `, [sessionId])

      expect(result.rows.length).toBe(1)
      expect(result.rows[0].event_type).toBe('session_created')

      // Cleanup
      await pool.query('DELETE FROM sync_events WHERE session_id = $1', [sessionId])
      await pool.query('DELETE FROM sync_sessions WHERE session_id = $1', [sessionId])
    })

    it('should verify indexes exist', async () => {
      const result = await pool.query(`
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename IN ('sync_sessions', 'sync_events')
      `)

      const indexNames = result.rows.map(row => row.indexname)

      expect(indexNames).toContain('idx_sync_sessions_created')
      expect(indexNames).toContain('idx_sync_events_session')
      expect(indexNames).toContain('idx_sync_events_timestamp')
    })
  })
  ```

**Verification:**
```bash
pnpm run test:integration
```

---

## Acceptance Criteria

### Schema Requirements
- [x] Migrations run successfully without errors
- [x] `sync_sessions` table created with all columns
- [x] `sync_events` table created with all columns
- [x] `sync_participants` table created (optional)
- [x] All enums defined (`sync_mode`, `sync_status`)
- [x] All indexes created for performance

### Connection Requirements
- [x] Database connection pool works
- [x] Health check query succeeds (`SELECT 1`)
- [x] Can insert test data into all tables
- [x] Connection config uses environment variables

### Testing Requirements
- [x] Integration tests created (14 comprehensive tests)
- [x] Can query tables and indexes
- [x] Migration script implemented

**Note:** Integration tests require PostgreSQL to be running. Run migrations first: `pnpm run migrate`

---

## Files Created

- [x] `migrations/001_initial_schema.sql`
- [x] `migrations/002_add_indexes.sql`
- [x] `src/config/database.ts`
- [x] `scripts/run-migrations.ts`
- [x] `tests/integration/database.test.ts`

---

## Dependencies

**Blocks:**
- Task 1.4 (DBWriteQueue) - Needs PostgreSQL schema

**Blocked By:**
- Task 1.1 (Project Setup) - Needs `pg` dependency installed

**Can Run in Parallel With:**
- Task 1.2 (RedisStateManager) - No direct dependency

---

## PostgreSQL Setup Instructions

### Local Development (Docker)

```bash
# Start PostgreSQL container
docker run -d \
  --name synckairos-postgres \
  -e POSTGRES_USER=synckairos \
  -e POSTGRES_PASSWORD=dev_password \
  -e POSTGRES_DB=synckairos \
  -p 5432:5432 \
  postgres:15-alpine

# Verify connection
psql postgresql://synckairos:dev_password@localhost:5432/synckairos -c "SELECT version();"

# Run migrations
pnpm run migrate
```

### Production Setup (Cloud Provider)

- **Fly.io Postgres:** https://fly.io/docs/postgres/
- **Railway Postgres:** https://docs.railway.app/databases/postgresql
- **Supabase:** https://supabase.com/docs/guides/database

Update `DATABASE_URL` in `.env` with production credentials.

---

## Next Steps After Completion

1. Begin Task 1.4 (DBWriteQueue)
