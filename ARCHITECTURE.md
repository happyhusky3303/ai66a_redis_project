# Architecture & Implementation Details

## System Overview

This is a production-ready **High-Performance API Gateway** that demonstrates:

1. **Sliding Window Rate Limiting** with atomic Redis operations
2. **Distributed Caching** with TTL and invalidation
3. **Concurrent Voting System** with race condition prevention
4. **Real-time Ranking** using Redis Sorted Sets
5. **PostgreSQL Durability** for ACID compliance
6. **Asynchronous Logging** to MongoDB
7. **Admin Monitoring** dashboard with full system visibility

---

## 🏗 Technical Architecture

### Three-Tier Database Strategy

```
┌────────────────────────────────────────────────────┐
│             HTTP CLIENT / USER                      │
└────────────────────┬─────────────────────────────┘
                     │ HTTP Request
         ┌───────────▼───────────┐
         │   RATE LIMIT CHECK    │
         │  (Redis Lua Script)   │
         │  O(log N) complexity  │
         └───────┬───────────────┘
                 │
        ┌────────▼─────────┐
        │  CACHE LAYER     │
        │ (Redis Check)    │
        └────────┬─────────┘
                 │
     ┌───────────▼──────────────┐
     │  BUSINESS LOGIC          │
     │  (Node.js Service)       │
     └───────────┬──────────────┘
                 │
    ┌────────────┼────────────┬───────────┐
    │            │            │           │
┌───▼──┐  ┌─────▼──┐  ┌──────▼──┐  ┌────▼───┐
│Redis │  │Postgres│  │MongoDB  │  │Cache   │
│Core  │  │(ACID)  │  │(Logging)│  │Invalid.│
└──────┘  └────────┘  └─────────┘  └────────┘
```

### Request Flow

```
REQUEST: POST /api/vote
         ↓
[1] RATE LIMIT CHECK (Redis Lua)
    - Key: rate_limit:{userId}
    - Type: Sorted Set
    - Remove expired entries: O(log N)
    - Count in window: O(log N)
    - If blocked: Return 429
    ↓ (if allowed)
    
[2] CACHE CHECK (Redis)
    - Check cache:ranking, cache:item:{id}
    - If HIT: Return immediately
    - If MISS: Continue
    ↓
    
[3] VOTING LOGIC (Redis Lua - ATOMIC)
    - Prevent duplicate votes
    - Update vote count
    - Update leaderboard (Sorted Set)
    - All atomic with Lua script
    ↓
    
[4] DATABASE SYNC (PostgreSQL)
    - UPSERT to votes table
    - INSERT ... ON CONFLICT
    - Ensures durability
    ↓
    
[5] CACHE INVALIDATION (Redis)
    - DEL cache:ranking
    - DEL cache:item:{itemId}
    ↓
    
[6] ASYNC LOGGING (MongoDB)
    - Log endpoint, userId, status, time
    - Non-blocking (background job)
    ↓
    
RESPONSE: 200 OK + Updated rankings
```

---

## 🧠 Redis Data Structures

### Rate Limiting
```
rate_limit:{userId}
├─ Type: Sorted Set
├─ Score: Unix timestamp (ms)
├─ Member: Request ID
├─ TTL: window_seconds + 1
└─ Used for: Sliding window enforcement
```

### Leaderboard
```
leaderboard
├─ Type: Sorted Set
├─ Score: Total votes for item
├─ Member: itemId
├─ TTL: Never expires (persistent)
└─ Used for: Real-time ranking (O(log N) queries)
```

### Vote Tracking
```
votes:{itemId}
├─ Type: Hash
├─ Fields:
│  ├─ total: Sum of all votes
│  ├─ last_updated: Timestamp
│  └─ updated_by: User ID
├─ TTL: 7 days
└─ Used for: Vote count tracking

user_votes:{userId}
├─ Type: Hash
├─ Fields: {itemId -> voteValue}
├─ TTL: 7 days
└─ Used for: Duplicate vote detection

vote_history:{itemId}
├─ Type: Sorted Set
├─ Score: Timestamp
├─ Member: userId:voteValue
├─ TTL: 7 days
└─ Used for: Audit trail
```

### Caching
```
cache:ranking:{limit}:{offset}
├─ Type: String (JSON)
├─ TTL: 300 seconds
└─ Used for: Leaderboard caching

cache:item:{itemId}
├─ Type: String (JSON)
├─ TTL: 600 seconds
└─ Used for: Individual item caching

cache:stats
├─ Type: Hash
├─ Fields: hits, misses, invalidations
└─ Used for: Cache statistics
```

### Statistics & Monitoring
```
rate_limit_stats:{userId}
├─ Type: Hash
├─ Fields: allowed, blocked
├─ TTL: window_seconds * 2
└─ Used for: Rate limit tracking

cache:invalidation_log
├─ Type: List
├─ Keeps last 1000 entries
├─ TTL: 1 day
└─ Used for: Audit trail
```

---

## 📦 Lua Scripts (Atomic Operations)

### 1. slidingWindowRateLimit.lua
```
Purpose: Enforce sliding window rate limiting atomically

Input:
- userId: User identifier
- maxRequests: Limit per window
- windowSeconds: Time window
- requestCount: Number to validate

Operations (all atomic):
1. Remove entries older than window: O(log N)
2. Count current entries: O(1)
3. Add new entries if allowed: O(log N)
4. Update statistics hash
5. Set TTL

Output: [allowed, blocked, remaining, retryAfter]
Complexity: O(log N) per request
```

### 2. voting.lua
```
Purpose: Cast or update vote atomically (idempotent)

Input:
- itemId: Item being voted on
- userId: User casting vote
- voteValue: Vote value (-10 to 10)
- timestamp: Current timestamp

Operations (all atomic):
1. Check existing vote (duplicate detection)
2. If exists & same value: Return current state (idempotent)
3. If exists & different: Update difference
4. If new: Add new vote
5. Update votes:{itemId} hash
6. Update leaderboard Sorted Set
7. Update vote_history for audit
8. Calculate rank

Output: [newScore, rank, isNewVote, oldVoteValue]
Guarantees:
- No race conditions
- No double-counting
- Idempotent (safe to retry)
```

### 3. cacheInvalidation.lua
```
Purpose: Atomically invalidate caches and update stats

Input:
- cacheKeys: Array of keys to delete
- operationType: manual, auto, system, vote
- ttl: TTL for stats

Operations (all atomic):
1. Delete all provided cache keys
2. Update invalidation statistics
3. Maintain audit log (last 1000 entries)
4. Set TTL for cleanup

Output: [totalDeleted, keysAffected]
```

---

## 🗄 PostgreSQL Schema

### Tables
```sql
-- Users
CREATE TABLE users (
  id UUID PRIMARY KEY,
  username VARCHAR UNIQUE NOT NULL,
  email VARCHAR UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Items
CREATE TABLE items (
  id UUID PRIMARY KEY,
  title VARCHAR NOT NULL,
  description TEXT,
  score INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Votes (source of truth for vote history)
CREATE TABLE votes (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  item_id UUID NOT NULL REFERENCES items(id),
  vote_value INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, item_id)
);

-- Rate Limit Statistics
CREATE TABLE rate_limit_stats (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  window_start TIMESTAMP NOT NULL,
  window_end TIMESTAMP NOT NULL,
  requests_allowed INTEGER DEFAULT 0,
  requests_blocked INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_votes_user_id ON votes(user_id);
CREATE INDEX idx_votes_item_id ON votes(item_id);
CREATE INDEX idx_items_score ON items(score DESC);
CREATE INDEX idx_rate_limit_stats_user ON rate_limit_stats(user_id, window_start);
```

---

## 📊 MongoDB Collections

### request_logs
```
{
  userId: ObjectId,
  endpoint: String,
  method: String,
  status: Number,
  statusCode: Number,
  rateLimited: Boolean,
  action: String,
  itemId: String,
  voteValue: Number,
  responseTime: Number,
  newScore: Number,
  rank: Number,
  error: String,
  timestamp: Date,
  _ttl: Date  // TTL index: 30 days
}
```

Indexes:
```
- userId + timestamp (desc)
- endpoint + timestamp (desc)
- status
- timestamp (TTL: 30 days)
```

---

## ⚡ Performance Characteristics

| Operation | Complexity | Latency |
|-----------|-----------|---------|
| Rate limit check | O(log N) | < 5ms |
| Cache hit | O(1) | < 1ms |
| Vote cast | O(log N) | < 10ms |
| Leaderboard query | O(log N + M) | < 50ms |
| Item fetch | O(1) | < 5ms |

Where:
- N = number of requests in rate limit window (typically < 1000)
- M = number of items returned (typically < 100)

---

## 🔐 Security Features

1. **Rate Limiting**: Atomic sliding window prevents abuse
2. **Admin Bypass**: Requests with admin API key skip rate limiting
3. **Input Validation**: All inputs validated before processing
4. **SQL Injection Prevention**: Parameterized queries
5. **CORS Protection**: Restricted origins
6. **Helmet Security Headers**: Security best practices
7. **Error Handling**: No sensitive data in error messages
8. **Logging**: All actions logged for audit trail

---

## 🚀 Deployment

### Docker Support
```bash
docker-compose up -d
```

Services:
- Redis: localhost:6379
- PostgreSQL: localhost:5432
- MongoDB: localhost:27017
- Application: localhost:3000

### Environment Variables
```
# Redis
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=

# PostgreSQL
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_DB=voting
POSTGRES_USER=postgres
POSTGRES_PASSWORD=secret

# MongoDB
MONGODB_URI=mongodb://mongo:27017
MONGODB_DB=voting_logs

# Application
PORT=3000
NODE_ENV=production
RATE_LIMIT_MAX_REQUESTS=100
RATE_LIMIT_WINDOW_SECONDS=60
ADMIN_API_KEY=your-admin-key

# Cache
CACHE_TTL_ITEM=600
CACHE_TTL_RANKING=300
```

---

## 📈 Monitoring & Observability

### Metrics
- Rate limit hits/blocks per user
- Cache hit/miss ratio
- Average response time
- Voting activity per item
- System health status

### Logging
- Request/response logging to MongoDB
- Rate limit events
- Cache invalidation audit trail
- Error tracking

### WebSocket Real-time Updates
- Rate limit status updates
- Leaderboard changes
- Cache invalidations
- Vote confirmations

---

## 🔄 Consistency & Durability

### Redis → PostgreSQL Sync
- Every vote written to PostgreSQL immediately (UPSERT)
- Ensures durability and ACID compliance
- Can recover Redis data from PostgreSQL if needed

### Idempotency
- Voting Lua script ensures idempotent operations
- Safe to retry without side effects
- Duplicate votes are handled correctly

### Cache Coherency
- Cache invalidated immediately after updates
- Ensures consistency between Redis and PostgreSQL
- Async MongoDB logging doesn't affect consistency

---

## 🎯 Key Features

✅ **Atomic Operations**: All critical logic in Lua scripts
✅ **O(log N) Complexity**: Efficient Redis Sorted Sets
✅ **Idempotent**: Safe to retry requests
✅ **ACID Compliance**: PostgreSQL durability
✅ **Scalable**: Redis can handle millions of operations
✅ **Real-time**: Leaderboard updates instantly
✅ **Monitoring**: Comprehensive logging and stats
✅ **Resilient**: Graceful degradation on failures
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
