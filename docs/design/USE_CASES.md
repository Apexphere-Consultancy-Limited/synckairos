# SyncKairos - Use Cases & Integration Examples

**Version:** 2.0
**Last Updated:** 2025-10-20

---

## Supported Use Cases

SyncKairos is designed to synchronize time across any application or use case:

### Gaming
- ♟️ **Chess** - Classical, Blitz, Bullet with increment
- 🎯 **Quiz Games** - Per-question or total game timers
- 🃏 **Card Games** - Turn timers for Poker, UNO, etc.
- 🎮 **Strategy Games** - Turn-based games like Civilization
- 🧩 **Puzzle Games** - Timed challenges
- 🎲 **Board Games** - Digital versions of any turn-based board game

### Live Events
- 🎤 **Concerts** - Synchronized countdowns across venues
- 🏆 **Auctions** - Bid timers synchronized for all participants
- 📺 **Live Shows** - Synchronized event timing for global audiences
- ⚽ **Sports** - Match timers, halftime clocks

### Business & Productivity
- 💼 **Meetings** - Synchronized meeting timers
- 📊 **Presentations** - Slide timers for speakers
- 🏃 **Sprints** - Agile sprint timers
- ☕ **Break Rooms** - Shared break timers

### Education
- 📝 **Exams** - Synchronized test timers across classrooms
- 🏫 **Classroom Activities** - Activity timers
- 📚 **Study Sessions** - Group study timers

### Other
- 🧘 **Meditation** - Group meditation session timers
- 🍳 **Cooking** - Multi-device cooking timers
- 🎆 **Countdowns** - Global synchronized countdowns (New Year, product launches)
- 🏋️ **Fitness** - Workout interval timers, group class sync

---

## Configuration Examples

### Use Case 1: Chess Game (Per-Player with Increment)

```typescript
// Chess: 10 minutes per player + 3 second increment per move
await syncClient.createSession({
  session_id: "chess-game-123",
  sync_mode: "per_participant",  // Maps to: per-player
  participants: [
    { participant_id: "white-player", participant_index: 0, total_time_ms: 600000 },
    { participant_id: "black-player", participant_index: 1, total_time_ms: 600000 }
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
    { participant_id: "bidder1", participant_index: 0 },
    { participant_id: "bidder2", participant_index: 1 },
    { participant_id: "bidder3", participant_index: 2 },
    { participant_id: "bidder4", participant_index: 3 },
    { participant_id: "bidder5", participant_index: 4 },
    { participant_id: "bidder6", participant_index: 5 }
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
  participants: [{ participant_id: "runner1", participant_index: 0 }],
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

### Example 4: Exam Timer Integration

```typescript
// Exam: 60 minutes for all students
await syncClient.createSession({
  session_id: "exam-123",
  sync_mode: "global",
  time_per_cycle_ms: 3600000,  // 60 minutes
  auto_advance: false,
  action_on_timeout: {
    type: "end_session",
    outcome: "time_expired"
  }
})

await syncClient.startSession("exam-123")

// Component
const { getParticipantTime } = useSyncKairos("exam-123", syncClient)

// Display remaining time
<ExamTimer timeMs={getParticipantTime('global')} />
```

### Example 5: Meeting Timer Integration

```typescript
// Meeting: 5 minutes per agenda item
await syncClient.createSession({
  session_id: meeting.id,
  sync_mode: 'per_cycle',
  time_per_cycle_ms: 300000,  // 5 minutes per agenda item
  auto_advance: false,
  action_on_timeout: { type: 'notify', message: 'Time is up for this item' }
})

// Component
const { getParticipantTime, switchCycle } = useSyncKairos(meeting.id, syncClient)

const handleNextAgendaItem = async () => {
  await switchCycle()
}
```

---

## Sync Mode Selection Guide

| Use Case | Sync Mode | Description |
|----------|-----------|-------------|
| Chess, Turn-based games | `per_participant` | Each player has their own timer |
| Quiz questions, Meeting agenda | `per_cycle` | Fixed time per cycle/item |
| Team competitions | `per_group` | Each group/team has their own timer |
| Exams, Meditation sessions | `global` | Single timer for everyone |
| Speedruns, Elapsed time tracking | `count_up` | Stopwatch mode |

---

## Action on Timeout Configuration

### Auto Action
```json
{
  "type": "auto_action",
  "action": "default",           // Trigger default action (poker fold, quiz skip, etc)
  "notify_participants": true
}
```

### Skip Cycle
```json
{
  "type": "skip_cycle",
  "penalty": {
    "points": -10                // Deduct points for timeout
  }
}
```

### End Session
```json
{
  "type": "end_session",
  "outcome": "timeout",
  "winner_by": "time"            // For competitive sessions
}
```

---

## Best Practices for Integration

1. **Create session before participants join**
   - Initialize the session early with pending status
   - Start the session when ready to begin

2. **Handle timeout events**
   - Listen to `timeout_occurred` and `timeout_warning` events
   - Implement appropriate UI feedback

3. **Sync server time on load**
   - Call `syncServerTime()` on component mount
   - Re-sync periodically for long sessions

4. **Use optimistic UI updates**
   - Update UI immediately on user actions
   - Reconcile with server state on WebSocket updates

5. **Handle reconnection gracefully**
   - Monitor `isConnected` state
   - Show connection status to users
   - Reload session state on reconnection

6. **Clean up sessions**
   - Call `completeSession()` when finished normally
   - Call `deleteSession()` for cancelled sessions
