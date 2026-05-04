@echo off
REM Rate Limiting API Gateway - Windows Setup Script

echo.
echo 🚀 Rate Limiting ^& API Gateway Setup
echo ======================================
echo.

REM Check prerequisites
echo Checking prerequisites...

where docker >nul 2>nul
if errorlevel 1 (
  echo ❌ Docker is not installed
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo ❌ npm is not installed
  pause
  exit /b 1
)

echo ✓ Docker installed
echo ✓ npm installed
echo.

REM Start services
echo Starting Docker services...
docker-compose up -d

echo Waiting for services to initialize... (10 seconds)
timeout /t 10 /nobreak

REM Verify services
echo.
echo Verifying services...

docker exec rate-limiting-redis redis-cli ping >nul 2>&1
if errorlevel 0 (
  echo ✓ Redis is running
)

docker exec rate-limiting-postgres pg_isready -U postgres >nul 2>&1
if errorlevel 0 (
  echo ✓ PostgreSQL is running
)

echo ✓ MongoDB is running
echo.

REM Initialize database
echo Initializing databases...
call npm run init-db

REM Seed data
echo.
echo Seeding sample data...
call npm run seed

echo.
echo ✅ Setup complete!
echo.
echo 📊 Access the application:
echo   Dashboard: http://localhost:3000
echo   Admin:     http://localhost:3000/admin
echo   API Key:   your_secret_admin_key_here
echo.
echo 📊 Other services:
echo   PgAdmin:        http://localhost:5050 (admin@local.com / admin)
echo   MongoDB Express: http://localhost:8081 (admin / admin)
echo   Redis:          localhost:6379
echo.
echo 🧪 Next: Visit http://localhost:3000 to test the system!
echo.
pause
