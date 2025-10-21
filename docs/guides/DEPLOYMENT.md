# Deployment Guide

## Prerequisites

- Node.js ≥20.0.0
- pnpm 10.8.0+
- Redis 7+
- PostgreSQL 15+

## Local Development

```bash
# 1. Install
pnpm install

# 2. Setup environment
cp .env.example .env
# Edit .env with your credentials

# 3. Start Redis (Docker)
docker run -d -p 6379:6379 redis:7-alpine

# 4. Start PostgreSQL (Docker)
docker run -d \
  -p 5432:5432 \
  -e POSTGRES_DB=synckairos \
  -e POSTGRES_USER=user \
  -e POSTGRES_PASSWORD=password \
  postgres:15-alpine

# 5. Run migrations
pnpm run migrate

# 6. Start development server
pnpm dev
```

## Production Deployment

```bash
# 1. Build
pnpm build

# 2. Run migrations
NODE_ENV=production pnpm run migrate

# 3. Start
NODE_ENV=production pnpm start
```

## Docker Deployment

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
CMD ["pnpm", "start"]
```

## Health Checks

```bash
# Application health
curl http://localhost:3000/health

# Redis health
redis-cli ping

# PostgreSQL health
psql $DATABASE_URL -c "SELECT 1"
```

## Environment-Specific Settings

**Development**:
- LOG_LEVEL=debug
- Single instance

**Production**:
- LOG_LEVEL=info
- Multiple instances (3-5+)
- Redis cluster
- PostgreSQL with replicas
- Load balancer (NO sticky sessions)

## Scaling

### Horizontal Scaling
```bash
# Add more instances (zero config needed)
pm2 start dist/index.js -i 4
```

### Redis Scaling
- Use Redis Cluster for > 100k sessions
- Monitor memory usage

### PostgreSQL Scaling
- Read replicas for analytics
- Not needed for real-time operations
