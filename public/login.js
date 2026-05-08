'use strict';

const API_BASE = window.location.origin;

function showMessage(text, type = 'error') {
  const el = document.getElementById('message');
  el.textContent = text;
  el.className = `message show ${type}`;
}

function switchTab(mode) {
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const loginTab = document.getElementById('loginTab');
  const registerTab = document.getElementById('registerTab');

  if (mode === 'register') {
    registerForm.classList.add('active');
    loginForm.classList.remove('active');
    registerTab.classList.add('active');
    loginTab.classList.remove('active');
  } else {
    loginForm.classList.add('active');
    registerForm.classList.remove('active');
    loginTab.classList.add('active');
    registerTab.classList.remove('active');
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const identifier = document.getElementById('loginIdentifier').value.trim();
  const password = document.getElementById('loginPassword').value;

  try {
    const response = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier, password })
    });
    const data = await response.json();

    if (!response.ok || !data.success) {
      showMessage(data.error || 'Login failed', 'error');
      return;
    }

    localStorage.setItem('authToken', data.token);
    localStorage.setItem('authUser', JSON.stringify(data.user));
    localStorage.setItem('userId', data.user.username);

    showMessage('Login successful. Redirecting...', 'success');
    setTimeout(() => {
      window.location.href = '/dashboard';
    }, 400);
  } catch (error) {
    showMessage(error.message || 'Login request failed', 'error');
  }
}

async function handleRegister(event) {
  event.preventDefault();
  const fullName = document.getElementById('registerFullName').value.trim();
  const username = document.getElementById('registerUsername').value.trim();
  const email = document.getElementById('registerEmail').value.trim();
  const password = document.getElementById('registerPassword').value;

  try {
    const response = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fullName, username, email, password })
    });
    const data = await response.json();

    if (!response.ok || !data.success) {
      showMessage(data.error || 'Register failed', 'error');
      return;
    }

    localStorage.setItem('authToken', data.token);
    localStorage.setItem('authUser', JSON.stringify(data.user));
    localStorage.setItem('userId', data.user.username);

    showMessage('Account created. Redirecting...', 'success');
    setTimeout(() => {
      window.location.href = '/dashboard';
    }, 400);
  } catch (error) {
    showMessage(error.message || 'Register request failed', 'error');
  }
}

async function checkAlreadyLoggedIn() {
  const token = localStorage.getItem('authToken');
  if (!token) return;

  try {
    const response = await fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (response.ok) {
      window.location.href = '/dashboard';
    }
  } catch (error) {
    localStorage.removeItem('authToken');
    localStorage.removeItem('authUser');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  checkAlreadyLoggedIn();
  document.getElementById('loginTab').addEventListener('click', () => switchTab('login'));
  document.getElementById('registerTab').addEventListener('click', () => switchTab('register'));
  document.getElementById('loginForm').addEventListener('submit', handleLogin);
  document.getElementById('registerForm').addEventListener('submit', handleRegister);
});
