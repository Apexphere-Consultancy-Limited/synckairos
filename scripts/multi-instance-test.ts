import { RedisStateManager } from '@/state/RedisStateManager'
import { DBWriteQueue } from '@/state/DBWriteQueue'
import { createRedisClient, createRedisPubSubClient } from '@/config/redis'
import { SyncMode, SyncStatus } from '@/types/session'

const testMultiInstance = async () => {
  console.log('🧪 Multi-Instance Simulation Test')
  console.log('==================================\n')

  // Instance 1
  const redis1 = createRedisClient()
  const pubSub1 = createRedisPubSubClient()
  const queue1 = new DBWriteQueue(process.env.REDIS_URL!)
  const instance1 = new RedisStateManager(redis1, pubSub1, queue1)

  // Instance 2
  const redis2 = createRedisClient()
  const pubSub2 = createRedisPubSubClient()
  const queue2 = new DBWriteQueue(process.env.REDIS_URL!)
  const instance2 = new RedisStateManager(redis2, pubSub2, queue2)

  console.log('✅ Two instances created\n')

  // Test 1: Create on Instance 1, Read on Instance 2
  console.log('Test 1: Cross-instance state sharing')
  const sessionId = 'multi-instance-test-1'
  const state = {
    session_id: sessionId,
    sync_mode: SyncMode.PER_PARTICIPANT,
    status: SyncStatus.PENDING,
    version: 1,
    participants: [
      {
        participant_id: 'p1',
        total_time_ms: 300000,
        time_remaining_ms: 300000,
        has_gone: false,
        is_active: true,
      },
    ],
    active_participant_id: 'p1',
    total_time_ms: 300000,
    time_per_cycle_ms: null,
    cycle_started_at: null,
    session_started_at: null,
    session_completed_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    increment_ms: null,
    max_time_ms: null,
  }

  await instance1.createSession(state)
  console.log('  Instance 1: Created session')

  const retrieved = await instance2.getSession(sessionId)
  console.log('  Instance 2: Retrieved session')

  if (retrieved && retrieved.session_id === sessionId) {
    console.log('  ✅ PASS: Instance 2 can read session created by Instance 1\n')
  } else {
    console.log('  ❌ FAIL: Instance 2 could not read session\n')
    process.exit(1)
  }

  // Test 2: Update on Instance 2, Read on Instance 1
  console.log('Test 2: Cross-instance state updates')
  const updated = { ...retrieved!, status: SyncStatus.RUNNING }
  await instance2.updateSession(sessionId, updated)
  console.log('  Instance 2: Updated session to RUNNING')

  const readBack = await instance1.getSession(sessionId)
  console.log('  Instance 1: Read session')

  if (readBack && readBack.status === SyncStatus.RUNNING) {
    console.log('  ✅ PASS: Instance 1 sees update from Instance 2\n')
  } else {
    console.log('  ❌ FAIL: Instance 1 did not see update\n')
    process.exit(1)
  }

  // Test 3: Pub/Sub cross-instance communication
  console.log('Test 3: Pub/Sub cross-instance communication')

  const updates: string[] = []
  instance2.subscribeToUpdates((sessionId) => {
    updates.push(sessionId)
    console.log(`  Instance 2: Received update for ${sessionId}`)
  })

  await new Promise(resolve => setTimeout(resolve, 100)) // Wait for subscription

  const current = await instance1.getSession(sessionId)
  await instance1.updateSession(sessionId, { ...current!, status: SyncStatus.PAUSED })
  console.log('  Instance 1: Updated session to PAUSED')

  await new Promise(resolve => setTimeout(resolve, 500)) // Wait for Pub/Sub

  if (updates.includes(sessionId)) {
    console.log('  ✅ PASS: Instance 2 received Pub/Sub update from Instance 1\n')
  } else {
    console.log('  ❌ FAIL: Instance 2 did not receive Pub/Sub update\n')
    process.exit(1)
  }

  // Test 4: Version conflict detection
  console.log('Test 4: Optimistic locking across instances')
  const current1 = await instance1.getSession(sessionId)
  const current2 = await instance2.getSession(sessionId)

  // Instance 1 updates first
  await instance1.updateSession(sessionId, current1!, current1!.version)
  console.log('  Instance 1: Updated session (version incremented)')

  // Instance 2 tries to update with stale version
  try {
    await instance2.updateSession(sessionId, current2!, current2!.version)
    console.log('  ❌ FAIL: Instance 2 should have thrown version conflict\n')
    process.exit(1)
  } catch (err) {
    if (err instanceof Error && err.message.includes('Concurrent modification')) {
      console.log('  ✅ PASS: Version conflict detected correctly\n')
    } else {
      console.log('  ❌ FAIL: Wrong error thrown\n')
      throw err
    }
  }

  // Cleanup
  await instance1.deleteSession(sessionId)
  await instance1.close()
  await instance2.close()
  await queue1.close()
  await queue2.close()

  console.log('\n🎉 All multi-instance tests PASSED!')
}

testMultiInstance().catch(err => {
  console.error('Test failed:', err)
  process.exit(1)
})
