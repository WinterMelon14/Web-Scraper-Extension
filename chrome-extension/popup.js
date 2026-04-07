// Popup script - generic version

const API_URL = 'http://localhost:3000';

const SESSION_STATE = 'session_state';
const SESSION_START = 'session_start';
const CAPTURED_PAGES = 'captured_pages';
const SESSION_STATS = 'session_stats';

let sessionInterval = null;

async function init() {
  await updateUI();
  await updateStats();
  await loadRecentCaptures();

  const state = await getState();
  if (state === 'recording') {
    startDurationTimer();
  }

  document.getElementById('recordBtn').addEventListener('click', toggleRecording);
  document.getElementById('askBtn').addEventListener('click', askClaude);

  document.getElementById('askInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      askClaude();
    }
  });
}

async function getState() {
  const result = await chrome.storage.local.get([SESSION_STATE]);
  return result[SESSION_STATE] || 'idle';
}

async function toggleRecording() {
  const state = await getState();
  if (state === 'idle') {
    await startRecording();
  } else {
    await stopRecording();
  }
}

async function startRecording() {
  // Clear any previous session state first
  stopDurationTimer();

  await chrome.storage.local.set({
    [SESSION_STATE]: 'recording',
    [SESSION_START]: Date.now(),
    [SESSION_STATS]: { captured: 0, domains: [] },
    [CAPTURED_PAGES]: [],
  });

  chrome.runtime.sendMessage({ action: 'startRecording' });
  updateUI();
  updateStats();
  startDurationTimer();
  showToast('Recording started');
}

async function stopRecording() {
  // Clear all session state
  await chrome.storage.local.set({
    [SESSION_STATE]: 'idle',
    [SESSION_START]: null,
    [SESSION_STATS]: { captured: 0, domains: [] },
  });
  chrome.runtime.sendMessage({ action: 'stopRecording' });
  stopDurationTimer();
  updateUI();
  updateStats();
  showToast('Recording stopped');
}

async function updateUI() {
  const state = await getState();
  const btn = document.getElementById('recordBtn');
  const badge = document.getElementById('statusBadge');

  if (state === 'recording') {
    btn.className = 'record-button stop';
    btn.innerHTML = '<span class="record-icon"></span> Stop Recording';
    badge.className = 'status-badge recording';
    badge.textContent = 'Recording';
  } else {
    btn.className = 'record-button start';
    btn.innerHTML = '<span class="record-icon"></span> Start Recording';
    badge.className = 'status-badge idle';
    badge.textContent = 'Idle';
  }
}

async function updateStats() {
  const result = await chrome.storage.local.get([SESSION_STATS, SESSION_START]);
  const stats = result[SESSION_STATS] || { captured: 0, domains: [] };

  document.getElementById('capturedCount').textContent = stats.captured || 0;
  document.getElementById('domainCount').textContent =
    (stats.domains || []).length;

  if (result[SESSION_START]) {
    updateDurationDisplay(result[SESSION_START]);
  }
}

function updateDurationDisplay(startTime) {
  const elapsed = Date.now() - startTime;
  const minutes = Math.floor(elapsed / 60000);
  const seconds = Math.floor((elapsed % 60000) / 1000);
  document.getElementById('sessionDuration').textContent =
    `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function startDurationTimer() {
  stopDurationTimer();
  sessionInterval = setInterval(async () => {
    const result = await chrome.storage.local.get([SESSION_START]);
    if (result[SESSION_START]) {
      updateDurationDisplay(result[SESSION_START]);
    }
  }, 1000);
}

function stopDurationTimer() {
  if (sessionInterval) {
    clearInterval(sessionInterval);
    sessionInterval = null;
  }
  // Reset the display
  document.getElementById('sessionDuration').textContent = '0:00';
  document.getElementById('capturedCount').textContent = '0';
  document.getElementById('domainCount').textContent = '0';
}

async function loadRecentCaptures() {
  const result = await chrome.storage.local.get([CAPTURED_PAGES]);
  const pages = result[CAPTURED_PAGES] || [];

  const container = document.getElementById('captureList');

  if (pages.length === 0) {
    container.innerHTML = '<div class="empty-state">No captures yet</div>';
    return;
  }

  const recent = [...pages].reverse().slice(0, 5);

  container.innerHTML = recent.map(page => {
    const domain = new URL(page.url).hostname.replace(/^www\./, '');
    const timeAgo = formatTimeAgo(page.timestamp);
    const favicon = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;

    return `
      <div class="capture-item">
        <div class="capture-icon">
          <img src="${favicon}" width="16" height="16" onerror="this.style.display='none'">
        </div>
        <div class="capture-info">
          <div class="capture-title" title="${escapeHtml(page.title)}">${escapeHtml(truncate(page.title, 40))}</div>
          <div class="capture-meta">${domain} · ${timeAgo}</div>
        </div>
      </div>
    `;
  }).join('');
}

async function askClaude() {
  const input = document.getElementById('askInput');
  const btn = document.getElementById('askBtn');
  const responseEl = document.getElementById('response');

  const question = input.value.trim();
  if (!question) return;

  btn.disabled = true;
  btn.classList.add('loading');
  btn.textContent = 'Asking Claude...';
  responseEl.textContent = '';
  responseEl.className = 'response';

  try {
    const res = await fetch(`${API_URL}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, limit: 50 }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    responseEl.textContent = data.answer || 'No response';
  } catch (err) {
    responseEl.textContent = `Error: ${err.message}. Make sure the server is running.`;
    responseEl.classList.add('error');
  } finally {
    btn.disabled = false;
    btn.classList.remove('loading');
    btn.textContent = 'Ask Claude';
  }
}

function formatTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function truncate(str, len) {
  return str.length > len ? str.slice(0, len) + '...' : str;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = isError ? 'toast error show' : 'toast show';
  setTimeout(() => {
    toast.className = 'toast';
  }, 2500);
}

chrome.storage.onChanged.addListener((changes) => {
  if (changes[CAPTURED_PAGES]) {
    loadRecentCaptures();
  }
  if (changes[SESSION_STATS]) {
    updateStats();
  }
});

init();
