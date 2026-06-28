import { showToast, openLightbox } from '../main';
import { escHtml } from '../utils/sanitize';

let consoleKey = '';
let currentSection = 'overview';

export function renderConsole(container: HTMLElement) {
  const stored = sessionStorage.getItem('consoleKey') || '';
  if (stored) {
    consoleKey = stored;
    renderLayout(container);
    return;
  }
  container.innerHTML = `
    <div class="console-hero">
      <div class="console-login">
        <h2>Console Access</h2>
        <p style="color:var(--text-dim);margin-bottom:24px">Enter the console key to continue.</p>
        <input type="password" id="console-key-input" placeholder="Console key" autocomplete="off">
        <button class="btn btn-primary" id="console-key-submit" style="width:100%;margin-top:12px">Unlock</button>
        <p id="console-key-err" style="color:var(--danger);font-size:0.85rem;margin-top:8px;display:none"></p>
      </div>
    </div>
  `;
  document.getElementById('console-key-submit')!.addEventListener('click', () => unlock(container));
  document.getElementById('console-key-input')!.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') unlock(container);
  });
}

async function unlock(container: HTMLElement) {
  const input = document.getElementById('console-key-input') as HTMLInputElement;
  const err = document.getElementById('console-key-err')!;
  const btn = document.getElementById('console-key-submit') as HTMLButtonElement;
  const key = input.value.trim();
  if (!key) return;
  try {
    btn.disabled = true;
    btn.textContent = 'Verifying...';
    const res = await fetch('/api/console/auth-check', { headers: { 'x-console-key': key } });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: 'Invalid key' }));
      throw new Error(data.error || 'Invalid key');
    }
    consoleKey = key;
    sessionStorage.setItem('consoleKey', key);
    renderLayout(container);
  } catch (e: any) {
    err.textContent = e.message;
    err.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Unlock';
  }
}

function renderLayout(container: HTMLElement) {
  const navItems = [
    { id: 'overview', icon: '\u25A0', label: 'Overview' },
    { id: 'polls', icon: '\u2691', label: 'Poll Browser' },
    { id: 'storage', icon: '\u25A6', label: 'Storage' },
    { id: 'database', icon: '\u25A7', label: 'DB Explorer' },
  ];

  container.innerHTML = `
    <div class="console-layout">
      <nav class="console-sidebar">
        <div class="console-brand">
          <span class="console-brand-icon">\u25C8</span>
          <span class="console-brand-text">Console</span>
        </div>
        <div class="console-nav">
          ${navItems.map(n => `
            <button class="console-nav-item ${currentSection === n.id ? 'active' : ''}" data-section="${n.id}">
              <span class="console-nav-icon">${n.icon}</span>
              <span>${n.label}</span>
            </button>
          `).join('')}
        </div>
        <button class="console-logout" id="console-logout">Lock Console</button>
      </nav>
      <main class="console-main" id="console-main">
        <div class="console-loading">Loading...</div>
      </main>
    </div>
  `;

  document.querySelectorAll('.console-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      currentSection = (btn as HTMLElement).dataset.section!;
      document.querySelectorAll('.console-nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadSection();
    });
  });

  document.getElementById('console-logout')!.addEventListener('click', () => {
    sessionStorage.removeItem('consoleKey');
    consoleKey = '';
    currentSection = 'overview';
    renderConsole(container);
  });

  document.addEventListener('keydown', function lockOnEsc(e) {
    if (e.key === 'Escape') {
      document.removeEventListener('keydown', lockOnEsc);
      sessionStorage.removeItem('consoleKey');
      consoleKey = '';
      currentSection = 'overview';
      window.location.reload();
    }
  });

  loadSection();
}

async function consoleApi<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch('/api/console' + url, {
    ...init,
    headers: { ...init?.headers, 'x-console-key': consoleKey },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: `Request failed (${res.status})` }));
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return res.json();
}

function loadSection() {
  switch (currentSection) {
    case 'overview': loadOverview(); break;
    case 'polls': loadPollBrowser(); break;
    case 'storage': loadStorage(); break;
    case 'database': loadDatabase(); break;
  }
}

// ─── OVERVIEW ────────────────────────────────────────
async function loadOverview() {
  const main = document.getElementById('console-main')!;
  main.innerHTML = '<div class="console-loading">Loading...</div>';
  try {
    const [overview, usage] = await Promise.all([
      consoleApi<any>('/overview'),
      consoleApi<{ date: string; count: number }[]>('/usage'),
    ]);
    renderOverview(main, overview, usage);
  } catch (e: any) {
    main.innerHTML = `<div class="console-error">Failed to load: ${escHtml(e.message)}</div>`;
  }
}

function fmtBytes(bytes: number): string {
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB';
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return bytes + ' B';
}

function fmtDate(ts: number): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function renderOverview(main: HTMLElement, overview: any, usage: { date: string; count: number }[]) {
  const maxVotes = Math.max(1, ...usage.map(u => u.count));
  const now = Date.now();
  const days = usage.length > 0 ? Math.max(1, Math.ceil((now - new Date(usage[0].date).getTime()) / 86400000)) : 30;
  const startDate = new Date(now - days * 86400000);
  const dayMap: Record<string, number> = {};
  for (const u of usage) dayMap[u.date] = u.count;

  const bars: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(startDate.getTime() + (i + 1) * 86400000);
    const key = d.toISOString().slice(0, 10);
    const cnt = dayMap[key] || 0;
    const h = maxVotes > 0 ? Math.max(2, Math.round((cnt / maxVotes) * 100)) : 2;
    bars.push(`<div class="console-chart-bar" style="height:${h}%" title="${key}: ${cnt} vote(s)"><span class="console-chart-bar-label">${cnt}</span></div>`);
  }

  const activityLevel = overview.totalVotes > 100 ? 'high' : overview.totalVotes > 10 ? 'medium' : 'low';

  main.innerHTML = `
    <h1 class="console-title">Dashboard</h1>

    <div class="console-cards">
      <div class="console-card">
        <div class="console-card-icon">\u2691</div>
        <div class="console-card-value">${overview.totalPolls}</div>
        <div class="console-card-label">Total Polls</div>
      </div>
      <div class="console-card">
        <div class="console-card-icon">\u2714</div>
        <div class="console-card-value">${overview.totalVotes}</div>
        <div class="console-card-label">Total Votes</div>
      </div>
      <div class="console-card">
        <div class="console-card-icon">\u25A3</div>
        <div class="console-card-value">${overview.totalImages}</div>
        <div class="console-card-label">Total Images</div>
      </div>
      <div class="console-card">
        <div class="console-card-icon">\u263A</div>
        <div class="console-card-value">${overview.totalVoters}</div>
        <div class="console-card-label">Unique Voters</div>
      </div>
    </div>

    <div class="console-panels">
      <div class="console-panel">
        <h2 class="console-panel-title">Activity <span class="console-badge console-badge-${activityLevel}">${activityLevel}</span></h2>
        <div class="console-chart" id="usage-chart">
          ${bars.join('')}
        </div>
        <div class="console-chart-axis">
          <span>${fmtDate(startDate.getTime())}</span>
          <span>${fmtDate(now)}</span>
        </div>
      </div>

      <div class="console-panel">
        <h2 class="console-panel-title">Averages</h2>
        <div class="console-metrics">
          <div class="console-metric">
            <span class="console-metric-value">${overview.averageImagesPerPoll}</span>
            <span class="console-metric-label">Images per Poll</span>
          </div>
          <div class="console-metric">
            <span class="console-metric-value">${overview.averageVotesPerPoll}</span>
            <span class="console-metric-label">Votes per Poll</span>
          </div>
          <div class="console-metric">
            <span class="console-metric-value">${overview.averageRoundsPerPoll}</span>
            <span class="console-metric-label">Rounds per Poll</span>
          </div>
          <div class="console-metric">
            <span class="console-metric-value">${Math.round(overview.totalPolls > 0 ? (overview.totalVoters / overview.totalPolls) * 10 / 10 : 0)}</span>
            <span class="console-metric-label">Voters per Poll</span>
          </div>
        </div>
      </div>
    </div>

    <div class="console-panels">
      <div class="console-panel">
        <h2 class="console-panel-title">Latest Poll</h2>
        ${overview.latestPoll ? `
          <div style="padding:4px 0">
            <div style="font-weight:600;margin-bottom:4px">${escHtml(overview.latestPoll.title || '(untitled)')}</div>
            <div style="font-family:monospace;font-size:0.75rem;color:var(--accent-glow)">${escHtml(overview.latestPoll.id)}</div>
            <div style="font-size:0.8rem;color:var(--text-dim);margin-top:4px">Created ${fmtDate(overview.latestPoll.createdAt)}</div>
          </div>
        ` : '<div style="color:var(--text-dim);padding:4px 0">No polls yet</div>'}
      </div>
      <div class="console-panel">
        <h2 class="console-panel-title">First Poll</h2>
        ${overview.oldestPoll ? `
          <div style="padding:4px 0">
            <div style="font-weight:600;margin-bottom:4px">${escHtml(overview.oldestPoll.title || '(untitled)')}</div>
            <div style="font-family:monospace;font-size:0.75rem;color:var(--accent-glow)">${escHtml(overview.oldestPoll.id)}</div>
            <div style="font-size:0.8rem;color:var(--text-dim);margin-top:4px">Created ${fmtDate(overview.oldestPoll.createdAt)}</div>
          </div>
        ` : '<div style="color:var(--text-dim);padding:4px 0">No polls yet</div>'}
      </div>
    </div>

    ${overview.totalPolls > 0 ? `
      <div class="console-panel" style="margin-top:20px">
        <h2 class="console-panel-title">Vote Distribution</h2>
        <div style="font-size:0.85rem;color:var(--text-dim)">
          <p>${usage.length} day(s) with voting activity out of ${days} day(s) displayed</p>
          <p>Peak day: ${maxVotes} vote(s)</p>
        </div>
      </div>
    ` : ''}
  `;
}

// ─── POLL BROWSER ────────────────────────────────────
async function loadPollBrowser() {
  const main = document.getElementById('console-main')!;
  main.innerHTML = '<div class="console-loading">Loading...</div>';
  try {
    const polls = await consoleApi<any[]>('/polls');
    renderPollBrowser(main, polls);
  } catch (e: any) {
    main.innerHTML = `<div class="console-error">Failed to load: ${escHtml(e.message)}</div>`;
  }
}

function renderPollBrowser(main: HTMLElement, polls: any[]) {
  let sortBy = 'createdAt';
  let sortDir = 'desc';
  let searchTerm = '';

  const render = (data: any[]) => {
    main.innerHTML = `
      <h1 class="console-title">Poll Browser</h1>
      <div class="console-toolbar">
        <div class="console-search">
          <input type="text" id="poll-search" placeholder="Search by title, description, or ID..." value="${escHtml(searchTerm)}">
        </div>
        <span class="console-count">${data.length} poll(s)</span>
      </div>
      <div class="console-table-wrap">
        <table class="console-table" id="poll-table">
          <thead>
            <tr>
              <th class="sortable" data-col="title">Title <span class="sort-arrow">${sortBy === 'title' ? (sortDir === 'asc' ? '\u2191' : '\u2193') : ''}</span></th>
              <th class="sortable" data-col="imageCount">Images <span class="sort-arrow">${sortBy === 'imageCount' ? (sortDir === 'asc' ? '\u2191' : '\u2193') : ''}</span></th>
              <th class="sortable" data-col="voteCount">Votes <span class="sort-arrow">${sortBy === 'voteCount' ? (sortDir === 'asc' ? '\u2191' : '\u2193') : ''}</span></th>
              <th class="sortable" data-col="rounds">Rounds <span class="sort-arrow">${sortBy === 'rounds' ? (sortDir === 'asc' ? '\u2191' : '\u2193') : ''}</span></th>
              <th class="sortable" data-col="createdAt">Created <span class="sort-arrow">${sortBy === 'createdAt' ? (sortDir === 'asc' ? '\u2191' : '\u2193') : ''}</span></th>
              <th>Results</th>
            </tr>
          </thead>
          <tbody id="poll-tbody">
            ${data.length === 0 ? `<tr><td colspan="6" style="text-align:center;color:var(--text-dim)">No polls found</td></tr>` :
              data.map(p => `
                <tr class="console-poll-row" data-id="${escHtml(p.id)}">
                  <td>
                    <div class="console-poll-title">${escHtml(p.title || '(untitled)')}</div>
                    <div class="console-poll-id">${escHtml(p.id)}</div>
                  </td>
                  <td>${p.imageCount}</td>
                  <td>${p.voteCount}</td>
                  <td>${p.rounds}</td>
                  <td>${fmtDate(p.createdAt)}</td>
                  <td>${p.showResults ? '\u2714' : '\u2718'}</td>
                </tr>
              `).join('')
            }
          </tbody>
        </table>
      </div>
    `;

    document.getElementById('poll-search')!.addEventListener('input', async (e) => {
      searchTerm = (e.target as HTMLInputElement).value;
      const results = await consoleApi<any[]>(`/polls?search=${encodeURIComponent(searchTerm)}&sortBy=${sortBy}&sortDir=${sortDir}`);
      render(results);
    });

    main.querySelectorAll('.sortable').forEach(th => {
      th.addEventListener('click', async () => {
        const col = (th as HTMLElement).dataset.col!;
        if (sortBy === col) {
          sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          sortBy = col;
          sortDir = col === 'title' ? 'asc' : 'desc';
        }
        const results = await consoleApi<any[]>(`/polls?search=${encodeURIComponent(searchTerm)}&sortBy=${sortBy}&sortDir=${sortDir}`);
        render(results);
      });
    });

    const tbody = document.getElementById('poll-tbody')!;
    main.querySelectorAll('.console-poll-row').forEach(row => {
      row.addEventListener('click', async () => {
        const id = (row as HTMLElement).dataset.id!;

        const existing = tbody.querySelector('.console-poll-expand');
        if (existing) {
          const parentRow = existing.previousElementSibling as HTMLElement | null;
          parentRow?.classList.remove('expanded');
          existing.remove();
          if (parentRow?.dataset.id === id) return;
        }

        const tr = row as HTMLElement;
        tr.classList.add('expanded');

        const expandRow = document.createElement('tr');
        expandRow.className = 'console-poll-expand';
        expandRow.innerHTML = `<td colspan="6"><div class="console-loading">Loading...</div></td>`;
        tr.after(expandRow);

        try {
          const poll = await consoleApi<any>(`/polls/${id}`);
          expandRow.innerHTML = `
            <td colspan="6">
              <div class="console-poll-detail-inline">
                <h3>${escHtml(poll.title || '(untitled)')} <span style="font-weight:400;font-size:0.8rem;color:var(--text-dim)">${escHtml(poll.id)}</span></h3>
                <div class="console-poll-meta">
                  <div><span>Description:</span> ${escHtml(poll.description || 'None')}</div>
                  <div><span>Images:</span> ${poll.images.length}</div>
                  <div><span>Rounds:</span> ${poll.rounds}</div>
                  <div><span>Container:</span> ${poll.containerWidth}\u00d7${poll.containerHeight} (${poll.fitMode})</div>
                  <div><span>Show Results:</span> ${poll.showResults ? 'Yes' : 'No'}</div>
                  <div><span>Created:</span> ${fmtDate(poll.createdAt)}</div>
                </div>
                ${poll.images.length > 0 ? `
                  <div class="console-poll-images">
                    ${poll.images.map((img: any, i: number) => `
                      <div class="console-poll-thumb">
                        <img src="/uploads/${escHtml(img.filename)}" class="console-poll-thumb-img" data-src="/uploads/${escHtml(img.filename)}" alt="${escHtml(img.originalName)}" loading="lazy">
                        <span>#${i + 1} ${escHtml(img.originalName)}</span>
                      </div>
                    `).join('')}
                  </div>
                ` : ''}
              </div>
            </td>
          `;

          expandRow.querySelectorAll('.console-poll-thumb-img').forEach(img => {
            img.addEventListener('click', (e) => {
              e.stopPropagation();
              const el = img as HTMLImageElement;
              openLightbox(el.dataset.src || el.src, el.alt);
            });
          });
        } catch (e: any) {
          expandRow.innerHTML = `<td colspan="6"><div class="console-error">Failed to load detail: ${escHtml(e.message)}</div></td>`;
        }
      });
    });
  };

  render(polls);
}

// ─── STORAGE ─────────────────────────────────────────
async function loadStorage() {
  const main = document.getElementById('console-main')!;
  main.innerHTML = '<div class="console-loading">Loading...</div>';
  try {
    const stats = await consoleApi<any>('/storage');
    renderStorage(main, stats);
  } catch (e: any) {
    main.innerHTML = `<div class="console-error">Failed to load: ${escHtml(e.message)}</div>`;
  }
}

function renderStorage(main: HTMLElement, stats: any) {
  const totalBytes = stats.dbSizeBytes + stats.uploadDirSizeBytes;
  const dbPct = totalBytes > 0 ? (stats.dbSizeBytes / totalBytes * 100).toFixed(1) : '0';
  const uploadPct = totalBytes > 0 ? (stats.uploadDirSizeBytes / totalBytes * 100).toFixed(1) : '0';

  main.innerHTML = `
    <h1 class="console-title">Storage</h1>

    <div class="console-cards">
      <div class="console-card">
        <div class="console-card-icon">\u25A6</div>
        <div class="console-card-value">${fmtBytes(totalBytes)}</div>
        <div class="console-card-label">Total Used</div>
      </div>
      <div class="console-card">
        <div class="console-card-icon">\u25A7</div>
        <div class="console-card-value">${fmtBytes(stats.dbSizeBytes)}</div>
        <div class="console-card-label">Database</div>
      </div>
      <div class="console-card">
        <div class="console-card-icon">\u25A3</div>
        <div class="console-card-value">${fmtBytes(stats.uploadDirSizeBytes)}</div>
        <div class="console-card-label">Uploads</div>
      </div>
      <div class="console-card">
        <div class="console-card-icon">#</div>
        <div class="console-card-value">${stats.uploadFileCount}</div>
        <div class="console-card-label">Files</div>
      </div>
    </div>

    <div class="console-panels">
      <div class="console-panel console-panel-wide">
        <h2 class="console-panel-title">Storage Breakdown</h2>
        <div class="console-storage-bar">
          <div class="console-storage-seg" style="width:${dbPct}%;background:var(--accent)" title="Database: ${fmtBytes(stats.dbSizeBytes)}"></div>
          <div class="console-storage-seg" style="width:${uploadPct}%;background:var(--success)" title="Uploads: ${fmtBytes(stats.uploadDirSizeBytes)}"></div>
        </div>
        <div class="console-storage-legend">
          <span><span class="console-legend-dot" style="background:var(--accent)"></span> Database ${fmtBytes(stats.dbSizeBytes)}</span>
          <span><span class="console-legend-dot" style="background:var(--success)"></span> Uploads ${fmtBytes(stats.uploadDirSizeBytes)}</span>
        </div>
      </div>
    </div>

    ${stats.largestFiles.length > 0 ? `
      <div class="console-panel" style="margin-top:20px">
        <h2 class="console-panel-title">Largest Uploads</h2>
        <div class="console-table-wrap">
          <table class="console-table" id="storage-table">
            <thead><tr><th></th><th>#</th><th>Filename</th><th>Size</th></tr></thead>
            <tbody>
              ${stats.largestFiles.map((f: any, i: number) => `
                <tr>
                  <td style="padding:4px 8px;width:48px">
                    <img src="/uploads/${escHtml(f.name)}" class="console-storage-thumb" data-src="/uploads/${escHtml(f.name)}" title="${escHtml(f.name)}" loading="lazy">
                  </td>
                  <td style="color:var(--text-dim)">${i + 1}</td>
                  <td style="font-family:monospace;font-size:0.8rem">${escHtml(f.name)}</td>
                  <td>${fmtBytes(f.size)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    ` : ''}
  `;

  main.querySelectorAll('.console-storage-thumb').forEach(img => {
    img.addEventListener('click', (e) => {
      e.stopPropagation();
      const el = img as HTMLImageElement;
      openLightbox(el.dataset.src || el.src, el.title);
    });
  });
}

// ─── DATABASE EXPLORER ───────────────────────────────
async function loadDatabase() {
  const main = document.getElementById('console-main')!;
  main.innerHTML = '<div class="console-loading">Loading...</div>';
  try {
    const tables = await consoleApi<any[]>('/db/tables');
    renderDatabase(main, tables);
  } catch (e: any) {
    main.innerHTML = `<div class="console-error">Failed to load: ${escHtml(e.message)}</div>`;
  }
}

function renderDatabase(main: HTMLElement, tables: any[]) {
  main.innerHTML = `
    <h1 class="console-title">Database Explorer</h1>

    <div class="console-panels">
      <div class="console-panel" style="flex:0 0 280px;max-width:320px">
        <h2 class="console-panel-title">Tables</h2>
        <div class="console-table-list">
          ${tables.map((t: any) => `
            <div class="console-table-item" data-table="${escHtml(t.name)}">
              <span class="console-table-name">${escHtml(t.name)}</span>
              <span class="console-table-rows">${t.rowCount} rows</span>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="console-panel console-panel-wide">
        <div id="db-detail">
          <h2 class="console-panel-title">Select a table to view schema</h2>
          <p style="color:var(--text-dim);font-size:0.85rem">Click a table name on the left to see its columns.</p>
        </div>
      </div>
    </div>

    <div class="console-panel" style="margin-top:20px">
      <h2 class="console-panel-title">Read-Only Query</h2>
      <p style="color:var(--text-dim);font-size:0.8rem;margin-bottom:10px">Only SELECT, PRAGMA, and EXPLAIN queries allowed.</p>
      <div class="console-query-editor">
        <textarea id="db-query" placeholder="SELECT * FROM polls LIMIT 10" rows="3" style="font-family:monospace;font-size:0.85rem"></textarea>
        <button class="btn btn-primary" id="db-run-query" style="align-self:flex-end;padding:8px 20px">Run</button>
      </div>
      <div id="db-query-error" style="color:var(--danger);font-size:0.85rem;margin-top:8px;display:none"></div>
      <div id="db-query-result" style="margin-top:16px"></div>
    </div>
  `;

  main.querySelectorAll('.console-table-item').forEach(item => {
    item.addEventListener('click', () => {
      const name = (item as HTMLElement).dataset.table!;
      main.querySelectorAll('.console-table-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      const t = tables.find((t: any) => t.name === name);
      if (!t) return;
      const detail = document.getElementById('db-detail')!;
      detail.innerHTML = `
        <h2 class="console-panel-title">${escHtml(t.name)} <span style="font-weight:400;font-size:0.8rem;color:var(--text-dim)">${t.rowCount} row(s)</span></h2>
        <div class="console-table-wrap" style="margin-top:12px">
          <table class="console-table">
            <thead><tr><th>Column</th><th>Type</th><th>Not Null</th><th>PK</th></tr></thead>
            <tbody>
              ${t.columns.map((c: any) => `
                <tr>
                  <td style="font-family:monospace;font-weight:600">${escHtml(c.name)}</td>
                  <td style="font-family:monospace;font-size:0.8rem;color:var(--text-dim)">${escHtml(c.type)}</td>
                  <td>${c.notnull ? '\u2714' : ''}</td>
                  <td>${c.pk ? '\u2714' : ''}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    });
  });

  document.getElementById('db-run-query')!.addEventListener('click', async () => {
    const sql = (document.getElementById('db-query') as HTMLTextAreaElement).value.trim();
    const errEl = document.getElementById('db-query-error')!;
    const resultEl = document.getElementById('db-query-result')!;
    if (!sql) { errEl.textContent = 'Enter a query'; errEl.style.display = 'block'; return; }
    errEl.style.display = 'none';
    resultEl.innerHTML = '<div class="console-loading">Running...</div>';
    try {
      const result = await consoleApi<any>('/db/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql }),
      });
      if (result.columns.length === 0) {
        resultEl.innerHTML = `<div style="color:var(--text-dim);padding:12px">Query returned 0 rows</div>`;
      } else {
        resultEl.innerHTML = `
          <div style="color:var(--text-dim);font-size:0.8rem;margin-bottom:8px">${result.rowCount} row(s)</div>
          <div class="console-table-wrap">
            <table class="console-table">
              <thead><tr>${result.columns.map((c: string) => `<th>${escHtml(c)}</th>`).join('')}</tr></thead>
              <tbody>
                ${result.rows.map((r: any) => `
                  <tr>${result.columns.map((c: string) => `<td style="font-family:monospace;font-size:0.8rem;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(typeof r[c] === 'object' ? JSON.stringify(r[c]) : String(r[c] ?? ''))}</td>`).join('')}</tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `;
      }
    } catch (e: any) {
      errEl.textContent = e.message;
      errEl.style.display = 'block';
      resultEl.innerHTML = '';
    }
  });
}
