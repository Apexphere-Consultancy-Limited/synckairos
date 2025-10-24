import { randomUUID } from 'crypto'

/**
 * Generate a UUID v4
 */
export function generateUUID(): string {
  return randomUUID()
}
