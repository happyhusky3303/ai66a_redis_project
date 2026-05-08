'use strict';

const API_BASE = window.location.origin;

function showMessage(text, type = 'error') {
  const message = document.getElementById('message');
  message.textContent = text;
  message.className = `message show ${type}`;
}

async function getProfile(token) {
  const response = await fetch(`${API_BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!response.ok) {
    throw new Error('Failed to load profile');
  }

  const data = await response.json();
  if (!data.success || !data.user) {
    throw new Error('Invalid profile');
  }

  return data.user;
}

async function handleSubmit(event) {
  event.preventDefault();

  const identifier = document.getElementById('identifier').value.trim();
  const password = document.getElementById('password').value;

  try {
    const response = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier, password })
    });

    const data = await response.json();
    if (!response.ok || !data.success) {
      showMessage(data.error || 'Đăng nhập thất bại', 'error');
      return;
    }

    const token = data.token;
    const profile = await getProfile(token);
    if (profile.role !== 'admin') {
      showMessage('Tài khoản không có quyền admin', 'error');
      return;
    }

    localStorage.setItem('adminAuthToken', token);
    localStorage.setItem('adminUser', JSON.stringify(profile));
    showMessage('Đăng nhập thành công, đang chuyển trang...', 'success');
    setTimeout(() => {
      window.location.href = '/admin/panel';
    }, 300);
  } catch (error) {
    showMessage(error.message || 'Lỗi đăng nhập', 'error');
  }
}

async function autoRedirectIfLoggedIn() {
  const token = localStorage.getItem('adminAuthToken');
  if (!token) return;

  try {
    const profile = await getProfile(token);
    if (profile.role === 'admin') {
      window.location.href = '/admin/panel';
    }
  } catch (error) {
    localStorage.removeItem('adminAuthToken');
    localStorage.removeItem('adminUser');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  autoRedirectIfLoggedIn();
  document.getElementById('adminLoginForm').addEventListener('submit', handleSubmit);
});
