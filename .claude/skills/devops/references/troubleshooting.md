# SyncKairos DevOps Troubleshooting Guide

Common issues and solutions encountered during SyncKairos deployment and operations.

## Database Connection Issues

### PostgreSQL: Password Authentication Failed

**Error:**
```
password authentication failed for user "user"
```

**Common Causes:**
1. Wrong credentials in DATABASE_URL
2. Special characters not URL-encoded
3. Using wrong .env file (e.g., .env instead of .env.local for local development)

**Solutions:**

1. **Check credentials match your environment:**
   - Local docker-compose: `postgres:postgres`
   - Supabase: Your actual Supabase password

2. **URL-encode special characters in password:**
   ```bash
   # If password is: 4NC#&v3FQqhG&cd
   # Encode as:     4NC%23%26v3FQqhG%26cd
   ```

   Common encodings:
   - `#` → `%23`
   - `&` → `%26`
   - `@` → `%40`
   - `=` → `%3D`
   - `?` → `%3F`

3. **Verify .env file is being used:**
   ```bash
   cat .env | grep DATABASE_URL
   # Should match your actual environment
   ```

### PostgreSQL: SSL Connection Error

**Error:**
```
The server does not support SSL connections
```

**Solution:**
Add `?sslmode=disable` to DATABASE_URL for local PostgreSQL:
```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/synckairos?sslmode=disable
```

For remote PostgreSQL (Supabase), ensure SSL is enabled in client configuration:
```javascript
const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
```

### PostgreSQL: Connection Refused

**Error:**
```
Error: connect ECONNREFUSED 127.0.0.1:5432
```

**Common Causes:**
1. PostgreSQL not running
2. Wrong port
3. Firewall blocking connection

**Solutions:**

1. **Check if PostgreSQL is running:**
   ```bash
   docker ps | grep postgres
   # Should show synckairos-postgres container
   ```

2. **Verify port:**
   - Local docker-compose uses port 5433 (not 5432)
   - Check DATABASE_URL has correct port
   ```bash
   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/synckairos
   ```

3. **Restart docker-compose:**
   ```bash
   docker compose down
   docker compose up -d
   ```

### Redis: Connection Refused

**Error:**
```
Error: connect ECONNREFUSED 127.0.0.1:6379
```

**Solutions:**

1. **Check if Redis is running:**
   ```bash
   docker ps | grep redis
   # Should show synckairos-redis container
   ```

2. **Verify REDIS_URL:**
   ```bash
   cat .env | grep REDIS_URL
   # Local: redis://localhost:6379
   # Upstash: rediss://default:***@***.upstash.io:6379
   ```

3. **Restart Redis container:**
   ```bash
   docker restart synckairos-redis
   ```

### Redis: TLS Required

**Error:**
```
Error: Client network socket disconnected before secure TLS connection
```

**Solution:**
Use `rediss://` (with double 's') for TLS-enabled Redis:
```bash
# Wrong:
REDIS_URL=redis://default:***@***.upstash.io:6379

# Correct:
REDIS_URL=rediss://default:***@***.upstash.io:6379
```

## Docker Issues

### Port Already in Use

**Error:**
```
Error: Bind for 0.0.0.0:5432 failed: port is already allocated
```

**Solution:**

1. **Find what's using the port:**
   ```bash
   lsof -i :5432
   # or
   netstat -an | grep 5432
   ```

2. **Option A: Change docker-compose port:**
   ```yaml
   postgres:
     ports:
       - "5433:5432"  # Use 5433 externally, 5432 internally
   ```

   Update DATABASE_URL:
   ```bash
   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/synckairos
   ```

3. **Option B: Stop conflicting service:**
   ```bash
   # If local PostgreSQL is running
   brew services stop postgresql
   # or
   sudo systemctl stop postgresql
   ```

### Container Name Conflict

**Error:**
```
Error: The container name "/synckairos-redis" is already in use
```

**Solution:**
Remove old containers:
```bash
docker rm -f synckairos-redis synckairos-postgres
docker compose up -d
```

### Container Won't Start

**Solution:**

1. **Check container logs:**
   ```bash
   docker logs synckairos-postgres
   docker logs synckairos-redis
   ```

2. **Remove and recreate:**
   ```bash
   docker compose down -v  # -v removes volumes too
   docker compose up -d
   ```

## Migration Issues

### Tables Not Created

**Symptom:**
Migration script reports success but tables don't exist.

**Solution:**
Use `direct-migrate.js` instead of pool-based migration:
```bash
node scripts/direct-migrate.js
```

This script uses `Client` instead of `Pool` for more reliable migration execution.

### Migration Permission Denied

**Error:**
```
ERROR: permission denied for schema public
```

**Solution:**
Ensure database user has CREATE permissions:
```sql
GRANT CREATE ON SCHEMA public TO postgres;
```

For Supabase, use the `postgres` user (default has full permissions).

## Health Check Failures

### /health Returns 404

**Cause:**
Application not running or wrong URL.

**Solution:**
1. Check application is running:
   ```bash
   ps aux | grep node
   ```

2. Verify port:
   ```bash
   curl http://localhost:3000/health
   # Not http://localhost:8080/health
   ```

### /ready Returns "not_ready"

**Cause:**
Redis or PostgreSQL connection issue.

**Solution:**

1. **Check the error message:**
   ```bash
   curl http://localhost:3000/ready | jq .
   ```

2. **Test connections individually:**
   ```bash
   node ~/.claude/skills/devops/scripts/test-redis.js
   node ~/.claude/skills/devops/scripts/test-postgres.js
   ```

3. **Common fixes:**
   - Verify REDIS_URL and DATABASE_URL in .env
   - Ensure docker-compose services are running
   - Check credentials match environment

## Fly.io Deployment Issues

### Health Checks Failing on Fly.io

**Symptom:**
Machine shows "stopped" status with health check warnings.

**Solution:**

1. **Check Fly.io logs:**
   ```bash
   flyctl logs --app synckairos-staging
   ```

2. **Verify secrets are set:**
   ```bash
   flyctl secrets list --app synckairos-staging
   ```

3. **Test health endpoint:**
   ```bash
   curl https://synckairos-staging.fly.dev/health
   curl https://synckairos-staging.fly.dev/ready
   ```

4. **Common issues:**
   - Secrets not set or have wrong values
   - Database URL not URL-encoded
   - Wrong region (high latency causing timeouts)

### Wrong Region / High Latency

**Symptom:**
PostgreSQL queries taking >100ms, health checks timing out.

**Solution:**
Ensure all services are in the same region:
- **Fly.io:** Sydney (`syd`) in fly.toml
- **Upstash:** Australia (Sydney)
- **Supabase:** Australia (Sydney)

To change Fly.io region:
```bash
# Update fly.toml
primary_region = 'syd'

# Redeploy
flyctl deploy --app synckairos-staging
```

## Environment Variable Issues

### Wrong .env File Being Used

**Symptom:**
Application uses wrong credentials despite updating .env.

**Solution:**

1. **Check which .env file is loaded:**
   - Default: `.env`
   - Production: `.env.production` (must set NODE_ENV=production)
   - Local: `.env.local` (must set NODE_ENV=development)

2. **Verify environment:**
   ```bash
   echo $NODE_ENV
   # or check in code
   console.log(process.env.NODE_ENV)
   ```

3. **Restart application** after changing .env files

### Missing Environment Variables

**Solution:**
Run validation script:
```bash
bash ~/.claude/skills/devops/scripts/validate-env.sh .env
```

This checks for:
- Required variables present
- Correct format (URLs, values)
- Security issues (weak secrets)

## Performance Issues

### High Query Latency

**Causes:**
1. Wrong region (services in different regions)
2. Network issues
3. Database under load

**Solution:**

1. **Test latency:**
   ```bash
   node ~/.claude/skills/devops/scripts/test-postgres.js
   # Check "Query latency" result
   ```

2. **Expected latencies:**
   - Local: <10ms
   - Same region (Sydney-Sydney): <50ms
   - Cross-region (Sydney-US): >150ms

3. **Fix regional mismatch:**
   - Migrate all services to same region
   - Use regional infrastructure setup guide

### Redis Eviction Policy Warning

**Warning:**
```
IMPORTANT! Eviction policy is allkeys-lru. It should be "noeviction"
```

**Impact:**
State data may be evicted under memory pressure.

**Solution:**
For Upstash, configure eviction policy in dashboard:
1. Go to database settings
2. Set "Eviction Policy" to "noeviction"
3. Restart application

For local Redis:
```bash
docker exec synckairos-redis redis-cli CONFIG SET maxmemory-policy noeviction
```

## Quick Diagnostic Commands

```bash
# Check all services
docker ps

# Check application health
curl http://localhost:3000/health
curl http://localhost:3000/ready

# Test connections
node ~/.claude/skills/devops/scripts/test-redis.js
node ~/.claude/skills/devops/scripts/test-postgres.js

# Validate environment
bash ~/.claude/skills/devops/scripts/validate-env.sh

# Check logs
docker logs synckairos-postgres
docker logs synckairos-redis
flyctl logs --app synckairos-staging

# Restart everything
docker compose down
docker compose up -d
pnpm build && pnpm start
```
