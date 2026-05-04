# 🚀 Rate Limiting & API Gateway Cache System

A comprehensive full-stack system demonstrating advanced caching, rate limiting, and distributed voting with Redis, PostgreSQL, and MongoDB.

## 📋 Features

### ⚡ Rate Limiting
- **Sliding Window Rate Limiting** using Redis Sorted Sets
- Atomic operations with Lua scripts
- Partial request acceptance (allow k out of m requests)
- Per-user rate limit tracking
- Configurable limits and time windows

### 💾 Caching Strategy
- **Redis caching** for heavy database queries
- TTL-based cache invalidation
- Cache hit/miss statistics
- Automatic cache invalidation on data updates
- Pattern-based cache clearing

### 🗳️ Voting System
- Concurrent voting with race condition prevention
- Real-time score updates in Redis
- Transactional consistency with PostgreSQL
- User vote history tracking

### 🏆 Ranking & Leaderboard
- Redis Sorted Set for O(log N) operations
- Top-N queries with pagination
- Real-time ranking updates
- Cache-friendly leaderboard serving

### 📊 Frontend Dashboard
- Real-time rate limit monitoring
- Cache inspector with TTL countdown
- Request spam simulator (200+ concurrent requests)
- Live leaderboard visualization
- System health status

### 🔐 Admin Panel
- Rate limit monitoring and statistics
- Cache management and invalidation
- User and item management
- API logging and analytics
- System performance metrics

### 🔄 Data Flow
```
User Request
  ↓
[Rate Limit Check - Redis]
  ├─ BLOCKED → 429 Response + Async Log to MongoDB
  └─ ALLOWED
      ↓
[Vote Processing]
  ├─ Update Redis (Real-time)
  ├─ Update PostgreSQL (Transactional)
  ├─ Invalidate Caches
  └─ Async Log to MongoDB
```

## 🗄️ Database Schema

### PostgreSQL
- **users**: User management
- **items**: Voteable items
- **votes**: Transactional voting records (unique per user-item)
- **rate_limit_stats**: Rate limiting statistics
- **cache_stats**: Cache performance metrics
- **api_logs**: API request logs

### MongoDB
- **request_logs**: Asynchronous logging (TTL: 30 days)

### Redis
- **rate_limit:{userId}**: Sorted set of requests per user
- **rate_limit_stats:{userId}**: Rate limit statistics
- **votes:{itemId}**: Vote counts and metadata
- **user_votes:{userId}**: User's voted items
- **leaderboard**: Sorted set ranking
- **cache:{key}**: Cached data
- **cache_stats:{key}**: Cache statistics

## 🛠️ Tech Stack

- **Backend**: Node.js (18+) + Express.js
- **Caching**: Redis (7+)
- **Database**: PostgreSQL (15+) + MongoDB (6+)
- **Frontend**: HTML5 + CSS3 + Vanilla JavaScript
- **Containerization**: Docker + Docker Compose
- **Scripting**: Lua (for Redis atomic operations)

## 📦 Installation

### Prerequisites
- Docker & Docker Compose
- OR Node.js 18+, Redis 7+, PostgreSQL 15+, MongoDB 6+

### Quick Start with Docker

```bash
# Clone/navigate to project directory
cd ai66a_redis_project

# Start all services
docker-compose up -d

# Initialize databases
docker exec rate-limiting-api npm run init-db

# Seed sample data
docker exec rate-limiting-api npm run seed

# Access dashboard
open http://localhost:3000
open http://localhost:3000/admin (API Key: your_secret_admin_key_here)
```

### Manual Setup

```bash
# Install dependencies
npm install

# Setup environment
cp .env.example .env
# Edit .env with your configuration

# Initialize databases
npm run init-db

# Seed sample data
npm run seed

# Start development server
npm run dev
```

## 🚀 Running the Application

### Production Mode
```bash
docker-compose -f docker-compose.yml up -d
npm start
```

### Development Mode
```bash
npm run dev
```

## 📡 API Endpoints

### Public API (Rate Limited)

#### Voting
```
POST /api/vote
Body: { userId, itemId, voteValue }
Returns: { success, vote, rateLimitInfo }
```

#### Items
```
GET /api/item/:id              # Get item details
GET /api/ranking?limit=10      # Get top N items
GET /api/user/:userId/votes    # Get user votes
```

#### Cache
```
GET /api/cache/stats           # Get cache statistics
POST /api/cache/invalidate/:key # Invalidate cache key
```

#### Rate Limiting
```
GET /api/rate-limit/stats      # Get rate limit statistics
```

#### System
```
POST /api/sync/votes           # Sync Redis to PostgreSQL
GET /api/stats/summary         # Get system summary
```

### Admin API (Requires API Key)

```bash
# All endpoints require header: x-admin-api-key: your_secret_admin_key_here

GET /admin/api/rate-limits     # List active rate limits
GET /admin/api/cache/stats     # Cache detailed statistics
GET /admin/api/users           # List users
GET /admin/api/items           # List items
GET /admin/api/logs            # Get API logs
GET /admin/api/system/stats    # System statistics
```

## ⚙️ Configuration

### Environment Variables

```
# Server
NODE_ENV=development
PORT=3000
LOG_LEVEL=debug

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# PostgreSQL
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=rate_limiting_db
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres123

# MongoDB
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB=rate_limiting_logs

# Rate Limiting
RATE_LIMIT_MAX_REQUESTS=100           # Per user
RATE_LIMIT_WINDOW_SECONDS=60          # Sliding window
RATE_LIMIT_PARTIAL_ACCEPT=true        # Allow partial requests

# Cache TTL (seconds)
CACHE_TTL_RANKING=300
CACHE_TTL_ITEM=600
CACHE_TTL_USER_VOTES=120

# Admin
ADMIN_API_KEY=your_secret_admin_key_here
```

## 🔍 Monitoring & Admin Features

### Dashboard Metrics
- Real-time rate limit status
- Cache hit/miss rates
- Top leaderboard items
- Request spam simulation
- System health indicators

### Admin Panel Features
- Rate limit enforcement monitoring
- Per-user rate limit details
- Cache key management
- User and item CRUD operations
- API logging and analytics
- System performance metrics

## 🧪 Testing Rate Limiting

### Manual Testing
1. Visit http://localhost:3000
2. Use "Request Spam Simulator" to send 200+ requests
3. Observe pass/block status in real-time
4. Monitor rate limit progress bar

### API Testing
```bash
# Cast vote
curl -X POST http://localhost:3000/api/vote \
  -H "Content-Type: application/json" \
  -H "x-user-id: user1" \
  -d '{"userId":"user1","itemId":"item1"}'

# Get leaderboard
curl http://localhost:3000/api/ranking?limit=10

# Get cache stats
curl http://localhost:3000/api/cache/stats
```

## 📊 Performance Considerations

### Redis Optimizations
- Lua scripts for atomic operations
- Sorted sets for O(log N) leaderboard queries
- Hash maps for efficient statistics
- Key expiration for memory management

### PostgreSQL Optimizations
- Indexes on foreign keys
- Unique constraint on votes (user_id, item_id)
- Partition support for large vote tables
- Connection pooling (20 connections)

### Caching Strategy
- Heavy queries cached in Redis
- 5-10 minute TTL for rankings
- 10-15 minute TTL for items
- 2 minute TTL for user votes

### Concurrency Safety
- Lua scripts prevent race conditions
- Serializable transaction isolation
- Atomic Redis operations
- PostgreSQL UPSERT for idempotency

## 🔐 Security Features

- Request validation with Joi
- Rate limiting per user/IP
- Admin API key authentication
- Input sanitization
- SQL injection prevention (parameterized queries)
- CORS enabled

## 📝 Logging

### Log Locations
- `logs/debug.log` - All logs
- `logs/error.log` - Errors only
- `logs/combined.log` - Combined logs
- MongoDB - Async request logging (30-day retention)

### Log Levels
- `debug` - Detailed information
- `info` - General information
- `warn` - Warning messages
- `error` - Error messages

## 🐛 Troubleshooting

### Port Already in Use
```bash
# Find process using port 3000
lsof -i :3000

# Kill the process
kill -9 <PID>
```

### Redis Connection Error
```bash
# Check Redis connection
redis-cli ping

# Reset Redis
docker-compose restart redis
```

### PostgreSQL Issues
```bash
# Check PostgreSQL logs
docker-compose logs postgres

# Reset PostgreSQL
docker-compose down -v
docker-compose up postgres
```

## 📚 Architecture Diagrams

### System Architecture
```
┌─────────────┐
│   Browser   │
└──────┬──────┘
       │ HTTP/WebSocket
       ▼
┌─────────────────────────┐
│   Express.js Server     │
│  Rate Limiting Layer    │
│  Caching Layer          │
└──────┬──────┬──────┬────┘
       │      │      │
   ┌───▼──┐ ┌─▼────┐ ┌─▼──────────┐
   │Redis │ │PgSQL │ │  MongoDB   │
   └──────┘ └──────┘ └────────────┘
```

### Request Flow
```
Request → Rate Limit Check (Redis Lua)
         ├─ BLOCKED → 429 + Log to MongoDB
         └─ ALLOWED → Process
           ├─ Update Redis (Real-time)
           ├─ Update PostgreSQL (Durable)
           ├─ Invalidate Caches
           ├─ Log to MongoDB (Async)
           └─ Return 200
```

## 📄 License

MIT

## 👨‍💻 Contributing

Contributions welcome! Please follow existing code style and add tests for new features.

## 📞 Support

For issues or questions, please refer to the documentation or create an issue in the repository.

---

**Built with ❤️ for scalable API gateway solutions**
