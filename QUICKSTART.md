# 🚀 Quick Start Guide - Rate Limiting & API Gateway Cache System

## 5-Minute Setup

### Step 1: Start Services with Docker

```bash
cd ai66a_redis_project

# Start all containers
docker-compose up -d

# Wait 10 seconds for services to initialize
sleep 10
```

### Step 2: Initialize Databases

npm install dotenv

```bash
# Create database schema and tables
npm run init-db

# Seed with sample data
npm run seed
```

### Step 3: Access the Application

```bash
# Dashboard (User Interface)
open http://localhost:3000

# Admin Panel
open http://localhost:3000/admin
# Admin API Key: your_secret_admin_key_here
```

---

## 🧪 Quick Testing

### Test Rate Limiting

1. Open http://localhost:3000 in your browser
2. Go to **Request Spam Simulator** section
3. Set number of requests to 200
4. Click **Send Requests**
5. Watch real-time pass/block statistics

### Test Voting System

1. Enter **User ID**: `testuser`
2. Enter **Item ID**: `item1`
3. Click **Cast Vote**
4. Refresh **Ranking Leaderboard** to see updated scores

### Test Admin Panel

1. Open http://localhost:3000/admin
2. Enter Admin API Key: `your_secret_admin_key_here`
3. Explore:
   - Rate Limits dashboard
   - Cache statistics
   - User management
   - System health

---

## 📡 API Quick Reference

### Cast a Vote
```bash
curl -X POST http://localhost:3000/api/vote \
  -H "Content-Type: application/json" \
  -H "x-user-id: user1" \
  -d '{
    "userId": "user1",
    "itemId": "item1",
    "voteValue": 1
  }'
```

### Get Ranking
```bash
curl http://localhost:3000/api/ranking?limit=10
```

### Get Cache Stats
```bash
curl http://localhost:3000/api/cache/stats
```

### Get Rate Limit Stats
```bash
curl http://localhost:3000/api/rate-limit/stats
```

### Admin: List Active Rate Limits
```bash
curl http://localhost:3000/admin/api/rate-limits \
  -H "x-admin-api-key: your_secret_admin_key_here"
```

---

## 🛠️ Troubleshooting

### Port 3000 Already in Use
```bash
# Find and kill process
lsof -i :3000
kill -9 <PID>
```

### Redis Connection Error
```bash
# Restart Redis
docker-compose restart redis

# Or check Redis status
docker exec rate-limiting-redis redis-cli ping
```

### Database Connection Failed
```bash
# Check logs
docker-compose logs postgres

# Reset databases
docker-compose down -v
docker-compose up -d
```

### Admin Key Not Working
Update the `.env` file and restart:
```bash
ADMIN_API_KEY=your_new_key_here
docker-compose restart app
```

---

## 📊 Key Metrics to Monitor

### Rate Limiting
- **Max Requests per 60s**: 100 (configurable)
- **Current Usage**: Shown in dashboard progress bar
- **Blocked Requests**: Real-time counter

### Caching
- **Hit Rate**: Target >80%
- **Cache Keys**: Around 5-10 keys in production
- **TTL Values**:
  - Leaderboard: 5 minutes
  - Items: 10 minutes
  - User Votes: 2 minutes

### System Health
- **Redis Memory**: Monitor for growth
- **PostgreSQL Connections**: Should stay <20
- **MongoDB Logs**: Auto-cleanup after 30 days

---

## 🔧 Configuration Changes

### Increase Rate Limit
Edit `.env`:
```
RATE_LIMIT_MAX_REQUESTS=200      # Increase from 100
RATE_LIMIT_WINDOW_SECONDS=60     # Keep 60 seconds
```

Restart:
```bash
docker-compose restart app
```

### Change Cache TTL
Edit `.env`:
```
CACHE_TTL_RANKING=600            # 10 minutes instead of 5
CACHE_TTL_ITEM=1200              # 20 minutes instead of 10
```

### Change Admin Key
Edit `.env`:
```
ADMIN_API_KEY=my_super_secure_key_123
```

---

## 📈 Performance Tips

1. **Monitor Redis Memory**: Keep under 1GB
2. **Clean Old Logs**: MongoDB auto-deletes after 30 days
3. **Cache Hit Rate**: Aim for >80%
4. **Database Indexes**: Already optimized in schema
5. **Connection Pooling**: PostgreSQL uses pool of 20

---

## 🔐 Security Checklist

- [ ] Change `ADMIN_API_KEY` from default
- [ ] Change PostgreSQL password in `.env`
- [ ] Enable Redis authentication (production)
- [ ] Use HTTPS in production
- [ ] Implement request signing/JWT
- [ ] Add API rate limiting per IP
- [ ] Monitor suspicious voting patterns

---

## 📚 Next Steps

1. **Customize Rate Limiting**: Adjust limits for your use case
2. **Add Authentication**: Implement user signup/login
3. **Set Up Monitoring**: Use Prometheus/Grafana
4. **Enable Logging**: Ship logs to ELK stack
5. **Production Deployment**: Use Kubernetes or managed services
6. **Scale Horizontally**: Add load balancer + multiple replicas

---

## 💡 Example Use Cases

### E-voting System
- Rate limit: 1 vote per user per election
- Cache: Leaderboard updates every 5 minutes
- Audit: All votes logged to MongoDB

### Product Rating
- Rate limit: 10 ratings per hour per user
- Cache: Top products updated every 2 minutes
- Analytics: Track rating patterns in MongoDB

### Content Ranking
- Rate limit: 50 upvotes per hour per user
- Cache: Trending content every 1 minute
- Feed: Serve from cache for 98% hit rate

---

## 🆘 Getting Help

Check logs:
```bash
# Application logs
docker-compose logs -f app

# Redis logs
docker-compose logs -f redis

# PostgreSQL logs
docker-compose logs -f postgres

# MongoDB logs
docker-compose logs -f mongodb
```

---

**Happy voting! 🗳️**
