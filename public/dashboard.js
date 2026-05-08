'use strict';

let userId = localStorage.getItem('userId') || 'user1';
let simulationRunning = false;
let dashboardInitialized = false;
const API_BASE = window.location.origin;
const AUTH_TOKEN = localStorage.getItem('authToken') || '';
let authUser = null;
const HEALTH_REFRESH_MS = 5000;
const DATA_REFRESH_MS = 15000;
let healthTimer = null;
let dataTimer = null;
let refreshing = false;

function logoutUser() {
  localStorage.removeItem('authToken');
  localStorage.removeItem('authUser');
  localStorage.removeItem('userId');
  window.location.href = '/';
}

function renderCurrentUser() {
  try {
    const raw = localStorage.getItem('authUser');
    authUser = raw ? JSON.parse(raw) : null;
  } catch (error) {
    authUser = null;
  }

  const userLabel = document.getElementById('currentUserLabel');
  if (userLabel) {
    userLabel.textContent = authUser?.username || userId || '--';
  }
}

async function ensureUserRole() {
  const response = await fetch(`${API_BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${AUTH_TOKEN}` }
  });

  if (!response.ok) {
    logoutUser();
    return false;
  }

  const data = await response.json();
  if (!data?.success || !data.user) {
    logoutUser();
    return false;
  }

  if (data.user.role === 'admin') {
    localStorage.removeItem('authToken');
    localStorage.removeItem('authUser');
    localStorage.removeItem('userId');
    window.location.href = '/admin';
    return false;
  }

  localStorage.setItem('authUser', JSON.stringify(data.user));
  userId = data.user.username;
  localStorage.setItem('userId', userId);
  return true;
}

function showMessage(text, type = 'info') {
  const el = document.getElementById('message');
  if (!el) return;
  el.textContent = text;
  el.className = `message show ${type}`;
  setTimeout(() => el.classList.remove('show'), 4000);
}

function updateTimestamp() {
  const now = new Date();
  const timeEl = document.getElementById('lastUpdated');
  if (timeEl) {
    timeEl.textContent = now.toLocaleTimeString();
  }
}

function changeUser() {
  const newUserId = prompt('Enter User ID:', userId) || userId;
  userId = newUserId;
  localStorage.setItem('userId', userId);
  updateRateLimitStatus();
  showMessage(`User changed to: ${userId}`, 'info');
}

async function updateRateLimitStatus() {
  try {
    const response = await fetch(`${API_BASE}/api/health`, {
      headers: { 'x-user-id': userId }
    });

    if (response.status === 429) {
      const rateLimitData = await response.json().catch(() => ({}));
      const retryAfter = rateLimitData?.rateLimitInfo?.retryAfter || rateLimitData?.rateLimitInfo?.resetIn || 60;
      const statusEl = document.getElementById('status');
      statusEl.className = 'status-badge status-warning';
      statusEl.textContent = `LIMIT ${retryAfter}s`;
      return;
    }

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    const rateLimitInfo = data.rateLimitInfo || {};

    document.getElementById('maxRequests').textContent = '100';
    document.getElementById('requestsUsed').textContent = `${rateLimitInfo.allowed || 0}/100`;
    document.getElementById('blocked').textContent = rateLimitInfo.blocked || 0;
    document.getElementById('ttl').textContent = `${rateLimitInfo.retryAfter || '--'}s`;

    const percentage = Math.min(((rateLimitInfo.allowed || 0) / 100) * 100, 100);
    const progressBar = document.getElementById('progressBar');
    progressBar.style.width = `${percentage}%`;
    progressBar.className = `progress-fill${percentage > 80 ? ' danger' : percentage > 50 ? ' warning' : ''}`;

    updateSystemHealth(data);
  } catch (error) {
    const statusEl = document.getElementById('status');
    statusEl.className = 'status-badge status-error';
    statusEl.textContent = 'ERROR';
    console.error('Rate limit update error:', error);
  }
}

async function updateCacheStats() {
  try {
    const response = await fetch(`${API_BASE}/api/cache/stats`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    if (!data.success) throw new Error(data.error || 'Unknown error');

    const summary = data.summary || {};
    document.getElementById('cacheKeyCount').textContent = summary.totalKeys || 0;
    document.getElementById('hitRate').textContent = summary.hitRate || '0.00%';
    document.getElementById('totalHits').textContent = summary.totalHits || 0;
    document.getElementById('totalMisses').textContent = summary.totalMisses || 0;

    const cacheList = document.getElementById('cacheList');
    const stats = data.cacheStats || [];

    if (stats.length === 0) {
      cacheList.innerHTML = '<div class="empty-state">No cache data</div>';
      return;
    }

    cacheList.innerHTML = stats.slice(0, 5).map((item) => `
      <div class="cache-item">
        <div class="cache-item-header">
          <span>${item.key || 'unknown'}</span>
          <span>TTL: ${item.ttl ? `${item.ttl}s` : 'no expiry'}</span>
        </div>
        <div>
          <span class="cache-hit">Hits: ${item.hits || 0}</span> |
          <span class="cache-miss">Misses: ${item.misses || 0}</span>
        </div>
      </div>
    `).join('');
  } catch (error) {
    console.error('Cache stats error:', error);
  }
}

async function castVote() {
  try {
    const voteUserId = document.getElementById('userId').value || 'user1';
    const voteItemId = document.getElementById('itemId').value;

    if (!voteUserId.trim() || !voteItemId.trim()) {
      showMessage('User ID and Item ID are required', 'error');
      return;
    }

    const response = await fetch(`${API_BASE}/api/vote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: voteUserId,
        itemId: voteItemId,
        voteValue: 1
      })
    });

    const data = await response.json();
    if (!response.ok || !data.success) {
      showMessage(`Vote failed: ${data.error || 'Unknown error'}`, 'error');
      return;
    }

    showMessage(`Vote cast! New score: ${data.item?.score ?? 'N/A'}`, 'success');
    await updateLeaderboard();
    await updateCacheStats();
  } catch (error) {
    console.error('Vote error:', error);
    showMessage(`Error casting vote: ${error.message}`, 'error');
  }
}

async function updateLeaderboard() {
  try {
    const response = await fetch(`${API_BASE}/api/ranking?limit=10`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    if (!data.success) throw new Error(data.error || 'Unknown error');

    const leaderboard = document.getElementById('leaderboard');
    const items = data.items || data.data || [];

    if (items.length === 0) {
      leaderboard.innerHTML = '<div class="empty-state">No items in leaderboard</div>';
      return;
    }

    leaderboard.innerHTML = items.map((item, idx) => `
      <div class="leaderboard-item">
        <div class="rank ${idx < 3 ? 'top3' : ''}">#${idx + 1}</div>
        <div class="item-info">
          <div class="item-title">${item.title || 'Unknown'}</div>
          <div style="font-size: 12px; color: #999;">
            ${item.description || 'No description'}
          </div>
        </div>
        <div class="item-score">${item.score || 0} votes</div>
      </div>
    `).join('');
  } catch (error) {
    console.error('Leaderboard error:', error);
    const leaderboard = document.getElementById('leaderboard');
    leaderboard.innerHTML = '<div class="empty-state" style="color: #f44336;">Failed to load leaderboard</div>';
  }
}

async function startSpamSimulator() {
  if (simulationRunning) {
    showMessage('Simulation already running', 'warning');
    return;
  }

  simulationRunning = true;
  const button = document.getElementById('simButton');
  button.disabled = true;

  const count = parseInt(document.getElementById('requestCount').value, 10) || 200;
  let passed = 0;
  let blocked = 0;
  const start = Date.now();

  try {
    for (let i = 0; i < count; i += 1) {
      try {
        const response = await fetch(`${API_BASE}/api/health`, {
          headers: { 'x-user-id': 'spam_user' }
        });

        if (response.status === 429) {
          blocked += 1;
        } else if (response.ok) {
          passed += 1;
        } else {
          blocked += 1;
        }
      } catch (error) {
        blocked += 1;
      }

      document.getElementById('simPassed').textContent = String(passed);
      document.getElementById('simBlocked').textContent = String(blocked);
      document.getElementById('simProgress').textContent = `${Math.round(((i + 1) / count) * 100)}%`;
      document.getElementById('simTime').textContent = `${((Date.now() - start) / 1000).toFixed(1)}s`;

      if (i % 20 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    showMessage(`Simulation complete: ${passed} passed, ${blocked} blocked`, 'success');
  } catch (error) {
    console.error('Simulation error:', error);
    showMessage(`Simulation error: ${error.message}`, 'error');
  } finally {
    simulationRunning = false;
    button.disabled = false;
  }
}

function updateSystemHealth(healthData) {
  const databases = healthData?.databases || {};
  const postgresStatus = databases.postgres || healthData?.postgres;
  const redisStatus = databases.redis || healthData?.redis;
  const mongoStatus = databases.mongodb || healthData?.mongodb;

  const postgresConnected = postgresStatus === 'connected';
  const redisConnected = redisStatus === 'connected';
  const mongoConnected = mongoStatus === 'connected';

  const dbStatusEl = document.getElementById('dbStatus');
  const redisStatusEl = document.getElementById('redisStatus');
  const mongodbStatusEl = document.getElementById('mongodbStatus');

  if (dbStatusEl) {
    dbStatusEl.className = `metric-value status-badge ${postgresConnected ? 'status-ok' : 'status-error'}`;
    dbStatusEl.textContent = postgresConnected ? 'OK' : 'OFFLINE';
  }

  if (redisStatusEl) {
    redisStatusEl.className = `metric-value status-badge ${redisConnected ? 'status-ok' : 'status-error'}`;
    redisStatusEl.textContent = redisConnected ? 'OK' : 'OFFLINE';
  }

  if (mongodbStatusEl) {
    mongodbStatusEl.className = `metric-value status-badge ${mongoConnected ? 'status-ok' : 'status-error'}`;
    mongodbStatusEl.textContent = mongoConnected ? 'OK' : 'OFFLINE';
  }
}

async function autoRefresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    await updateRateLimitStatus();
    await updateCacheStats();
    await updateLeaderboard();
  } finally {
    refreshing = false;
  }
}

async function initDashboard() {
  if (dashboardInitialized) return;
  if (!AUTH_TOKEN) {
    window.location.href = '/';
    return;
  }

  const validRole = await ensureUserRole();
  if (!validRole) return;

  dashboardInitialized = true;

  const changeUserButton = document.getElementById('changeUserButton');
  const refreshCacheButton = document.getElementById('refreshCacheButton');
  const castVoteButton = document.getElementById('castVoteButton');
  const refreshLeaderboardButton = document.getElementById('refreshLeaderboardButton');
  const simButton = document.getElementById('simButton');
  const logoutButton = document.getElementById('logoutButton');

  changeUserButton?.addEventListener('click', changeUser);
  refreshCacheButton?.addEventListener('click', updateCacheStats);
  castVoteButton?.addEventListener('click', castVote);
  refreshLeaderboardButton?.addEventListener('click', updateLeaderboard);
  simButton?.addEventListener('click', startSpamSimulator);
  logoutButton?.addEventListener('click', logoutUser);

  renderCurrentUser();
  updateTimestamp();
  setInterval(updateTimestamp, 1000);

  try {
    await loadAvailableItems(); // Load items for voting form
    await autoRefresh();
    showMessage(`Welcome! User: ${userId}`, 'success');
  } catch (error) {
    console.error('Initialization error:', error);
    showMessage('Failed to initialize dashboard', 'error');
  }

  healthTimer = setInterval(updateRateLimitStatus, HEALTH_REFRESH_MS);
  dataTimer = setInterval(async () => {
    if (refreshing) return;
    try {
      await updateCacheStats();
      await updateLeaderboard();
    } catch (error) {
      console.error('Data refresh error:', error);
    }
  }, DATA_REFRESH_MS);
}

document.addEventListener('DOMContentLoaded', initDashboard);
