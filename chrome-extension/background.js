// Background service worker - generic capture system

const API_URL = 'http://localhost:3000';

// State keys
const SESSION_STATE = 'session_state';
const SESSION_START = 'session_start';
const CAPTURED_PAGES = 'captured_pages';
const SESSION_STATS = 'session_stats';
const CURRENT_SESSION = 'current_session_id';

// Generate session ID
function generateSessionId() {
  return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Initialize
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    [SESSION_STATE]: 'idle',
    [CAPTURED_PAGES]: [],
    [SESSION_STATS]: { captured: 0, domains: [] },
  });
});

chrome.runtime.onStartup.addListener(async () => {
  const result = await chrome.storage.local.get([SESSION_STATE]);
  if (result[SESSION_STATE] === 'recording') {
    // Reset to idle on browser restart since we can't resume
    await chrome.storage.local.set({ [SESSION_STATE]: 'idle' });
  }
});

// Message handling
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startRecording') {
    startRecording().then(() => sendResponse({ success: true }));
    return true;
  } else if (request.action === 'stopRecording') {
    stopRecording().then(() => sendResponse({ success: true }));
    return true;
  } else if (request.action === 'capture') {
    handleCapture(request.data, sender.tab)
      .then(result => sendResponse({ success: true, result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

async function startRecording() {
  // Check if already recording
  const state = await getState();
  if (state === 'recording') return;

  const sessionId = generateSessionId();

  await chrome.storage.local.set({
    [SESSION_STATE]: 'recording',
    [SESSION_START]: Date.now(),
    [SESSION_STATS]: { captured: 0, domains: [] },
    [CAPTURED_PAGES]: [],
    [CURRENT_SESSION]: sessionId,
  });

  // Capture current tab
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url && !isSkipUrl(tab.url)) {
      await captureTab(tab);
    }
  } catch (err) {
    console.error('Initial capture failed:', err);
  }
}

async function stopRecording() {
  await chrome.storage.local.set({
    [SESSION_STATE]: 'idle',
    [SESSION_START]: null,
    [CURRENT_SESSION]: null,
  });
}

async function getState() {
  const result = await chrome.storage.local.get([SESSION_STATE]);
  return result[SESSION_STATE] || 'idle';
}

// Tab update listener - checks storage for recording state
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only process when page is complete
  if (changeInfo.status !== 'complete') return;

  // Check recording state from storage (not memory!)
  const state = await getState();
  if (state !== 'recording') return;

  // Skip invalid URLs
  if (!tab.url || isSkipUrl(tab.url)) return;

  // Delay to let page settle
  setTimeout(async () => {
    // Re-check state after delay
    const currentState = await getState();
    if (currentState === 'recording') {
      await captureTab(tab);
    }
  }, 1500);
});

// Also listen for tab activation (switching tabs)
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const state = await getState();
  if (state !== 'recording') return;

  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab?.url && !isSkipUrl(tab.url)) {
      await captureTab(tab);
    }
  } catch (err) {
    console.error('Tab activation capture failed:', err);
  }
});

async function captureTab(tab) {
  try {
    console.log('Capturing tab:', tab.url);

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPageData,
    });

    const data = results[0]?.result;
    if (!data || !data.content) {
      console.log('No content extracted from:', tab.url);
      return;
    }

    const capture = {
      ...data,
      url: tab.url,
      title: tab.title || data.metadata?.title || '',
      timestamp: Date.now(),
    };

    await sendToAPI(capture);
    await addCaptureToStorage(capture);

    console.log('Captured successfully:', tab.url);
  } catch (err) {
    console.error('Capture failed:', err);
  }
}

// Extraction function (runs in content script context)
function extractPageData() {
  const findMainContent = () => {
    const selectors = ['article', 'main', '[role="main"]', '.content', '#content', '.post', '.article'];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.innerText && el.innerText.length > 200) return el;
    }

    // Fallback: find largest content block
    let bestEl = document.body;
    let maxText = 0;
    document.querySelectorAll('div, section, article').forEach(div => {
      const len = div.innerText?.length || 0;
      if (len > maxText && len < 50000 && len > 100) {
        maxText = len;
        bestEl = div;
      }
    });
    return bestEl;
  };

  const getMeta = (name) => {
    const el = document.querySelector(`meta[name="${name}"], meta[property="${name}"], meta[property="og:${name}"]`);
    return el?.getAttribute('content') || '';
  };

  const main = findMainContent();
  const clone = main.cloneNode(true);
  clone.querySelectorAll('script, style, nav, header, footer, aside, noscript').forEach(el => el.remove());

  // Clean up whitespace
  const content = clone.innerText.replace(/\s+/g, ' ').trim().slice(0, 50000);

  return {
    content: content,
    metadata: {
      url: window.location.href,
      domain: window.location.hostname,
      title: document.title,
      description: getMeta('description') || getMeta('og:description'),
      author: getMeta('author'),
      wordCount: content.split(/\s+/).length,
    },
  };
}

function isSkipUrl(url) {
  if (!url) return true;
  const skip = [
    /^chrome:\/\//,
    /^chrome-extension:\/\//,
    /^file:\/\//,
    /^data:/,
    /^about:/,
    /^edge:\/\//,
    /^brave:\/\//,
    /\/newtab/,
    /\/settings/,
    /chrome\.google\.com\/webstore/,
  ];
  return skip.some(p => p.test(url));
}

async function sendToAPI(capture) {
  const result = await chrome.storage.local.get([CURRENT_SESSION]);
  const sessionId = result[CURRENT_SESSION];

  try {
    const res = await fetch(`${API_URL}/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: capture.url,
        title: capture.title,
        content: capture.content,
        metadata: capture.metadata,
        source_type: 'extension',
        timestamp: capture.timestamp,
        session_id: sessionId,
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error('API error:', res.status, errorText);
      throw new Error(`API error: ${res.status}`);
    }

    return res.json();
  } catch (err) {
    console.error('Failed to send to API:', err);
    throw err;
  }
}

async function addCaptureToStorage(capture) {
  const result = await chrome.storage.local.get([CAPTURED_PAGES, SESSION_STATS]);

  const pages = result[CAPTURED_PAGES] || [];
  const stats = result[SESSION_STATS] || { captured: 0, domains: [] };

  pages.push(capture);
  if (pages.length > 100) pages.shift();

  stats.captured = (stats.captured || 0) + 1;
  const domain = new URL(capture.url).hostname;
  const domains = new Set(stats.domains || []);
  domains.add(domain);
  stats.domains = Array.from(domains);

  await chrome.storage.local.set({
    [CAPTURED_PAGES]: pages,
    [SESSION_STATS]: stats,
  });
}

async function handleCapture(data, tab) {
  const capture = {
    ...data,
    url: tab?.url,
    title: tab?.title,
    timestamp: Date.now(),
  };

  await sendToAPI(capture);
  await addCaptureToStorage(capture);

  return { captured: true };
}

// Keep service worker alive
chrome.alarms.create('keepAlive', { periodInMinutes: 4.9 });
chrome.alarms.onAlarm.addListener(() => {
  chrome.storage.local.get(['ping']);
});