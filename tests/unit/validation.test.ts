import { describe, it, expect } from 'vitest'
import {
  CreateSessionSchema,
  ParticipantSchema,
  SwitchCycleSchema,
  SessionIdParamSchema,
  EmptyBodySchema,
} from '@/api/schemas/session'

describe('Validation Schemas', () => {
  describe('ParticipantSchema', () => {
    it('should validate valid participant', () => {
      const valid = {
        participant_id: '123e4567-e89b-12d3-a456-426614174000',
        participant_index: 0,
        total_time_ms: 60000,
      }

      const result = ParticipantSchema.safeParse(valid)
      expect(result.success).toBe(true)
    })

    it('should validate participant with optional group_id', () => {
      const valid = {
        participant_id: '123e4567-e89b-12d3-a456-426614174000',
        participant_index: 0,
        total_time_ms: 60000,
        group_id: '223e4567-e89b-12d3-a456-426614174001',
      }

      const result = ParticipantSchema.safeParse(valid)
      expect(result.success).toBe(true)
    })

    it('should reject invalid UUID for participant_id', () => {
      const invalid = {
        participant_id: 'not-a-uuid',
        participant_index: 0,
        total_time_ms: 60000,
      }

      const result = ParticipantSchema.safeParse(invalid)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0].path).toContain('participant_id')
        expect(result.error.issues[0].message).toContain('UUID')
      }
    })

    it('should reject invalid UUID for group_id', () => {
      const invalid = {
        participant_id: '123e4567-e89b-12d3-a456-426614174000',
        participant_index: 0,
        total_time_ms: 60000,
        group_id: 'not-a-uuid',
      }

      const result = ParticipantSchema.safeParse(invalid)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0].path).toContain('group_id')
      }
    })

    it('should reject negative participant_index', () => {
      const invalid = {
        participant_id: '123e4567-e89b-12d3-a456-426614174000',
        participant_index: -1,
        total_time_ms: 60000,
      }

      const result = ParticipantSchema.safeParse(invalid)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0].path).toContain('participant_index')
        expect(result.error.issues[0].message).toContain('non-negative')
      }
    })

    it('should reject time less than 1000ms', () => {
      const invalid = {
        participant_id: '123e4567-e89b-12d3-a456-426614174000',
        participant_index: 0,
        total_time_ms: 500,
      }

      const result = ParticipantSchema.safeParse(invalid)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0].path).toContain('total_time_ms')
        expect(result.error.issues[0].message).toContain('1000ms')
      }
    })

    it('should reject time exceeding 24 hours', () => {
      const invalid = {
        participant_id: '123e4567-e89b-12d3-a456-426614174000',
        participant_index: 0,
        total_time_ms: 90000000, // > 24 hours
      }

      const result = ParticipantSchema.safeParse(invalid)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0].path).toContain('total_time_ms')
        expect(result.error.issues[0].message).toContain('86400000ms')
      }
    })

    it('should reject non-integer time', () => {
      const invalid = {
        participant_id: '123e4567-e89b-12d3-a456-426614174000',
        participant_index: 0,
        total_time_ms: 60000.5,
      }

      const result = ParticipantSchema.safeParse(invalid)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('integer')
      }
    })
  })

  describe('CreateSessionSchema', () => {
    const validBase = {
      session_id: '123e4567-e89b-12d3-a456-426614174000',
      sync_mode: 'per_participant' as const,
      participants: [
        {
          participant_id: '223e4567-e89b-12d3-a456-426614174001',
          participant_index: 0,
          total_time_ms: 60000,
        },
      ],
      total_time_ms: 120000,
    }

    it('should validate complete session config with all fields', () => {
      const valid = {
        ...validBase,
        time_per_cycle_ms: 30000,
        increment_ms: 1000,
        max_time_ms: 180000,
        metadata: { key: 'value' },
      }

      const result = CreateSessionSchema.safeParse(valid)
      expect(result.success).toBe(true)
    })

    it('should validate minimal session config (required fields only)', () => {
      const result = CreateSessionSchema.safeParse(validBase)
      expect(result.success).toBe(true)
    })

    it('should validate all sync modes', () => {
      const modes = ['per_participant', 'per_cycle', 'per_group', 'global', 'count_up']

      modes.forEach((mode) => {
        const config = { ...validBase, sync_mode: mode }
        const result = CreateSessionSchema.safeParse(config)
        expect(result.success).toBe(true)
      })
    })

    it('should reject invalid session_id', () => {
      const invalid = {
        ...validBase,
        session_id: 'not-a-uuid',
      }

      const result = CreateSessionSchema.safeParse(invalid)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0].path).toContain('session_id')
      }
    })

    it('should reject invalid sync_mode', () => {
      const invalid = {
        ...validBase,
        sync_mode: 'invalid_mode',
      }

      const result = CreateSessionSchema.safeParse(invalid)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0].path).toContain('sync_mode')
        expect(result.error.issues[0].message).toContain('per_participant')
      }
    })

    it('should reject empty participants array', () => {
      const invalid = {
        ...validBase,
        participants: [],
      }

      const result = CreateSessionSchema.safeParse(invalid)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0].path).toContain('participants')
        expect(result.error.issues[0].message).toContain('At least one')
      }
    })

    it('should reject more than 1000 participants', () => {
      const participants = Array.from({ length: 1001 }, (_, i) => ({
        participant_id: `${i.toString().padStart(8, '0')}-e89b-12d3-a456-426614174000`,
        participant_index: i,
        total_time_ms: 60000,
      }))

      const invalid = {
        ...validBase,
        participants,
      }

      const result = CreateSessionSchema.safeParse(invalid)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0].path).toContain('participants')
        expect(result.error.issues[0].message).toContain('1000')
      }
    })

    it('should reject invalid participant in array', () => {
      const invalid = {
        ...validBase,
        participants: [
          {
            participant_id: 'not-a-uuid',
            participant_index: 0,
            total_time_ms: 60000,
          },
        ],
      }

      const result = CreateSessionSchema.safeParse(invalid)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0].path).toContain('participants')
        expect(result.error.issues[0].path).toContain(0) // numeric index
        expect(result.error.issues[0].path).toContain('participant_id')
      }
    })

    it('should reject invalid time_per_cycle_ms', () => {
      const invalid = {
        ...validBase,
        time_per_cycle_ms: 500, // < 1000ms
      }

      const result = CreateSessionSchema.safeParse(invalid)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0].path).toContain('time_per_cycle_ms')
      }
    })

    it('should reject invalid increment_ms', () => {
      const invalid = {
        ...validBase,
        increment_ms: -100, // negative
      }

      const result = CreateSessionSchema.safeParse(invalid)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0].path).toContain('increment_ms')
        expect(result.error.issues[0].message).toContain('non-negative')
      }
    })

    it('should reject increment_ms exceeding 60 seconds', () => {
      const invalid = {
        ...validBase,
        increment_ms: 70000, // > 60 seconds
      }

      const result = CreateSessionSchema.safeParse(invalid)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0].path).toContain('increment_ms')
        expect(result.error.issues[0].message).toContain('60000ms')
      }
    })

    it('should accept metadata as any object', () => {
      const valid = {
        ...validBase,
        metadata: {
          custom_field: 'value',
          nested: { deep: 'object' },
          array: [1, 2, 3],
        },
      }

      const result = CreateSessionSchema.safeParse(valid)
      expect(result.success).toBe(true)
    })
  })

  describe('SwitchCycleSchema', () => {
    it('should validate with next_participant_id', () => {
      const valid = {
        next_participant_id: '123e4567-e89b-12d3-a456-426614174000',
      }

      const result = SwitchCycleSchema.safeParse(valid)
      expect(result.success).toBe(true)
    })

    it('should validate empty object (auto-advance)', () => {
      const valid = {}

      const result = SwitchCycleSchema.safeParse(valid)
      expect(result.success).toBe(true)
    })

    it('should reject invalid UUID', () => {
      const invalid = {
        next_participant_id: 'not-a-uuid',
      }

      const result = SwitchCycleSchema.safeParse(invalid)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0].path).toContain('next_participant_id')
        expect(result.error.issues[0].message).toContain('UUID')
      }
    })
  })

  describe('SessionIdParamSchema', () => {
    it('should validate valid session ID param', () => {
      const valid = {
        id: '123e4567-e89b-12d3-a456-426614174000',
      }

      const result = SessionIdParamSchema.safeParse(valid)
      expect(result.success).toBe(true)
    })

    it('should reject invalid UUID', () => {
      const invalid = {
        id: 'not-a-uuid',
      }

      const result = SessionIdParamSchema.safeParse(invalid)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0].path).toContain('id')
        expect(result.error.issues[0].message).toContain('UUID')
      }
    })

    it('should reject missing id', () => {
      const invalid = {}

      const result = SessionIdParamSchema.safeParse(invalid)
      expect(result.success).toBe(false)
    })
  })

  describe('EmptyBodySchema', () => {
    it('should validate empty object', () => {
      const valid = {}

      const result = EmptyBodySchema.safeParse(valid)
      expect(result.success).toBe(true)
    })

    it('should reject object with fields (strict mode)', () => {
      const invalid = {
        extra_field: 'value',
      }

      const result = EmptyBodySchema.safeParse(invalid)
      expect(result.success).toBe(false)
    })
  })

  describe('TypeScript Type Inference', () => {
    it('should infer correct types from CreateSessionSchema', () => {
      const data = {
        session_id: '123e4567-e89b-12d3-a456-426614174000',
        sync_mode: 'per_participant' as const,
        participants: [
          {
            participant_id: '223e4567-e89b-12d3-a456-426614174001',
            participant_index: 0,
            total_time_ms: 60000,
          },
        ],
        total_time_ms: 120000,
      }

      const result = CreateSessionSchema.parse(data)

      // Type assertions (compile-time checks)
      const sessionId: string = result.session_id
      const syncMode: 'per_participant' | 'per_cycle' | 'per_group' | 'global' | 'count_up' =
        result.sync_mode
      const firstParticipant = result.participants[0]
      const participantId: string = firstParticipant.participant_id
      const totalTime: number = result.total_time_ms

      // Runtime checks
      expect(sessionId).toBe(data.session_id)
      expect(syncMode).toBe(data.sync_mode)
      expect(participantId).toBe(data.participants[0].participant_id)
      expect(totalTime).toBe(data.total_time_ms)
    })
  })

  describe('Performance', () => {
    it('should complete ParticipantSchema validation in <1ms', () => {
      const validParticipant = {
        participant_id: '123e4567-e89b-12d3-a456-426614174000',
        participant_index: 0,
        total_time_ms: 60000,
      }

      const start = performance.now()
      ParticipantSchema.safeParse(validParticipant)
      const duration = performance.now() - start

      expect(duration).toBeLessThan(1)
    })

    it('should complete CreateSessionSchema validation in <1ms for small payload', () => {
      const validSession = {
        session_id: '123e4567-e89b-12d3-a456-426614174000',
        sync_mode: 'per_participant' as const,
        participants: [
          {
            participant_id: '223e4567-e89b-12d3-a456-426614174001',
            participant_index: 0,
            total_time_ms: 60000,
          },
        ],
        total_time_ms: 120000,
      }

      const start = performance.now()
      CreateSessionSchema.safeParse(validSession)
      const duration = performance.now() - start

      expect(duration).toBeLessThan(1)
    })

    it('should complete CreateSessionSchema validation in <5ms for large payload (100 participants)', () => {
      const largeSession = {
        session_id: '123e4567-e89b-12d3-a456-426614174000',
        sync_mode: 'per_participant' as const,
        participants: Array.from({ length: 100 }, (_, i) => ({
          participant_id: `${i.toString().padStart(8, '0')}-e89b-12d3-a456-426614174000`,
          participant_index: i,
          total_time_ms: 60000,
        })),
        total_time_ms: 120000,
      }

      const start = performance.now()
      CreateSessionSchema.safeParse(largeSession)
      const duration = performance.now() - start

      expect(duration).toBeLessThan(5)
    })

    it('should complete SwitchCycleSchema validation in <0.5ms', () => {
      const validSwitch = {
        next_participant_id: '123e4567-e89b-12d3-a456-426614174000',
      }

      const start = performance.now()
      SwitchCycleSchema.safeParse(validSwitch)
      const duration = performance.now() - start

      expect(duration).toBeLessThan(0.5)
    })

    it('should complete SessionIdParamSchema validation in <0.5ms', () => {
      const validParam = {
        id: '123e4567-e89b-12d3-a456-426614174000',
      }

      const start = performance.now()
      SessionIdParamSchema.safeParse(validParam)
      const duration = performance.now() - start

      expect(duration).toBeLessThan(0.5)
    })

    it('should complete validation error formatting in <1ms', () => {
      const invalidSession = {
        session_id: 'not-a-uuid',
        sync_mode: 'invalid',
        participants: [],
        total_time_ms: -100,
      }

      const start = performance.now()
      CreateSessionSchema.safeParse(invalidSession)
      const duration = performance.now() - start

      // Error cases might be slightly slower due to error object creation
      expect(duration).toBeLessThan(1)
    })
  })
})
