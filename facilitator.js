// ── Facilitator Dashboard ────────────────────────────────────────

const STORAGE_KEY = 'timecap_facilitator';

// Persist session across page refreshes
function getStoredFacilitator() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  } catch { return null; }
}

function storeFacilitator(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function clearFacilitator() {
  localStorage.removeItem(STORAGE_KEY);
}

// ── State management ─────────────────────────────────────────────

let state = {
  code: null,
  facilitatorToken: null,
  revealed: false,
  pollInterval: null,
};

function showState(id) {
  document.querySelectorAll('.f-state').forEach((el) => el.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

// ── Create room ──────────────────────────────────────────────────

const btnCreate = document.getElementById('btn-create');
const createError = document.getElementById('create-error');

// Restore existing session on load
const stored = getStoredFacilitator();
if (stored && stored.code && stored.facilitatorToken) {
  state.code = stored.code;
  state.facilitatorToken = stored.facilitatorToken;
  enterWaitingState();
}

btnCreate.addEventListener('click', async () => {
  btnCreate.disabled = true;
  btnCreate.textContent = 'Creating...';
  createError.classList.add('hidden');

  try {
    const res = await fetch('/api/sessions', { method: 'POST' });
    if (!res.ok) throw new Error('Failed to create session');
    const data = await res.json();

    state.code = data.code;
    state.facilitatorToken = data.facilitatorToken;
    storeFacilitator({ code: data.code, facilitatorToken: data.facilitatorToken });
    enterWaitingState();
  } catch {
    createError.textContent = 'Failed to create room. Please try again.';
    createError.classList.remove('hidden');
    btnCreate.disabled = false;
    btnCreate.textContent = 'Create a room';
  }
});

// ── Waiting state ────────────────────────────────────────────────

function enterWaitingState() {
  showState('state-waiting');
  document.getElementById('room-code-display').textContent = state.code;
  startPolling();
}

const btnReveal = document.getElementById('btn-reveal');
const revealError = document.getElementById('reveal-error');
const sealedCountEl = document.getElementById('sealed-count');

btnReveal.addEventListener('click', async () => {
  if (btnReveal.disabled) return;
  btnReveal.disabled = true;
  btnReveal.textContent = 'Revealing...';
  revealError.classList.add('hidden');

  try {
    const res = await fetch('/api/reveal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: state.code, facilitatorToken: state.facilitatorToken }),
    });
    if (!res.ok) throw new Error('Reveal failed');
    stopPolling();
    enterRevealedState();
  } catch {
    revealError.textContent = 'Failed to trigger reveal. Please try again.';
    revealError.classList.remove('hidden');
    btnReveal.disabled = false;
    btnReveal.textContent = 'Reveal';
  }
});

// Copy join link
const btnCopyLink = document.getElementById('btn-copy-link');
const copyConfirm = document.getElementById('copy-confirm');

btnCopyLink.addEventListener('click', () => {
  const url = `${location.origin}/?join=${state.code}`;
  navigator.clipboard.writeText(url).then(() => {
    copyConfirm.classList.remove('hidden');
    setTimeout(() => copyConfirm.classList.add('hidden'), 2000);
  }).catch(() => {
    // Fallback: show the URL in a prompt
    window.prompt('Share this link:', `${location.origin}/?join=${state.code}`);
  });
});

// ── Polling ──────────────────────────────────────────────────────

function startPolling() {
  if (state.pollInterval) return;
  poll(); // Immediate first poll
  state.pollInterval = setInterval(poll, 3000);
}

function stopPolling() {
  if (state.pollInterval) {
    clearInterval(state.pollInterval);
    state.pollInterval = null;
  }
}

async function poll() {
  try {
    const res = await fetch(`/api/session-status?code=${encodeURIComponent(state.code)}`);
    if (!res.ok) return;
    const data = await res.json();

    const count = data.sealedCount || 0;
    sealedCountEl.textContent = count === 0
      ? 'Waiting for participants...'
      : count === 1
      ? '1 participant has sealed their response'
      : `${count} participants have sealed their responses`;

    btnReveal.disabled = count === 0;

    if (data.status === 'revealed' && !state.revealed) {
      stopPolling();
      enterRevealedState();
    }
  } catch {
    // Ignore polling errors
  }
}

// ── Revealed state ───────────────────────────────────────────────

async function enterRevealedState() {
  state.revealed = true;
  showState('state-revealed');

  try {
    const res = await fetch(
      `/api/themes?code=${encodeURIComponent(state.code)}&token=${encodeURIComponent(state.facilitatorToken)}`
    );
    if (!res.ok) throw new Error('Failed to load themes');
    const data = await res.json();
    renderThemes(data);
  } catch {
    document.getElementById('themes-loading').textContent = 'Could not load themes. Please refresh.';
  }
}

function renderThemes(data) {
  document.getElementById('themes-loading').classList.add('hidden');
  document.getElementById('themes-content').classList.remove('hidden');

  // Response count
  document.getElementById('f-response-count').textContent =
    `${data.count} ${data.count === 1 ? 'response' : 'responses'}`;

  // Sentiment bar
  const { positive, neutral, negative } = data.sentiment;
  document.getElementById('sent-positive').style.width = `${positive}%`;
  document.getElementById('sent-neutral').style.width = `${neutral}%`;
  document.getElementById('sent-negative').style.width = `${negative}%`;
  document.getElementById('sent-positive-label').textContent = `${positive}% open`;
  document.getElementById('sent-neutral-label').textContent = `${neutral}% uncertain`;
  document.getElementById('sent-negative-label').textContent = `${negative}% resistant`;

  // Theme keywords
  renderKeywords('theme-q1', data.themes.q1);
  renderKeywords('theme-q2', data.themes.q2);
  renderKeywords('theme-q3', data.themes.q3);

  // Individual responses
  renderIndividualResponses(data.responses || []);
}

function renderKeywords(containerId, keywords) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  if (!keywords || keywords.length === 0) {
    container.innerHTML = '<span class="theme-keyword muted">No data yet</span>';
    return;
  }
  keywords.forEach((word, i) => {
    const span = document.createElement('span');
    span.className = 'theme-keyword';
    span.textContent = word;
    span.style.animationDelay = `${i * 120}ms`;
    container.appendChild(span);
  });
}

function renderIndividualResponses(responses) {
  const container = document.getElementById('individual-responses');
  const QUESTIONS = [
    'What do you believe to be true right now?',
    'What are you most uncertain about?',
    'What would have to happen for that uncertainty to resolve?',
  ];

  if (responses.length === 0) {
    container.innerHTML = '<p class="f-no-responses">No responses to display.</p>';
    return;
  }

  container.innerHTML = responses.map((r) => `
    <div class="individual-response">
      <p class="individual-name">${escapeHtml(r.name || 'Anonymous')}</p>
      ${r.answers.map((a, i) => `
        <div class="individual-qa">
          <p class="individual-q">${escapeHtml(QUESTIONS[i])}</p>
          <p class="individual-a">&ldquo;${escapeHtml(a)}&rdquo;</p>
        </div>
      `).join('')}
    </div>
  `).join('');
}

// ── Individual responses toggle ───────────────────────────────────

const btnToggle = document.getElementById('btn-toggle-responses');
const responsesContainer = document.getElementById('individual-responses');
let responsesVisible = false;

btnToggle.addEventListener('click', () => {
  responsesVisible = !responsesVisible;
  responsesContainer.classList.toggle('hidden', !responsesVisible);
  btnToggle.textContent = responsesVisible ? 'Hide individual responses' : 'View individual responses';
});

// ── Utilities ────────────────────────────────────────────────────

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ── Deep-link: ?join=CODE pre-fills the join flow ────────────────
// (facilitator.html doesn't use this, but keeping hook here for future)
