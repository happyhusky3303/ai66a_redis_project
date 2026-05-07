#!/bin/bash

# Rate Limiting API Gateway - Setup Script
# This script automates the initial setup process

set -e

echo "🚀 Rate Limiting & API Gateway Setup"
echo "======================================"
echo ""

# Check prerequisites
echo "Checking prerequisites..."

if ! command -v docker &> /dev/null; then
  echo "❌ Docker is not installed"
  exit 1
fi

if ! command -v npm &> /dev/null; then
  echo "❌ npm is not installed"
  exit 1
fi

echo "✓ Docker installed"
echo "✓ npm installed"
echo ""

# Start services
echo "Starting Docker services..."
docker-compose up -d

echo "Waiting for services to initialize... (10 seconds)"
sleep 10

# Check if services are running
echo ""
echo "Verifying services..."

if docker exec rate-limiting-redis redis-cli ping > /dev/null 2>&1; then
  echo "✓ Redis is running"
else
  echo "❌ Redis failed to start"
  docker-compose logs redis
  exit 1
fi

if docker exec rate-limiting-postgres pg_isready -U postgres > /dev/null 2>&1; then
  echo "✓ PostgreSQL is running"
else
  echo "❌ PostgreSQL failed to start"
  docker-compose logs postgres
  exit 1
fi

echo "✓ MongoDB is running"
echo ""

# Initialize database
echo "Initializing databases..."
npm run init-db

# Seed data
echo ""
echo "Seeding sample data..."
npm run seed

echo ""
echo "✅ Setup complete!"
echo ""
echo "📊 Access the application:"
echo "  Dashboard: http://localhost:3000"
echo "  Admin:     http://localhost:3000/admin"
echo "  API Key:   your_secret_admin_key_here"
echo ""
echo "📊 Other services:"
echo "  PgAdmin:        http://localhost:5050 (admin@local.com / admin)"
echo "  MongoDB Express: http://localhost:8081 (admin / admin)"
echo "  Redis:          localhost:6379"
echo ""
echo "🧪 Next: Visit http://localhost:3000 to test the system!"
