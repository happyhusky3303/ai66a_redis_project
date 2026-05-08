'use strict';

    // =========================================================================
    // Global state
    // =========================================================================
    const ADMIN_AUTH_TOKEN = localStorage.getItem('adminAuthToken') || '';
    let adminUser = null;
    let currentSection = 'dashboard';

    function logoutAdmin() {
      localStorage.removeItem('adminAuthToken');
      localStorage.removeItem('adminUser');
      window.location.href = '/admin';
    }

    async function loadAdminProfile() {
      if (!ADMIN_AUTH_TOKEN) {
        logoutAdmin();
        return;
      }

      const response = await fetch('/auth/me', {
        headers: { Authorization: `Bearer ${ADMIN_AUTH_TOKEN}` }
      });

      if (!response.ok) {
        logoutAdmin();
        return;
      }

      const data = await response.json();
      if (!data.success || !data.user || data.user.role !== 'admin') {
        logoutAdmin();
        return;
      }

      adminUser = data.user;
      const identity = document.getElementById('adminIdentity');
      if (identity) {
        identity.textContent = `${adminUser.fullName || adminUser.username} (admin)`;
      }
    }

    // Helper: Make admin API call
    async function adminFetch(endpoint, options = {}) {
      const response = await fetch(`/admin/api${endpoint}`, {
        ...options,
        headers: {
          Authorization: `Bearer ${ADMIN_AUTH_TOKEN}`,
          'content-type': 'application/json',
          ...options.headers
        }
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || `API error: ${response.status}`);
      }

      return response.json();
    }

    // =========================================================================
    // Navigation & Section Management
    // =========================================================================
    function showSection(sectionId) {
      // Hide all sections
      document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
      document.querySelectorAll('.menu-link').forEach(l => l.classList.remove('active'));

      // Show selected section
      document.getElementById(sectionId).classList.add('active');

      // Highlight menu link
      const menuLink = document.querySelector(`.menu-link[data-section="${sectionId}"]`);
      if (menuLink) menuLink.classList.add('active');

      currentSection = sectionId;

      // Update title
      const titles = {
        'dashboard': '📊 Dashboard',
        'ratelimits': '⚡ Rate Limits',
        'cache': '💾 Cache',
        'users': '👥 Users',
        'items': '📦 Items',
        'logs': '📝 Logs',
        'system': '🖥️ System'
      };
      document.getElementById('sectionTitle').textContent = titles[sectionId] || sectionId;

      // Load data
      loadSectionData(sectionId);
    }

    // Load section data
    async function loadSectionData(sectionId) {
      try {
        switch (sectionId) {
          case 'dashboard':
            await loadDashboard();
            break;
          case 'ratelimits':
            await loadRateLimits();
            break;
          case 'cache':
            await loadCacheData();
            break;
          case 'users':
            await loadUsers();
            break;
          case 'items':
            await loadItems();
            break;
          case 'logs':
            await loadLogs();
            break;
          case 'system':
            await loadSystemInfo();
            break;
        }
      } catch (error) {
        console.error(`Error loading ${sectionId}:`, error);
        alert(`Failed to load ${sectionId}: ${error.message}`);
      }
    }

    // =========================================================================
    // Dashboard
    // =========================================================================
    async function loadDashboard() {
      try {
        const [stats, cacheStats, logs] = await Promise.all([
          adminFetch('/system/stats'),
          adminFetch('/cache/stats'),
          adminFetch('/logs?limit=5')
        ]);

        // Display summary cards
        const summary = `
          <div class="stat-card">
            <div class="stat-card-value">${stats.system.database.users}</div>
            <div class="stat-card-label">Total Users</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-value">${stats.system.database.votes}</div>
            <div class="stat-card-label">Total Votes</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-value">${stats.system.database.items}</div>
            <div class="stat-card-label">Total Items</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-value">${cacheStats.summary.hitRate}</div>
            <div class="stat-card-label">Cache Hit Rate</div>
          </div>
        `;
        document.getElementById('dashboardStats').innerHTML = summary;

        // Database stats
        document.getElementById('dbStats').innerHTML = `
          <div class="metric">
            <span>Users</span>
            <span class="metric-value">${stats.system.database.users}</span>
          </div>
          <div class="metric">
            <span>Votes</span>
            <span class="metric-value">${stats.system.database.votes}</span>
          </div>
          <div class="metric">
            <span>Items</span>
            <span class="metric-value">${stats.system.database.items}</span>
          </div>
        `;

        // Redis stats
        document.getElementById('redisStats').innerHTML = `
          <div class="metric">
            <span>Version</span>
            <span class="metric-value">${stats.system.redis.version}</span>
          </div>
          <div class="metric">
            <span>Memory</span>
            <span class="metric-value">${stats.system.redis.usedMemory}</span>
          </div>
          <div class="metric">
            <span>Cache Keys</span>
            <span class="metric-value">${cacheStats.summary.totalKeys}</span>
          </div>
        `;

        // Recent activity
        const logsHtml = (logs.logs || []).map(log => `
          <tr>
            <td>${log.endpoint}</td>
            <td><span class="status-badge">${log.method}</span></td>
            <td><span class="status-badge ${log.status_code < 400 ? 'status-ok' : 'status-error'}">${log.status_code}</span></td>
            <td>${log.response_time_ms || '--'}ms</td>
          </tr>
        `).join('');
        document.querySelector('#recentActivity tbody').innerHTML = logsHtml || 
          '<tr><td colspan="4" style="text-align: center; color: #999;">No activity</td></tr>';
      } catch (error) {
        console.error('Dashboard error:', error);
      }
    }

    // =========================================================================
    // Rate Limits
    // =========================================================================
    async function loadRateLimits() {
      try {
        const data = await adminFetch('/rate-limits');
        const html = (data.rateLimits || []).map(rl => `
          <tr>
            <td>${rl.userId}</td>
            <td>${rl.activeRequests}</td>
            <td>${rl.allowed}</td>
            <td><span class="status-badge status-warning">${rl.blocked}</span></td>
            <td>${rl.ttl}</td>
            <td>
              <button class="button danger" data-action="reset-rate-limit" data-user-id="${encodeURIComponent(rl.userId)}" 
                style="padding: 5px 10px; font-size: 12px;">Reset</button>
            </td>
          </tr>
        `).join('');
        document.querySelector('#rateLimitsTable tbody').innerHTML = html ||
          '<tr><td colspan="6" style="text-align: center; color: #999;">No active rate limits</td></tr>';
      } catch (error) {
        console.error('Rate limits error:', error);
      }
    }

    // =========================================================================
    // Cache Management
    // =========================================================================
    async function loadCacheData() {
      try {
        const data = await adminFetch('/cache/stats');
        const summary = data.summary || {};

        document.getElementById('cacheSummary').innerHTML = `
          <div class="metric">
            <span>Cache Keys</span>
            <span class="metric-value">${summary.totalKeys || 0}</span>
          </div>
          <div class="metric">
            <span>Hit Rate</span>
            <span class="metric-value">${summary.hitRate || '0%'}</span>
          </div>
          <div class="metric">
            <span>Total Hits</span>
            <span class="metric-value">${summary.totalHits || 0}</span>
          </div>
          <div class="metric">
            <span>Total Misses</span>
            <span class="metric-value">${summary.totalMisses || 0}</span>
          </div>
        `;

        const html = (data.cacheStats || []).map(stat => `
          <tr>
            <td>${stat.key}</td>
            <td>${stat.hits || 0}</td>
            <td>${stat.misses || 0}</td>
            <td>${stat.ttl || 'N/A'}</td>
            <td>
              <button class="button danger" data-action="delete-cache" data-cache-key="${encodeURIComponent(stat.key)}" 
                style="padding: 5px 10px; font-size: 12px;">Delete</button>
            </td>
          </tr>
        `).join('');
        document.querySelector('#cacheKeysTable tbody').innerHTML = html ||
          '<tr><td colspan="5" style="text-align: center; color: #999;">No cache keys</td></tr>';
      } catch (error) {
        console.error('Cache error:', error);
      }
    }

    // =========================================================================
    // Users Management
    // =========================================================================
    async function loadUsers() {
      try {
        const data = await adminFetch('/users?limit=50');
        const html = (data.users || []).map(user => `
          <tr>
            <td>${user.username}</td>
            <td>${user.email}</td>
            <td>0</td>
            <td>${new Date(user.created_at).toLocaleDateString()}</td>
            <td></td>
          </tr>
        `).join('');
        document.querySelector('#usersTable tbody').innerHTML = html ||
          '<tr><td colspan="5" style="text-align: center; color: #999;">No users</td></tr>';
      } catch (error) {
        console.error('Users error:', error);
      }
    }

    // =========================================================================
    // Items Management
    // =========================================================================
    async function loadItems() {
      try {
        const data = await adminFetch('/items');
        const html = (data.items || []).map(item => `
          <tr>
            <td>${item.title}</td>
            <td>${item.description || '-'}</td>
            <td><strong>${item.score || 0}</strong></td>
            <td>${item.rank || '-'}</td>
            <td>${new Date(item.created_at).toLocaleDateString()}</td>
          </tr>
        `).join('');
        document.querySelector('#itemsTable tbody').innerHTML = html ||
          '<tr><td colspan="5" style="text-align: center; color: #999;">No items</td></tr>';
      } catch (error) {
        console.error('Items error:', error);
      }
    }

    // =========================================================================
    // API Logs
    // =========================================================================
    async function loadLogs() {
      try {
        const data = await adminFetch('/logs?limit=100');
        const html = (data.logs || []).map(log => `
          <tr>
            <td>${log.endpoint}</td>
            <td>${log.method}</td>
            <td><span class="status-badge ${log.status_code < 400 ? 'status-ok' : 'status-error'}">${log.status_code}</span></td>
            <td>${log.response_time_ms || '--'}ms</td>
            <td>${log.rate_limited ? '✓ Yes' : 'No'}</td>
            <td>${new Date(log.created_at).toLocaleString()}</td>
          </tr>
        `).join('');
        document.querySelector('#logsTable tbody').innerHTML = html ||
          '<tr><td colspan="6" style="text-align: center; color: #999;">No logs</td></tr>';
      } catch (error) {
        console.error('Logs error:', error);
      }
    }

    // =========================================================================
    // System Information
    // =========================================================================
    async function loadSystemInfo() {
      try {
        const stats = await adminFetch('/system/stats');

        document.getElementById('systemHealth').innerHTML = `
          <div class="metric">
            <span>Redis Version</span>
            <span class="metric-value">${stats.system.redis.version}</span>
          </div>
          <div class="metric">
            <span>Redis Memory</span>
            <span class="metric-value">${stats.system.redis.usedMemory}</span>
          </div>
        `;

        document.getElementById('serverInfo').innerHTML = `
          <div class="metric">
            <span>Total Users</span>
            <span class="metric-value">${stats.system.database.users}</span>
          </div>
          <div class="metric">
            <span>Total Votes</span>
            <span class="metric-value">${stats.system.database.votes}</span>
          </div>
          <div class="metric">
            <span>Total Items</span>
            <span class="metric-value">${stats.system.database.items}</span>
          </div>
        `;
      } catch (error) {
        console.error('System info error:', error);
      }
    }

    // =========================================================================
    // Action Handlers
    // =========================================================================
    async function resetRateLimit(userId) {
      if (confirm(`Reset rate limit for ${userId}?`)) {
        try {
          // TODO: Add API endpoint for resetting rate limit
          alert('Rate limit reset (endpoint needed)');
          await loadRateLimits();
        } catch (error) {
          alert('Error: ' + error.message);
        }
      }
    }

    async function deleteCache(key) {
      if (confirm(`Delete cache key: ${key}?`)) {
        try {
          await adminFetch(`/cache/key/${encodeURIComponent(key)}`, { method: 'DELETE' });
          alert('Cache key deleted');
          await loadCacheData();
        } catch (error) {
          alert('Error: ' + error.message);
        }
      }
    }

    async function clearAllCache() {
      if (confirm('Clear ALL cache? This cannot be undone.')) {
        try {
          await adminFetch('/cache/clear', { method: 'POST' });
          alert('All cache cleared');
          await loadCacheData();
        } catch (error) {
          alert('Error: ' + error.message);
        }
      }
    }

    // =========================================================================
    // Modal Management
    // =========================================================================
    function openUserModal() {
      document.getElementById('userModal').classList.add('show');
    }

    function openItemModal() {
      document.getElementById('itemModal').classList.add('show');
    }

    function closeModal(id) {
      document.getElementById(id).classList.remove('show');
    }

    async function saveUser(event) {
      event.preventDefault();
      const username = document.getElementById('userUsername').value;
      const email = document.getElementById('userEmail').value;

      try {
        // TODO: Add API endpoint for creating user
        alert('User creation endpoint needed');
        closeModal('userModal');
        document.getElementById('userUsername').value = '';
        document.getElementById('userEmail').value = '';
        await loadUsers();
      } catch (error) {
        alert('Error: ' + error.message);
      }
    }

    async function saveItem(event) {
      event.preventDefault();
      const title = document.getElementById('itemTitle').value;
      const description = document.getElementById('itemDescription').value;

      try {
        await adminFetch('/item', {
          method: 'POST',
          body: JSON.stringify({ title, description })
        });
        alert('Item created successfully');
        closeModal('itemModal');
        document.getElementById('itemTitle').value = '';
        document.getElementById('itemDescription').value = '';
        await loadItems();
      } catch (error) {
        alert('Error: ' + error.message);
      }
    }

    // =========================================================================
    // Utility Functions
    // =========================================================================
    async function refreshCurrentSection() {
      await loadSectionData(currentSection);
    }

    function filterRateLimits() {
      const search = document.getElementById('rateLimitSearch').value.toLowerCase();
      document.querySelectorAll('#rateLimitsTable tbody tr').forEach(row => {
        row.style.display = row.textContent.toLowerCase().includes(search) ? '' : 'none';
      });
    }

    function filterUsers() {
      const search = document.getElementById('usersSearch').value.toLowerCase();
      document.querySelectorAll('#usersTable tbody tr').forEach(row => {
        row.style.display = row.textContent.toLowerCase().includes(search) ? '' : 'none';
      });
    }

    function setupEventListeners() {
      document.querySelectorAll('.menu-link').forEach((link) => {
        link.addEventListener('click', (event) => {
          event.preventDefault();
          const sectionId = link.dataset.section;
          if (sectionId) {
            showSection(sectionId);
          }
        });
      });

      document.getElementById('refreshSectionButton')?.addEventListener('click', (event) => {
        event.preventDefault();
        refreshCurrentSection();
      });

      document.getElementById('adminLogoutButton')?.addEventListener('click', (event) => {
        event.preventDefault();
        logoutAdmin();
      });

      document.getElementById('clearAllCacheButton')?.addEventListener('click', (event) => {
        event.preventDefault();
        clearAllCache();
      });

      document.getElementById('openUserModalButton')?.addEventListener('click', (event) => {
        event.preventDefault();
        openUserModal();
      });

      document.getElementById('openItemModalButton')?.addEventListener('click', (event) => {
        event.preventDefault();
        openItemModal();
      });

      document.getElementById('rateLimitSearch')?.addEventListener('input', filterRateLimits);
      document.getElementById('usersSearch')?.addEventListener('input', filterUsers);

      document.querySelectorAll('[data-close-modal]').forEach((button) => {
        button.addEventListener('click', () => {
          closeModal(button.dataset.closeModal);
        });
      });

      document.getElementById('userForm')?.addEventListener('submit', saveUser);
      document.getElementById('itemForm')?.addEventListener('submit', saveItem);

      document.addEventListener('click', (event) => {
        const resetButton = event.target.closest('[data-action="reset-rate-limit"]');
        if (resetButton) {
          const userId = decodeURIComponent(resetButton.dataset.userId || '');
          if (userId) {
            resetRateLimit(userId);
          }
          return;
        }

        const deleteButton = event.target.closest('[data-action="delete-cache"]');
        if (deleteButton) {
          const key = decodeURIComponent(deleteButton.dataset.cacheKey || '');
          if (key) {
            deleteCache(key);
          }
        }
      });
    }

    // =========================================================================
    // Initialize Dashboard
    // =========================================================================
    console.log('🚀 Admin Panel Initialized');
    document.addEventListener('DOMContentLoaded', async function() {
      await loadAdminProfile();
      setupEventListeners();
      showSection('dashboard');
    });
