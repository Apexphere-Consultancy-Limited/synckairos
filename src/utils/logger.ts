// Structured logging with Pino
// Provides contextual, JSON-formatted logs for production observability

import pino from 'pino'
import { config } from 'dotenv'

config()

const isDevelopment = process.env.NODE_ENV !== 'production'

export const logger = pino({
  level: process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),

  // Pretty print in development, JSON in production
  transport: isDevelopment
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname',
        },
      }
    : undefined,

  // Base fields for all logs
  base: {
    service: 'synckairos',
    env: process.env.NODE_ENV || 'development',
  },

  // Timestamp in ISO format
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
})

// Create child loggers for specific components
export const createComponentLogger = (component: string) => {
  return logger.child({ component })
}
