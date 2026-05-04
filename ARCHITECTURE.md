# Architecture & Implementation Details

## System Overview

This is a production-ready **Rate Limiting & API Gateway Cache System** that demonstrates:

1. **Sliding Window Rate Limiting** with atomic Redis operations
2. **Distributed Caching** with TTL and invalidation
3. **Concurrent Voting System** with race condition prevention
4. **Real-time Ranking** using Redis Sorted Sets
5. **Asynchronous Logging** to MongoDB
6. **Admin Monitoring** dashboard with full system visibility

---

## Technical Architecture

### Three-Tier Database Strategy

```
┌─────────────────────────────────────────┐
│        Request Handling Layer           │
│  (Express.js + Rate Limiting)           │
└─────────────────┬───────────────────────┘
                  │
         ┌────────┴────────┐
         │                 │
    ┌────▼──────┐     ┌───▼─────┐
    │   Redis   │     │PostgreSQL│
    │(Real-time)│     │(Durable) │
    └───────────┘     └──────────┘
         │
    ┌────▼─────────┐
    │   MongoDB    │
    │  (Analytics) │
    └──────────────┘
```

### Data Flow for Vote Requests

```
REQUEST: POST /api/vote
         ↓
[1] RATE LIMIT CHECK
    - Redis: Get user's request count in current window
    - Lua Script: Atomically update request count
    - If exceeded: Return 429 + Log to MongoDB
    - If allowed: Continue
    ↓
[2] DATABASE UPDATE
    - PostgreSQL: INSERT or UPDATE vote (unique constraint)
    - Redis: Update vote count and leaderboard
    ↓
[3] CACHE INVALIDATION
    - Redis: Delete cache:ranking
    - Redis: Delete cache:item:{id}
    ↓
[4] ASYNC LOGGING
    - MongoDB: Log request result for analytics
    ↓
RESPONSE: 200 OK + Updated rankings
```

---

## Redis Data Structures

### Sorted Sets (for time-series and leaderboards)

```
rate_limit:user1 (Sorted Set)
  └─ Score: Unix timestamp, Member: request ID
  └─ TTL: 60 seconds
  └─ Used for: Sliding window rate limiting

leaderboard (Sorted Set)
  └─ Score: Total votes, Member: item ID
  └─ TTL: No expiry (refreshed on votes)
  └─ Used for: Top-N queries on O(log N) time
```

### Hash Maps (for counters and metadata)

```
votes:item1 (Hash)
  └─ Field: "total", Value: 42
  └─ Field: "last_updated", Value: timestamp
  └─ TTL: 24 hours
  └─ Used for: Vote counts and metadata

rate_limit_stats:user1 (Hash)
  └─ Field: "allowed", Value: 98
  └─ Field: "blocked", Value: 2
  └─ TTL: 120 seconds
  └─ Used for: Rate limit statistics
```

### Strings (for caching)

```
cache:ranking (String)
  └─ Value: JSON array of top items
  └─ TTL: 300 seconds (5 minutes)
  └─ Used for: Leaderboard caching

cache:item:item1 (String)
  └─ Value: JSON object with item details + score
  └─ TTL: 600 seconds (10 minutes)
  └─ Used for: Item details caching
```

---

## PostgreSQL Schema Design

### Votes Table Optimization

```sql
-- Primary vote table
CREATE TABLE votes (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  item_id UUID NOT NULL REFERENCES items(id),
  vote_value SMALLINT DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_user_item UNIQUE(user_id, item_id)
);

-- Key: UNIQUE(user_id, item_id)
-- This ensures idempotency: same user+item updates the vote, not creates new

-- Index strategy:
-- 1. Primary key on id (auto-indexed)
-- 2. Unique index on (user_id, item_id)
-- 3. Regular indexes on foreign keys
```

### Denormalization Strategy

```
Items table has "score" column:
- NOT the source of truth (Redis is)
- Synced periodically (every 5-10 seconds)
- Used for quick lookups without Redis
- Example: SELECT * FROM items ORDER BY score LIMIT 10
```

---

## Lua Scripts (Atomic Operations)

### 1. Sliding Window Rate Limiting

```lua
-- Input keys: [rate_limit_key, stats_key]
-- Input args: [timestamp, window_seconds, max_requests, request_count]

ZREMRANGEBYSCORE key 0 min_time    -- Remove old entries
local count = ZCARD key             -- Count requests in window

if count < max_requests then
  -- Allow some requests
  allowed = min(requested, max_requests - count)
  -- Add to sorted set
  for i=1,allowed do
    ZADD key timestamp:i timestamp
  end
else
  -- All blocked
  allowed = 0
end

-- Return [allowed, blocked, ttl]
```

**Why Lua?**
- Atomic: No race conditions between check and update
- Fast: Single round-trip to Redis
- Reliable: Partial acceptance (k out of m requests)

### 2. Voting with Score Update

```lua
-- Input keys: [votes_key, user_votes_key, leaderboard_key]
-- Input args: [item_id, user_id, vote_value, timestamp]

-- Check if user already voted
local existing = HGET user_key item_id

if existing then
  -- Update: subtract old, add new
  HINCRBY votes_key total -existing
  is_new = 0
else
  -- New vote
  SADD user_key item_id
  is_new = 1
end

-- Update vote and scores
HSET user_key item_id vote_value
HINCRBY votes_key total vote_value
ZADD leaderboard score item_id

-- Get rank
local rank = ZREVRANK leaderboard item_id

-- Return [new_score, is_new_vote, rank]
```

---

## Performance Optimizations

### Redis Optimizations

| Technique | Benefit | Implementation |
|-----------|---------|-----------------|
| Lua Scripts | Atomic operations | Rate limit, voting |
| Sorted Sets | O(log N) leaderboard | Leaderboard ranking |
| Key Expiry | Auto memory management | Cache TTLs |
| Pipeline | Batch operations | Multi-key updates |

### PostgreSQL Optimizations

| Technique | Benefit | Implementation |
|-----------|---------|-----------------|
| Unique Constraint | Vote idempotency | UNIQUE(user_id, item_id) |
| Indexes | Fast lookups | FK indexes on foreign keys |
| Connection Pool | Resource sharing | 20 connections |
| Prepared Statements | SQL injection prevention | All queries |

### Application Layer

| Technique | Benefit | Implementation |
|-----------|---------|-----------------|
| Cache Layer | Reduce DB queries | 3-10 minute TTL |
| Async Logging | Non-blocking | MongoDB async write |
| Connection Pooling | Reuse connections | pg pool, Redis client |
| Lazy Loading | Memory efficiency | Load only needed data |

---

## Concurrency & Race Condition Prevention

### Problem: Vote Race Condition

```
User A: Check votes for item1: 10
User A: Update PostgreSQL: 11
User B: Check votes for item1: 10      <- Race condition!
User B: Update PostgreSQL: 11          <- Both think it's 10, update to 11

Result: Score is 11, should be 12
```

### Solution: Atomic Lua Script

```lua
-- Single round-trip to Redis
HGET votes:item1 total       -- Get current score: 10
HINCRBY votes:item1 total 1  -- Atomic increment: 11
ZADD leaderboard 11 item1    -- Update ranking

-- All happen atomically, no race conditions
```

### Another Issue: Duplicate Votes

```
User: Sends vote request twice (network retry)
Expected: Same vote recorded once (idempotent)
```

### Solution: Unique Constraint

```sql
-- PostgreSQL enforces uniqueness
UNIQUE(user_id, item_id)

-- First vote: INSERT
INSERT INTO votes (user_id, item_id, value)
VALUES (user1, item1, 1)  -- Success

-- Duplicate: UPSERT
INSERT ... ON CONFLICT (user_id, item_id)
DO UPDATE SET value = EXCLUDED.value  -- Idempotent
```

---

## Caching Strategy

### Cache Invalidation

**Problem**: When to invalidate cache?
```
Too soon: Cache hit rate drops, DB overloaded
Too long: Stale data shown to users
```

**Solution**: TTL + Event-based invalidation

```javascript
// TTL approach
CACHE_TTL_RANKING = 300  // 5 minutes

// Event-based
On vote:
  1. Update Redis vote count
  2. Update PostgreSQL
  3. Invalidate cache:ranking  <- Immediate
  4. Invalidate cache:item:{id}
```

### Cache Keys Design

```
cache:ranking           // Leaderboard: 5-min TTL
cache:item:{id}         // Item details: 10-min TTL
cache:user_votes:{uid}  // User's votes: 2-min TTL
```

### Hit Rate Target

```
Typical production:
- Leaderboard: 98% hit rate (cached heavily)
- Item details: 85% hit rate (varies by interest)
- User votes: 60% hit rate (short TTL)

Average: ~80-85% hit rate
```

---

## Logging Strategy

### Three-Level Logging

```
Level 1: Request Logs (PostgreSQL)
  - Table: api_logs
  - Fields: endpoint, method, status, response_time, user_id
  - TTL: 90 days
  - Used for: Audit, debugging, analytics

Level 2: Rate Limit Stats (Redis)
  - Structure: Hash with allowed/blocked counts
  - TTL: 2 minutes
  - Used for: Real-time dashboarding

Level 3: Detailed Logs (MongoDB)
  - Collection: request_logs
  - Fields: All request/response details
  - TTL: 30 days (auto-delete)
  - Used for: Long-term analysis, compliance
```

---

## Horizontal Scalability

### Current Architecture (Single Instance)

```
Client
  ↓
[Express Server] ← Single instance
  ↓
[Redis] ← In-memory, shared state
  ↓
[PostgreSQL] ← Relational data
  ↓
[MongoDB] ← Async logs
```

### Scaling Approach (Multiple Instances)

```
Load Balancer
  ├─ [Express Server 1]
  ├─ [Express Server 2]
  └─ [Express Server 3]
     ↓
[Redis Cluster] ← Shared across instances
  ├─ Master 1
  └─ Master 2
     ↓
[PostgreSQL] ← Connection pooling
  ├─ Master
  └─ Replica (read-only)
     ↓
[MongoDB Replica Set] ← Distributed logs
```

### Redis Lua Scripts in Cluster

**Works seamlessly!** Because:
- Lua scripts are atomic per key
- Rate limit keys are hashed to single node
- No cross-node transactions needed

---

## Security Considerations

### Input Validation

```javascript
// Joi schema validation
POST /api/vote
  ├─ userId: string (1-255 chars)
  ├─ itemId: UUID
  └─ voteValue: -1, 0, 1

// Prevents: Injection, type errors, invalid data
```

### Rate Limiting as Security

```
Normal user: 100 requests/60s ✓
Attacker: 1000 requests/60s → 429 Too Many Requests
Bot: 10000 requests/60s → Blocked immediately
```

### Admin Authentication

```
Header: x-admin-api-key
Verification: Exact match with ADMIN_API_KEY env var

In production: JWT tokens, API key rotation, etc.
```

---

## Monitoring & Observability

### Key Metrics

```
Rate Limiting:
  - Requests allowed: Counter
  - Requests blocked: Counter
  - Unique users: Set cardinality

Caching:
  - Hit rate: (hits / (hits + misses)) * 100
  - Memory usage: INFO memory from Redis
  - Eviction rate: Number of deleted keys/minute

Application:
  - Response time: Histogram of request duration
  - Error rate: 4xx + 5xx / total requests
  - Database queries: Count + timing
```

---

## Production Checklist

- [ ] Change ADMIN_API_KEY from default
- [ ] Enable Redis persistence (appendonly yes)
- [ ] Set PostgreSQL passwords securely
- [ ] Enable SSL/TLS for MongoDB
- [ ] Setup monitoring (Prometheus + Grafana)
- [ ] Setup log aggregation (ELK stack)
- [ ] Enable database backups
- [ ] Setup horizontal scaling (k8s, etc.)
- [ ] Enable request signing/JWT auth
- [ ] Setup alerting for rate limit violations
- [ ] Test disaster recovery procedures

---

**This architecture is designed for high concurrency, low latency, and linear scalability.**
