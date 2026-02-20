// ── Auth check ──────────────────────────────────────────────
let currentUser = null;

try {
  const res = await fetch('/api/auth/me');
  if (res.ok) {
    currentUser = await res.json();
  } else {
    window.location.href = '/login.html';
  }
} catch {
  window.location.href = '/login.html';
}

const QUESTIONS = [
  'What do you believe to be true right now?',
  'What are you most uncertain about?',
  'What would have to happen for that uncertainty to resolve?',
];

// ── Populate user info ──────────────────────────────────────
document.getElementById('user-email').textContent = currentUser.email;

// ── Sign out ────────────────────────────────────────────────
document.getElementById('signout-btn').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

// ── Tabs ────────────────────────────────────────────────────
const tabBtns = document.querySelectorAll('.tab-btn');
const tabPanels = document.querySelectorAll('.tab-panel');

tabBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    tabBtns.forEach((b) => b.classList.remove('active'));
    tabPanels.forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

// ── Load capsules ───────────────────────────────────────────

async function loadPending() {
  const container = document.getElementById('pending-list');
  try {
    const res = await fetch('/api/capsules/list?status=pending');
    const data = await res.json();
    const capsules = data.capsules || [];

    if (capsules.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <p>No pending capsules</p>
          <a href="/" class="empty-link">Seal new thoughts</a>
        </div>`;
      return;
    }

    container.innerHTML = '';
    for (const c of capsules) {
      container.appendChild(createPendingCard(c));
    }
  } catch {
    container.innerHTML = '<p class="empty-state">Failed to load capsules</p>';
  }
}

async function loadReturned() {
  const container = document.getElementById('returned-list');
  try {
    const res = await fetch('/api/capsules/list?status=delivered');
    const data = await res.json();
    // Also get "returned" status capsules
    const res2 = await fetch('/api/capsules/list?status=returned');
    const data2 = await res2.json();
    const capsules = [...(data.capsules || []), ...(data2.capsules || [])];
    capsules.sort((a, b) => b.createdAt - a.createdAt);

    if (capsules.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>No returned capsules yet</p></div>';
      return;
    }

    container.innerHTML = '';
    for (const c of capsules) {
      container.appendChild(createReturnedCard(c));
    }
  } catch {
    container.innerHTML = '<p class="empty-state">Failed to load capsules</p>';
  }
}

function createPendingCard(capsule) {
  const card = document.createElement('div');
  card.className = 'capsule-card';

  const sealedDate = new Date(capsule.createdAt).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });

  card.innerHTML = `
    <div class="capsule-meta">
      <span class="capsule-interval">${escapeHtml(capsule.interval)}</span>
      <span class="capsule-date">Sealed ${sealedDate}</span>
    </div>
    <div class="capsule-countdown" data-deliver-at="${capsule.deliverAt}"></div>
  `;

  updateCountdown(card.querySelector('.capsule-countdown'));
  return card;
}

function createReturnedCard(capsule) {
  const card = document.createElement('div');
  card.className = 'capsule-card';

  const sealedDate = new Date(capsule.createdAt).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });

  let answersHtml = '';
  if (capsule.answers) {
    answersHtml = capsule.answers.map((a, i) => `
      <div class="capsule-answer-pair">
        <p class="capsule-answer-q">${escapeHtml(QUESTIONS[i] || `Question ${i + 1}`)}</p>
        <p class="capsule-answer-a">\u201c${escapeHtml(a)}\u201d</p>
      </div>
    `).join('');
  }

  let reflectHtml = '';
  if (capsule.returnAnswers && capsule.returnAnswers.length > 0) {
    reflectHtml = `
      <div class="return-answers">
        <p class="return-label">Your reflections</p>
        ${capsule.returnAnswers.map((a) => `<p class="return-answer-text">\u201c${escapeHtml(a)}\u201d</p>`).join('')}
      </div>`;
  } else {
    reflectHtml = `
      <div class="reflect-section">
        <button class="reflect-btn" data-id="${capsule.id}">Reflect</button>
      </div>`;
  }

  card.innerHTML = `
    <div class="capsule-meta">
      <span class="capsule-interval">${escapeHtml(capsule.interval)}</span>
      <span class="capsule-date">Sealed ${sealedDate}</span>
    </div>
    <button class="expand-btn">Show answers</button>
    <div class="capsule-answers">
      ${answersHtml}
      ${reflectHtml}
    </div>
  `;

  // Toggle expand
  const expandBtn = card.querySelector('.expand-btn');
  expandBtn.addEventListener('click', () => {
    const isExpanded = card.classList.toggle('expanded');
    expandBtn.textContent = isExpanded ? 'Hide answers' : 'Show answers';
  });

  // Reflect button handler
  const reflectBtn = card.querySelector('.reflect-btn');
  if (reflectBtn) {
    reflectBtn.addEventListener('click', () => {
      showReflectPrompt(card, capsule.id, reflectBtn.closest('.reflect-section'));
    });
  }

  return card;
}

function showReflectPrompt(card, capsuleId, container) {
  container.innerHTML = `
    <textarea class="reflect-textarea" rows="3" placeholder="What do you think now?"></textarea>
    <button class="reflect-submit" disabled>Seal reflection</button>
  `;

  const textarea = container.querySelector('.reflect-textarea');
  const submitBtn = container.querySelector('.reflect-submit');

  textarea.focus();
  textarea.addEventListener('input', () => {
    submitBtn.disabled = !textarea.value.trim();
  });

  submitBtn.addEventListener('click', async () => {
    const text = textarea.value.trim();
    if (!text) return;

    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving...';

    try {
      const res = await fetch(`/api/capsules/${capsuleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnAnswers: [text] }),
      });

      if (res.ok) {
        container.innerHTML = `
          <div class="return-answers">
            <p class="return-label">Your reflections</p>
            <p class="return-answer-text">\u201c${escapeHtml(text)}\u201d</p>
          </div>`;
      } else {
        submitBtn.textContent = 'Failed — try again';
        submitBtn.disabled = false;
      }
    } catch {
      submitBtn.textContent = 'Failed — try again';
      submitBtn.disabled = false;
    }
  });
}

// ── Countdown timer ─────────────────────────────────────────
function updateCountdown(el) {
  if (!el) return;
  const deliverAt = Number(el.dataset.deliverAt);
  const now = Date.now();
  const remaining = deliverAt - now;

  if (remaining <= 0) {
    el.textContent = 'Due now';
    return;
  }

  const days = Math.floor(remaining / 86400000);
  const hours = Math.floor((remaining % 86400000) / 3600000);
  const minutes = Math.floor((remaining % 3600000) / 60000);

  if (days > 0) {
    el.textContent = `Returns in ${days}d ${hours}h`;
  } else if (hours > 0) {
    el.textContent = `Returns in ${hours}h ${minutes}m`;
  } else {
    el.textContent = `Returns in ${minutes}m`;
  }
}

// Update countdowns every minute
setInterval(() => {
  document.querySelectorAll('.capsule-countdown').forEach(updateCountdown);
}, 60000);

// ── Settings ────────────────────────────────────────────────

const toggleEmail = document.getElementById('toggle-email');
const toggleSms = document.getElementById('toggle-sms');
const togglePush = document.getElementById('toggle-push');
const phoneRow = document.getElementById('phone-row');
const phoneInput = document.getElementById('phone-input');
const saveBtn = document.getElementById('save-btn');
const saveStatus = document.getElementById('save-status');

// Populate settings from user data
toggleEmail.checked = currentUser.notifyEmail;
toggleSms.checked = currentUser.notifySms;
togglePush.checked = currentUser.notifyPush;
phoneInput.value = currentUser.phone || '';
if (currentUser.notifySms) phoneRow.classList.add('visible');

toggleSms.addEventListener('change', () => {
  phoneRow.classList.toggle('visible', toggleSms.checked);
});

togglePush.addEventListener('change', async () => {
  if (togglePush.checked) {
    // Trigger push permission and subscription flow
    try {
      const granted = await requestPushPermission();
      if (!granted) {
        togglePush.checked = false;
      }
    } catch {
      togglePush.checked = false;
    }
  }
});

async function requestPushPermission() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    alert('Push notifications are not supported in this browser.');
    return false;
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;

  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;

  // Get VAPID public key
  const vapidRes = await fetch('/api/push/vapid-key');
  const { key } = await vapidRes.json();

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(key),
  });

  // Send subscription to server
  await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sub.toJSON()),
  });

  return true;
}

saveBtn.addEventListener('click', async () => {
  saveBtn.disabled = true;
  saveStatus.textContent = '';

  try {
    const res = await fetch('/api/user/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notifyEmail: toggleEmail.checked,
        notifySms: toggleSms.checked,
        notifyPush: togglePush.checked,
        phone: phoneInput.value.trim(),
      }),
    });

    if (res.ok) {
      saveStatus.textContent = 'Saved';
      saveStatus.className = 'save-status success';
      // Update local user object
      currentUser.notifyEmail = toggleEmail.checked;
      currentUser.notifySms = toggleSms.checked;
      currentUser.notifyPush = togglePush.checked;
      currentUser.phone = phoneInput.value.trim();
    } else {
      saveStatus.textContent = 'Failed to save';
      saveStatus.className = 'save-status error';
    }
  } catch {
    saveStatus.textContent = 'Network error';
    saveStatus.className = 'save-status error';
  }

  saveBtn.disabled = false;
});

// ── Utility ─────────────────────────────────────────────────

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

// ── Initial load ────────────────────────────────────────────
loadPending();
loadReturned();
