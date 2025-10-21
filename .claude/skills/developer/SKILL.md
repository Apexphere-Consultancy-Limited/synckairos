---
name: developer
description: SyncKairos project development workflow with Node.js/TypeScript best practices. Use this skill when implementing features, fixing bugs, or working on any development tasks. Enforces pnpm, TypeScript strict mode, Vitest testing, ESLint standards, git workflow, task management, and code review processes.
---

# SyncKairos Developer Workflow

## Overview

This skill provides the complete development workflow for the SyncKairos project, combining universal development best practices (git, testing, PRs, task management) with Node.js/TypeScript-specific commands and standards.

**Universal Workflow (applies to all projects):**
1. Create feature branch from main (`git checkout -b feat/task-name`)
2. Use TodoWrite to track implementation steps
3. Write code with quality in mind (strong typing, clear naming, DRY principle)
4. Update todo list in real-time (one task in_progress at a time)
5. Make atomic commits with meaningful messages
6. Run validation checks before creating PR
7. Create comprehensive PR with test results and documentation
8. Follow git best practices (see global `developer` skill references)

**SyncKairos-Specific (this document):**
- Concrete pnpm/TypeScript/Vitest commands
- Tech-stack-specific patterns and configuration
- Project-specific testing and performance requirements

## Technology Stack

- **Package Manager**: pnpm
- **Runtime**: Node.js >=20.0.0
- **Language**: TypeScript (strict mode)
- **Testing**: Vitest
- **Linting**: ESLint + Prettier
- **Type Checking**: TypeScript compiler

## Pre-PR Validation Commands

Run these commands in order before creating any PR:

### 1. TypeScript Compilation
```bash
pnpm tsc --noEmit
```
**Must pass**: Zero errors, zero warnings

### 2. Linting
```bash
# Check for errors
pnpm lint

# Auto-fix when possible
pnpm lint:fix
```
**Must pass**: Zero ESLint errors

### 3. Unit Tests
```bash
pnpm test:unit
```
**Requirements**:
- All tests passing
- Coverage >80% (overall)
- Coverage >90% (critical components)

### 4. Integration Tests
```bash
pnpm test:integration
```
**Requirements**:
- All tests passing
- Database/Redis connections working
- External dependencies mocked or containerized

### 5. Performance Tests
```bash
pnpm test:performance
# or
pnpm run test --grep="performance"
```
**Requirements**:
- Latency targets met
- Results documented in PR

### 6. Coverage Report
```bash
pnpm test:coverage
```
**Review**: Check coverage/index.html for gaps

## TypeScript Standards

### Strict Mode Configuration

Ensure `tsconfig.json` has:
```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "alwaysStrict": true
  }
}
```

### Type Safety Rules

**✅ Do:**
```typescript
// Explicit return types
function calculateTotal(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.price, 0)
}

// Proper typing for async
async function fetchUser(id: string): Promise<User | null> {
  const result = await db.query('SELECT * FROM users WHERE id = $1', [id])
  return result.rows[0] || null
}

// Unknown instead of any
function parseJSON(input: string): unknown {
  return JSON.parse(input)
}

// Type guards
function isUser(obj: unknown): obj is User {
  return typeof obj === 'object' && obj !== null && 'id' in obj
}
```

**❌ Don't:**
```typescript
// No any types
function process(data: any) { } // ❌

// No implicit returns
function getValue(x: number) { // ❌ Missing return type
  return x * 2
}

// No type assertions without guards
const user = data as User // ❌ Unsafe

// No optional chaining abuse
user?.profile?.settings?.theme?.color?.hex // ❌ Too deep
```

## Testing with Vitest

### Test File Structure

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ComponentName } from '@/path/to/component'

describe('ComponentName', () => {
  beforeEach(() => {
    // Setup
  })

  afterEach(() => {
    // Cleanup
  })

  it('should do something specific', () => {
    // Test implementation
  })
})
```

### Coverage Configuration

In `vitest.config.ts`:
```typescript
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.test.ts',
        '**/*.spec.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
})
```

### Test Naming Conventions

```typescript
// Unit tests
ComponentName.test.ts
utilityFunction.test.ts

// Integration tests
feature.integration.test.ts
database.integration.test.ts

// Performance tests
ComponentName.perf.test.ts
operations.perf.test.ts

// Edge cases
ComponentName.edgecases.test.ts
```

## ESLint + Prettier Setup

### Required Dependencies

```bash
pnpm add -D eslint prettier @typescript-eslint/parser @typescript-eslint/eslint-plugin eslint-config-prettier eslint-plugin-prettier
```

### ESLint Configuration

Create `.eslintrc.js` or use flat config:
```javascript
export default {
  parser: '@typescript-eslint/parser',
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'prettier',
  ],
  plugins: ['@typescript-eslint', 'prettier'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/explicit-function-return-type': 'warn',
    'prettier/prettier': 'error',
  },
}
```

### Prettier Configuration

Create `.prettierrc`:
```json
{
  "semi": false,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 100
}
```

## Package.json Scripts

Standard scripts for Node.js/TypeScript projects:

```json
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsup src/index.ts --format esm --clean",
    "start": "node dist/index.js",
    "test": "vitest",
    "test:unit": "vitest tests/unit",
    "test:integration": "vitest tests/integration",
    "test:coverage": "vitest --coverage",
    "lint": "eslint src/**/*.ts",
    "lint:fix": "eslint src/**/*.ts --fix",
    "format": "prettier --write \"src/**/*.ts\"",
    "format:check": "prettier --check \"src/**/*.ts\"",
    "typecheck": "tsc --noEmit"
  }
}
```

## Import Path Aliases

Configure in `tsconfig.json`:
```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"],
      "@/types/*": ["src/types/*"],
      "@/utils/*": ["src/utils/*"]
    }
  }
}
```

Usage:
```typescript
import { SyncState } from '@/types/session'
import { createLogger } from '@/utils/logger'
```

## Error Handling Patterns

### Custom Error Classes

```typescript
export class SessionNotFoundError extends Error {
  constructor(
    public readonly sessionId: string,
    message = `Session not found: ${sessionId}`
  ) {
    super(message)
    this.name = 'SessionNotFoundError'

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, SessionNotFoundError)
    }
  }
}
```

### Structured Logging with Pino

```typescript
import pino from 'pino'

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
    },
  },
})

// Usage
logger.info({ userId: '123' }, 'User logged in')
logger.error({ err, sessionId }, 'Failed to create session')
```

## Common Node.js Patterns

### Async/Await Error Handling

```typescript
// Good
async function fetchData(): Promise<Data> {
  try {
    const response = await fetch(url)
    return await response.json()
  } catch (err) {
    logger.error({ err }, 'Failed to fetch data')
    throw new DataFetchError('Could not fetch data', err)
  }
}

// With retry
async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 3
): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn()
    } catch (err) {
      if (i === retries - 1) throw err
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)))
    }
  }
  throw new Error('All retries exhausted')
}
```

### Environment Configuration

```typescript
import { config } from 'dotenv'
import { z } from 'zod'

config()

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
})

export const env = envSchema.parse(process.env)
```

## Performance Best Practices

### Avoid Blocking Operations

```typescript
// ❌ Bad - blocking
import fs from 'fs'
const data = fs.readFileSync('file.txt', 'utf-8')

// ✅ Good - non-blocking
import { readFile } from 'fs/promises'
const data = await readFile('file.txt', 'utf-8')
```

### Connection Pooling

```typescript
// Database pool
import { Pool } from 'pg'

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  min: 2,
  max: 20,
  idleTimeoutMillis: 30000,
})

// Redis pool
import Redis from 'ioredis'

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 50, 2000),
})
```

## Development Workflow Integration

### Pre-commit Checks

Consider using husky + lint-staged:

```bash
pnpm add -D husky lint-staged
```

```json
{
  "lint-staged": {
    "*.ts": [
      "eslint --fix",
      "prettier --write",
      "vitest related --run"
    ]
  }
}
```

### CI/CD Pipeline

Example GitHub Actions workflow:

```yaml
name: CI
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: pnpm/action-setup@v2
        with:
          version: 8
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
          cache: 'pnpm'
      - run: pnpm install
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test:coverage
```

## Quick Reference

### Complete Pre-PR Checklist

```bash
# Run all checks
pnpm tsc --noEmit && \
pnpm lint && \
pnpm test:unit && \
pnpm test:integration && \
pnpm test:coverage
```

### Useful Commands

```bash
# Watch mode for development
pnpm test:unit --watch

# Run specific test file
pnpm test tests/unit/Component.test.ts

# Debug tests
pnpm test --inspect-brk

# Update snapshots
pnpm test -u

# Check types in watch mode
pnpm tsc --noEmit --watch
```

## Additional Resources

For deeper guidance on universal development practices, the global `developer` skill includes comprehensive reference documents:

- **Git Workflow Guide**: Branching strategies, commit conventions, PR templates, conflict resolution
- **Testing Guide**: Test philosophy, coverage requirements, mocking strategies, test organization
- **Code Review Checklist**: Comprehensive review criteria covering quality, security, performance, documentation

These references provide foundational knowledge that applies across all projects, while this skill provides SyncKairos-specific implementation details.
