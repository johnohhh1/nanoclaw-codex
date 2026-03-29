const authToken = localStorage.getItem('nanoclaw_auth_token') || '';
const connectionEl = document.getElementById('ops-connection');
const runsCountEl = document.getElementById('runs-count');
const timelineTraceEl = document.getElementById('timeline-trace');
const runsListEl = document.getElementById('runs-list');
const timelineListEl = document.getElementById('timeline-list');
const runDetailsEl = document.getElementById('run-details');
const statActiveEl = document.getElementById('stat-active');
const statRecentEl = document.getElementById('stat-recent');
const statErrorsEl = document.getElementById('stat-errors');
const statAssistantEl = document.getElementById('stat-assistant');
const spotlightTitleEl = document.getElementById('spotlight-title');
const spotlightSummaryEl = document.getElementById('spotlight-summary');
const spotlightTraceEl = document.getElementById('spotlight-trace');
const spotlightContainerEl = document.getElementById('spotlight-container');
const spotlightSessionEl = document.getElementById('spotlight-session');
const runsSearchEl = document.getElementById('runs-search');
const traceConsoleEl = document.getElementById('trace-console');
const payloadConsoleEl = document.getElementById('payload-console');
const consoleCountEl = document.getElementById('console-count');
const filesCountEl = document.getElementById('files-count');
const filesListEl = document.getElementById('files-list');
const artifactsCountEl = document.getElementById('artifacts-count');
const artifactsListEl = document.getElementById('artifacts-list');
const diffCountEl = document.getElementById('diff-count');
const diffConsoleEl = document.getElementById('diff-console');
const refreshBtn = document.getElementById('ops-refresh');
const consolePrettyBtn = document.getElementById('console-pretty');
const consoleRawBtn = document.getElementById('console-raw');

let runtimeState = { active: [], recent: [] };
let selectedTraceId = null;
let selectedFilter = 'all';
let selectedTraceLines = [];
let consoleMode = 'pretty';
let ws = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function getAllRuns() {
  return [...runtimeState.active, ...runtimeState.recent];
}

function getFilteredRuns() {
  const query = runsSearchEl?.value?.trim().toLowerCase() || '';
  return getAllRuns().filter((run) => {
    if (selectedFilter === 'active' && run.status !== 'running') return false;
    if (selectedFilter === 'errors' && run.status !== 'error') return false;
    if (!query) return true;
    const haystack = [
      run.trace_id,
      run.group_folder,
      run.chat_jid,
      run.channel,
      run.status,
      run.phase,
      run.last_event_summary,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(query);
  });
}

function pickSelectedRun() {
  const runs = getAllRuns();
  if (!runs.length) return null;
  const existing = runs.find((run) => run.trace_id === selectedTraceId);
  if (existing) return existing;
  selectedTraceId = runs[0].trace_id;
  return runs[0];
}

function setConnectionState(text, live = false) {
  connectionEl.textContent = text;
  connectionEl.classList.toggle('live', live);
  connectionEl.classList.toggle('muted', !live);
}

function renderStats() {
  const allRuns = getAllRuns();
  statActiveEl.textContent = String(runtimeState.active.length);
  statRecentEl.textContent = String(runtimeState.recent.length);
  statErrorsEl.textContent = String(allRuns.filter((run) => run.status === 'error').length);
  statAssistantEl.textContent =
    allRuns[0]?.assistant_name || runtimeState.active[0]?.assistant_name || 'Pepper';
}

function renderSpotlight(run) {
  if (!run) {
    spotlightTitleEl.textContent = 'No run selected';
    spotlightSummaryEl.textContent = 'Pick a run to inspect its current state.';
    spotlightTraceEl.textContent = '-';
    spotlightContainerEl.textContent = '-';
    spotlightSessionEl.textContent = '-';
    return;
  }

  spotlightTitleEl.textContent = `${run.group_folder} · ${run.status}`;
  spotlightSummaryEl.textContent = run.last_event_summary || 'No event summary';
  spotlightTraceEl.textContent = run.trace_id || '-';
  spotlightContainerEl.textContent = run.container_name || '-';
  spotlightSessionEl.textContent = run.codex_session_id || '-';
}

function renderRuns() {
  const runs = getFilteredRuns();
  runsCountEl.textContent = `${runs.length} visible`;
  if (!runs.length) {
    runsListEl.innerHTML = '<div class="ops-empty">No runs match this filter.</div>';
    return;
  }

  runsListEl.innerHTML = runs
    .map(
      (run) => `
        <button class="run-card ${run.trace_id === selectedTraceId ? 'active' : ''}" data-trace-id="${escapeHtml(run.trace_id)}">
          <div class="run-card-top">
            <div>
              <div class="run-card-title">${escapeHtml(run.group_folder || run.chat_jid)}</div>
              <div class="run-card-meta">${escapeHtml(run.channel)} · ${escapeHtml(run.phase)}</div>
            </div>
            <span class="status-pill ${escapeHtml(run.status)}">${escapeHtml(run.status)}</span>
          </div>
          <div class="run-card-summary">${escapeHtml(run.last_event_summary || 'No event summary')}</div>
          <div class="run-card-meta">${escapeHtml(run.chat_jid)} · ${formatTime(run.updated_at)}</div>
        </button>
      `,
    )
    .join('');

  runsListEl.querySelectorAll('.run-card').forEach((node) => {
    node.addEventListener('click', async () => {
      selectedTraceId = node.getAttribute('data-trace-id');
      await loadTraceDetail(selectedTraceId);
      renderAll();
    });
  });
}

function renderTimeline(run) {
  if (!run) {
    timelineTraceEl.textContent = 'No run selected';
    timelineListEl.innerHTML = '<div class="ops-empty">Select a run to inspect it.</div>';
    return;
  }

  timelineTraceEl.textContent = run.trace_id;
  const events = Array.isArray(run.events) ? [...run.events].reverse() : [];
  if (!events.length) {
    timelineListEl.innerHTML = '<div class="ops-empty">No events captured.</div>';
    return;
  }

  timelineListEl.innerHTML = events
    .map(
      (event) => `
        <article class="timeline-event">
          <div class="timeline-top">
            <span class="timeline-type">${escapeHtml(event.type)}</span>
            <span class="timeline-meta">${formatTime(event.timestamp)}</span>
          </div>
          <div class="timeline-summary">${escapeHtml(event.summary)}</div>
          <div class="timeline-meta">${escapeHtml(event.phase || 'execution')}</div>
        </article>
      `,
    )
    .join('');
}

function renderDetails(run) {
  if (!run) {
    runDetailsEl.innerHTML = '<div class="ops-empty">No details yet.</div>';
    return;
  }

  const latestEvent = Array.isArray(run.events) && run.events.length
    ? run.events[run.events.length - 1]
    : null;

  runDetailsEl.innerHTML = `
    <div class="details-grid">
      <section class="details-block">
        <h3>Run</h3>
        <dl>
          <dt>Trace ID</dt>
          <dd>${escapeHtml(run.trace_id)}</dd>
          <dt>Chat</dt>
          <dd>${escapeHtml(run.chat_jid)}</dd>
          <dt>Group</dt>
          <dd>${escapeHtml(run.group_folder)}</dd>
          <dt>Status</dt>
          <dd>${escapeHtml(run.status)}</dd>
          <dt>Phase</dt>
          <dd>${escapeHtml(run.phase)}</dd>
        </dl>
      </section>
      <section class="details-block">
        <h3>Runtime</h3>
        <dl>
          <dt>Container</dt>
          <dd>${escapeHtml(run.container_name || '-')}</dd>
          <dt>Codex Session</dt>
          <dd>${escapeHtml(run.codex_session_id || '-')}</dd>
          <dt>Started</dt>
          <dd>${escapeHtml(run.started_at || '-')}</dd>
          <dt>Updated</dt>
          <dd>${escapeHtml(run.updated_at || '-')}</dd>
          <dt>Events</dt>
          <dd>${escapeHtml(String(run.events?.length || 0))}</dd>
        </dl>
      </section>
      <section class="details-block">
        <h3>Latest Event Payload</h3>
        <pre class="details-json">${escapeHtml(
          JSON.stringify(latestEvent?.data || {}, null, 2),
        )}</pre>
      </section>
    </div>
  `;

  payloadConsoleEl.textContent = JSON.stringify(latestEvent || {}, null, 2);
}

function renderFilesAndArtifacts(run) {
  const files = Array.isArray(run?.changed_files) ? run.changed_files : [];
  const artifacts = Array.isArray(run?.artifacts) ? run.artifacts : [];
  const diff = typeof run?.diff === 'string' ? run.diff : '';

  filesCountEl.textContent = `${files.length} files`;
  artifactsCountEl.textContent = `${artifacts.length} artifacts`;
  diffCountEl.textContent = `${diff.length} chars`;

  filesListEl.innerHTML = files.length
    ? `<div class="ops-list">${files
        .map((file) => `<div class="ops-list-item">${escapeHtml(file)}</div>`)
        .join('')}</div>`
    : '<div class="ops-empty">No changed files captured for this run.</div>';

  artifactsListEl.innerHTML = artifacts.length
    ? `<div class="ops-list">${artifacts
        .map((file) => `<div class="ops-list-item">${escapeHtml(file)}</div>`)
        .join('')}</div>`
    : '<div class="ops-empty">No artifacts discovered for this run.</div>';

  diffConsoleEl.textContent = diff || 'No diff captured for this run.';
}

function formatPrettyTraceLine(line) {
  try {
    const entry = JSON.parse(line);
    if (entry.type === 'trace_created') {
      return `[bootstrap] trace created for ${entry.group_folder || entry.chat_jid}`;
    }
    const phase = entry.phase || 'runtime';
    const summary = entry.summary || entry.type || 'event';
    const time = formatTime(entry.timestamp);
    return `[${time}] [${phase}] ${summary}`;
  } catch {
    return line;
  }
}

function renderConsole() {
  consoleCountEl.textContent = `${selectedTraceLines.length} lines`;
  const lines =
    consoleMode === 'raw'
      ? selectedTraceLines
      : selectedTraceLines.map(formatPrettyTraceLine);
  traceConsoleEl.textContent = lines.join('\n');
  if (!selectedTraceLines.length) {
    traceConsoleEl.textContent = 'No trace lines loaded.';
  }
}

function renderAll() {
  const run = pickSelectedRun();
  renderStats();
  renderSpotlight(run);
  renderRuns();
  renderTimeline(run);
  renderDetails(run);
  renderFilesAndArtifacts(run);
  renderConsole();
}

function applySnapshot(snapshot) {
  runtimeState = {
    active: Array.isArray(snapshot.active) ? snapshot.active : [],
    recent: Array.isArray(snapshot.recent) ? snapshot.recent : [],
  };
}

async function fetchSnapshot() {
  const response = await fetch('/api/runtime/runs');
  if (!response.ok) {
    throw new Error(`runtime snapshot failed: ${response.status}`);
  }
  applySnapshot(await response.json());
}

async function loadTraceDetail(traceId) {
  if (!traceId) return;
  try {
    const response = await fetch(`/api/runtime/traces/${encodeURIComponent(traceId)}`);
    if (!response.ok) return;
    const detail = await response.json();
    selectedTraceLines = Array.isArray(detail.lines) ? detail.lines.slice(-120) : [];
  } catch (error) {
    selectedTraceLines = [`Failed to load trace detail: ${error.message}`];
  }
}

function wireFilters() {
  document.querySelectorAll('.ops-filter').forEach((button) => {
    button.addEventListener('click', () => {
      selectedFilter = button.getAttribute('data-filter') || 'all';
      document
        .querySelectorAll('.ops-filter')
        .forEach((node) => node.classList.toggle('active', node === button));
      renderRuns();
    });
  });

  runsSearchEl?.addEventListener('input', () => {
    renderRuns();
  });
}

function connectSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
  setConnectionState('Connecting', false);

  ws.addEventListener('open', () => {
    setConnectionState('Authorizing', false);
  });

  ws.addEventListener('message', async (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'connected') {
      ws.send(JSON.stringify({ type: 'auth', token: authToken }));
      return;
    }
    if (data.type === 'auth') {
      if (data.success) {
        setConnectionState('Live', true);
      } else {
        setConnectionState('Auth Failed', false);
      }
      return;
    }
    if (data.type === 'run_event' && data.snapshot) {
      applySnapshot(data.snapshot);
      if (selectedTraceId && data.run?.trace_id === selectedTraceId) {
        await loadTraceDetail(selectedTraceId);
      }
      renderAll();
    }
  });

  ws.addEventListener('close', () => {
    setConnectionState('Disconnected', false);
    setTimeout(connectSocket, 2500);
  });

  ws.addEventListener('error', () => {
    setConnectionState('Socket Error', false);
  });
}

async function init() {
  wireFilters();
  refreshBtn?.addEventListener('click', async () => {
    await fetchSnapshot();
    const run = pickSelectedRun();
    if (run) {
      await loadTraceDetail(run.trace_id);
    }
    renderAll();
  });
  consolePrettyBtn?.addEventListener('click', () => {
    consoleMode = 'pretty';
    consolePrettyBtn.classList.add('active');
    consoleRawBtn?.classList.remove('active');
    renderConsole();
  });
  consoleRawBtn?.addEventListener('click', () => {
    consoleMode = 'raw';
    consoleRawBtn.classList.add('active');
    consolePrettyBtn?.classList.remove('active');
    renderConsole();
  });
  try {
    await fetchSnapshot();
    const run = pickSelectedRun();
    if (run) {
      await loadTraceDetail(run.trace_id);
    }
    renderAll();
  } catch (error) {
    runsListEl.innerHTML = `<div class="ops-empty">${escapeHtml(error.message)}</div>`;
  }
  connectSocket();
}

init();
