import { showToast, openLightbox } from '../main';
import { api, authHeaders, maxFileSize, maxImages, loadConfig } from '../utils/api';
import { escHtml, escAttr, escInput } from '../utils/sanitize';
import type { Poll, Image, VoterInfo, Selection, FitMode, Pairing } from '../types';

let pollId = '';
let token = '';
let currentTab = 'images';
let previewActive = false;
let stopPreview: (() => void) | null = null;

function randomUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export async function renderAdmin(container: HTMLElement, pid: string) {
  pollId = pid;
  token = sessionStorage.getItem(`adminToken-${pid}`) || '';
  previewActive = false;
  stopPreview = null;

  if (!token) {
    container.innerHTML = `<div class="hero"><h2>Access Denied</h2><p>Missing admin token. Create a poll from the home page.</p></div>`;
    return;
  }

  container.innerHTML = `
    <div>
      <div class="admin-tabs">
        <button class="admin-tab ${currentTab === 'images' ? 'active' : ''}" data-tab="images">Images</button>
        <button class="admin-tab ${currentTab === 'settings' ? 'active' : ''}" data-tab="settings">Settings</button>
        <button class="admin-tab ${currentTab === 'size' ? 'active' : ''}" data-tab="size">Container Size</button>
        <button class="admin-tab ${currentTab === 'share' ? 'active' : ''}" data-tab="share">Share</button>
        <button class="admin-tab ${currentTab === 'metadata' ? 'active' : ''}" data-tab="metadata">Voters & Results</button>
      </div>
      <div class="admin-tab-content ${currentTab === 'images' ? 'active' : ''}" data-content="images"></div>
      <div class="admin-tab-content ${currentTab === 'settings' ? 'active' : ''}" data-content="settings"></div>
      <div class="admin-tab-content ${currentTab === 'size' ? 'active' : ''}" data-content="size"></div>
      <div class="admin-tab-content ${currentTab === 'share' ? 'active' : ''}" data-content="share"></div>
      <div class="admin-tab-content ${currentTab === 'metadata' ? 'active' : ''}" data-content="metadata"></div>
    </div>
  `;

  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      currentTab = (tab as HTMLElement).dataset.tab!;
      document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.remove('active'));
      document.querySelector(`[data-content="${currentTab}"]`)!.classList.add('active');
      const panel = document.getElementById('preview-panel');
      if (panel) panel.remove();
      loadTabContent();
    });
  });

  const oldToggle = document.getElementById('preview-toggle-btn');
  if (oldToggle) oldToggle.remove();
  const toggleBtn = document.createElement('button');
  toggleBtn.id = 'preview-toggle-btn';
  toggleBtn.className = 'btn btn-primary';
  toggleBtn.style.cssText = 'position:fixed;top:12px;right:16px;z-index:30;padding:6px 16px;font-size:0.8rem';
  toggleBtn.textContent = 'Preview';
  toggleBtn.addEventListener('click', () => {
    if (previewActive) {
      stopPreview?.();
    } else {
      startPreview(container, toggleBtn);
    }
  });
  document.body.appendChild(toggleBtn);

  await loadConfig();
  loadPoll();
}

async function startPreview(container: HTMLElement, toggleBtn: HTMLButtonElement) {
  const poll = await api<Poll>(`/polls/${pollId}`, { headers: authHeaders(token) });
  if (poll.images.length < 2) {
    showToast('Need at least 2 images to preview', 'error');
    return;
  }

  previewActive = true;
  toggleBtn.textContent = 'Stop Preview';
  toggleBtn.classList.remove('btn-primary');
  toggleBtn.classList.add('btn-danger');

  const fp = 'preview-' + randomUUID();
  const pairings = await api<{ pairings: Pairing[]; totalRounds: number }>(`/polls/${pollId}/pairings`, { headers: { 'x-voter-fingerprint': fp } });

  let round = 0;
  const selections: Selection[] = [];
  let animating = false;
  let animTimer: ReturnType<typeof setTimeout> | null = null;
  const FM = poll.fitMode;

  function previewCleanup() {
    if (animTimer) clearTimeout(animTimer);
    const stage = document.getElementById('vote-stage');
    if (stage) stage.remove();
    const bar = document.getElementById('preview-progress');
    if (bar) bar.remove();
    const pp = document.getElementById('preview-panel');
    if (pp) pp.remove();
    previewActive = false;
    stopPreview = null;
    toggleBtn.textContent = 'Preview';
    toggleBtn.classList.remove('btn-danger');
    toggleBtn.classList.add('btn-primary');
  }

  stopPreview = () => {
    previewCleanup();
    renderAdmin(container, pollId);
  };

  function renderProgress() {
    const bar = document.getElementById('preview-progress');
    if (!bar) return;
    bar.innerHTML = pairings.pairings.map((_, i) => {
      let cls = 'progress-dot';
      if (i < round) cls += ' done';
      if (i === round) cls += ' current';
      return `<div class="${cls}"></div>`;
    }).join('');
  }

  function renderPairing() {
    if (round >= pairings.pairings.length) {
      renderPreviewDone();
      return;
    }
    const p = pairings.pairings[round];

    // Remove old stage if exists
    const oldStage = document.getElementById('vote-stage');
    if (oldStage) oldStage.remove();
    const oldBar = document.getElementById('preview-progress');
    if (oldBar) oldBar.remove();

    const stage = document.createElement('div');
    stage.id = 'vote-stage';
    stage.className = 'vote-stage';
    stage.style.setProperty('--container-w', `${poll.containerWidth}px`);
    stage.style.setProperty('--container-h', `${poll.containerHeight}px`);
    stage.style.setProperty('--fit-mode', FM);
    stage.innerHTML = `
      <button class="preview-close" id="preview-close-btn" title="Back to editor">&times;</button>
      <div class="round-counter">Round ${round + 1} / ${pairings.pairings.length}</div>
      <div class="vote-option left" id="vote-left" data-side="left">
        <img src="/uploads/${escAttr(p.left.filename)}" alt="${escHtml(p.left.originalName)}" draggable="false">
        <div class="option-label">${escHtml(imgLabel(poll.images, p.left.id))}</div>
      </div>
      <div class="vote-vs">VS</div>
      <div class="vote-option right" id="vote-right" data-side="right">
        <img src="/uploads/${escAttr(p.right.filename)}" alt="${escHtml(p.right.originalName)}" draggable="false">
        <div class="option-label">${escHtml(imgLabel(poll.images, p.right.id))}</div>
      </div>
    `;
    document.body.appendChild(stage);

    document.getElementById('preview-close-btn')!.addEventListener('click', () => {
      previewCleanup();
      renderAdmin(container, pollId);
    });

    const bar = document.createElement('div');
    bar.id = 'preview-progress';
    bar.className = 'progress-sidebar';
    bar.innerHTML = pairings.pairings.map((_, i) =>
      `<div class="progress-dot${i < round ? ' done' : ''}${i === round ? ' current' : ''}"></div>`
    ).join('');
    document.body.appendChild(bar);

    const leftEl = document.getElementById('vote-left')!;
    const rightEl = document.getElementById('vote-right')!;

    const choose = (side: 'left' | 'right') => {
      if (animating) return;
      animating = true;
      const winner = side === 'left' ? p.left : p.right;
      selections.push({ round, leftImageId: p.left.id, rightImageId: p.right.id, winnerId: winner.id });
      if (side === 'left') { leftEl.classList.add('smack-winner'); rightEl.classList.add('smack-loser'); }
      else { rightEl.classList.add('smack-winner'); leftEl.classList.add('smack-loser'); }
      animTimer = setTimeout(() => { round++; animating = false; renderPairing(); }, 500);
    };

    leftEl.addEventListener('click', () => choose('left'));
    rightEl.addEventListener('click', () => choose('right'));

    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') choose('left');
      else if (e.key === 'ArrowRight') choose('right');
    };
    window.addEventListener('keydown', keyHandler);
  }

  function renderPreviewDone() {
    previewCleanup();

    const stats: Record<string, { wins: number }> = {};
    for (const s of selections) {
      if (!stats[s.winnerId]) stats[s.winnerId] = { wins: 0 };
      stats[s.winnerId].wins++;
    }

    const total = selections.length;
    let html = `
      <div class="preview-toolbar">
        <button class="btn btn-secondary" id="preview-back" style="padding:6px 14px;font-size:0.8rem">&larr; Back to editor</button>
        <span style="color:var(--text-dim);font-size:0.85rem;margin-left:12px">Preview complete</span>
      </div>
      <div class="vote-hero">
        <h2>${escHtml(poll.title || 'Poll')}</h2>
        <p>Preview — not saved</p>
      </div>
      <div class="results-section">
        <h3 style="margin-bottom:16px">Your picks</h3>
    `;

    for (const img of poll.images) {
      const wins = stats[img.id]?.wins || 0;
      const pct = Number.isFinite(wins) && Number.isFinite(total) && total > 0
        ? Math.min(100, Math.max(0, Math.round((wins / total) * 100)))
        : 0;
       html += `
        <div class="results-bar">
          <img src="/uploads/${escAttr(img.filename)}" alt="" title="${escAttr(imgLabel(poll.images, img.id))}">
          <div style="flex:1">
            <div style="font-size:0.8rem;margin-bottom:2px">${escHtml(imgLabel(poll.images, img.id))}</div>
            <div class="results-bar-fill">
              <div class="results-bar-inner" style="width:${pct}%"></div>
            </div>
          </div>
          <div class="results-bar-label">${pct}% (${wins}/${total})</div>
        </div>
      `;
    }
    html += '</div>';
    container.innerHTML = html;

    container.querySelectorAll('.results-bar img').forEach(img => {
      img.addEventListener('click', (e) => {
        e.stopPropagation();
        const el = img as HTMLImageElement;
        openLightbox(el.src, el.title || undefined);
      });
    });

    document.getElementById('preview-back')!.addEventListener('click', () => {
      renderAdmin(container, pollId);
    });
  }

  renderPairing();
}

async function loadPoll() {
  try {
    const poll = await api<Poll>(`/polls/${pollId}`, { headers: authHeaders(token) });
    loadTabContent(poll);
  } catch (e: any) {
    showToast(e.message, 'error');
  }
}

function loadTabContent(poll?: Poll) {
  if (!poll) { loadPoll(); return; }
  switch (currentTab) {
    case 'images': renderImagesTab(poll); break;
    case 'settings': renderSettingsTab(poll); break;
    case 'size': renderSizeTab(poll); break;
    case 'share': renderShareTab(poll); break;
    case 'metadata': renderMetadataTab(); break;
  }
}

function renderImagesTab(poll: Poll) {
  const el = document.querySelector('[data-content="images"]')!;
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      <span style="font-size:0.8rem;font-weight:700;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.5px">View</span>
      <div class="size-fit-group">
        <button class="size-fit-btn active" data-view="grid">Grid</button>
        <button class="size-fit-btn" data-view="list">List</button>
      </div>
    </div>
    <div class="upload-zone" id="upload-zone">
      <p>Drag & drop images here, or click to browse</p>
      <input type="file" id="file-input" accept="image/*" multiple hidden>
    </div>
    <div class="image-grid" id="image-grid">
      ${poll.images.map((img, i) => `
        <div class="image-card" data-img="${img.id}">
          <img src="/uploads/${escAttr(img.filename)}" alt="${escAttr(img.originalName)}">
          <span class="image-index">#${i + 1}</span>
          <span class="image-name">${escAttr(img.originalName)}</span>
          <button class="remove-btn" data-remove="${img.id}">&times;</button>
        </div>
      `).join('')}
    </div>
    <p style="color:var(--text-dim);font-size:0.8rem">${poll.images.length} / ${maxImages()} images</p>
  `;

  setupUpload(el as HTMLElement, poll);

  document.getElementById('image-grid')!.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'IMG') {
      const card = target.closest('.image-card') as HTMLElement | null;
      const idx = card?.querySelector('.image-index')?.textContent || '';
      const alt = (target as HTMLImageElement).alt;
      openLightbox((target as HTMLImageElement).src, `${idx} ${alt}`);
    }
  });

  el.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const imgId = (btn as HTMLElement).dataset.remove!;
      try {
        await api(`/polls/${pollId}/images/${imgId}`, { method: 'DELETE', headers: authHeaders(token) });
        (btn as HTMLElement).closest('.image-card')?.remove();
        poll.images = poll.images.filter(i => i.id !== imgId);
        const counter = el.querySelector('p') as HTMLParagraphElement | null;
        if (counter) counter.textContent = `${poll.images.length} / ${maxImages()} images`;
      } catch (err: any) { showToast(err.message, 'error'); }
    });
  });
  el.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      el.querySelectorAll('[data-view]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const view = (btn as HTMLElement).dataset.view!;
      const grid = document.getElementById('image-grid')!;
      if (view === 'list') {
        grid.classList.add('image-list');
        grid.classList.remove('image-grid');
      } else {
        grid.classList.add('image-grid');
        grid.classList.remove('image-list');
      }
    });
  });
}

function setupUpload(el: HTMLElement, poll: Poll) {
  const MAX = maxImages();
  const zone = document.getElementById('upload-zone')!;
  const input = document.getElementById('file-input')! as HTMLInputElement;
  const queue: File[] = [];
  let processing = false;
  const currentPoll = { value: poll };

  const queueStatus = () => {
    const uploaded = currentPoll.value.images.length;
    const remaining = MAX - uploaded;
    if (queue.length > 0) {
      zone.querySelector('p')!.textContent = `Queued ${queue.length} file(s) — ${uploaded}/${MAX} uploaded`;
    } else if (uploaded >= MAX) {
      zone.querySelector('p')!.textContent = `${MAX}/${MAX} images — limit reached`;
    } else {
      zone.querySelector('p')!.textContent = `Drag & drop images here, or click to browse (${uploaded}/${MAX})`;
    }
  };

  const appendImageCard = (img: Image) => {
    const grid = document.getElementById('image-grid')!;
    const card = document.createElement('div');
    card.className = 'image-card';
    card.dataset.img = img.id;
    const idx = currentPoll.value.images.length + 1;
    card.innerHTML = `
      <img src="/uploads/${img.filename}" alt="${escAttr(img.originalName)}">
      <span class="image-index">#${idx}</span>
      <span class="image-name">${escAttr(img.originalName)}</span>
      <button class="remove-btn" data-remove="${img.id}">&times;</button>
    `;
    card.querySelector('.remove-btn')!.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await api(`/polls/${pollId}/images/${img.id}`, { method: 'DELETE', headers: authHeaders(token) });
        card.remove();
        currentPoll.value.images = currentPoll.value.images.filter(i => i.id !== img.id);
        queueStatus();
      } catch (err: any) { showToast(err.message, 'error'); }
    });
    grid.appendChild(card);
  };

  const syncPoll = async () => {
    const fresh = await api<Poll>(`/polls/${pollId}`, { headers: authHeaders(token) });
    currentPoll.value = fresh;
  };

  const uploadOne = async (file: File): Promise<boolean> => {
    const limit = maxFileSize();
    if (file.size > limit) {
      const mb = Math.round(limit / (1024 * 1024) * 10) / 10;
      showToast(`File too large. Max ${mb} MB.`, 'error');
      return false;
    }
    const form = new FormData();
    form.append('image', file);
    try {
      const img = await api<Image>(`/polls/${pollId}/upload`, {
        method: 'POST',
        headers: authHeaders(token),
        body: form,
      });
      currentPoll.value.images.push(img);
      appendImageCard(img);
      return true;
    } catch (e: any) {
      showToast(e.message, 'error');
      await syncPoll();
      return false;
    }
  };

  const processQueue = async () => {
    if (processing) return;
    processing = true;
    while (queue.length > 0) {
      if (currentPoll.value.images.length >= MAX) {
        queue.length = 0;
        showToast(`Image limit of ${MAX} reached`, 'info');
        break;
      }
      const file = queue.shift()!;
      queueStatus();
      await uploadOne(file);
      await new Promise(r => setTimeout(r, 250));
    }
    processing = false;
    queueStatus();
  };

  const enqueue = (files: FileList | File[]) => {
    for (let i = 0; i < files.length; i++) {
      if (currentPoll.value.images.length + queue.length >= MAX) {
        showToast(`Can only accept ${MAX} images total. Some files skipped.`, 'info');
        break;
      }
      queue.push(files[i]);
    }
    queueStatus();
    processQueue();
  };

  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('dragover');
    if (e.dataTransfer?.files.length) enqueue(e.dataTransfer.files);
  });
  input.addEventListener('change', () => {
    if (input.files?.length) enqueue(input.files);
    input.value = '';
  });

  queueStatus();
}

function renderSettingsTab(poll: Poll) {
  const el = document.querySelector('[data-content="settings"]')!;
  el.innerHTML = `
    <div class="form-group">
      <label for="poll-title">Title</label>
      <input id="poll-title" value="${escHtml(poll.title)}" placeholder="My Image Poll">
    </div>
    <div class="form-group">
      <label for="poll-desc">Description</label>
      <textarea id="poll-desc" placeholder="Vote for your favorite!">${escHtml(poll.description)}</textarea>
    </div>
    <div class="form-group">
      <label for="poll-rounds">Number of Rounds</label>
      <input id="poll-rounds" type="number" min="1" max="100" value="${poll.rounds}">
    </div>
    <div class="form-group">
      <div class="checkbox-row">
        <input type="checkbox" id="poll-show-results" ${poll.showResults ? 'checked' : ''}>
        <label for="poll-show-results" class="checkbox-label">Show results to voters after voting</label>
      </div>
    </div>
    <div class="form-group">
      <div class="checkbox-row">
        <input type="checkbox" id="poll-show-labels" ${poll.showLabels ? 'checked' : ''}>
        <label for="poll-show-labels" class="checkbox-label">Show image numbers and filenames during voting</label>
      </div>
    </div>
  `;

  const collect = () => ({
    title: (document.getElementById('poll-title') as HTMLInputElement).value,
    description: (document.getElementById('poll-desc') as HTMLTextAreaElement).value,
    rounds: parseInt((document.getElementById('poll-rounds') as HTMLInputElement).value, 10),
    showResults: (document.getElementById('poll-show-results') as HTMLInputElement).checked,
    showLabels: (document.getElementById('poll-show-labels') as HTMLInputElement).checked,
  });

  let saveTimer: ReturnType<typeof setTimeout>;
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => doSave(), 600);
  };

  const doSave = async () => {
    try {
      await api(`/polls/${pollId}`, {
        method: 'PATCH',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify(collect()),
      });
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  };

  document.getElementById('poll-title')!.addEventListener('input', scheduleSave);
  document.getElementById('poll-desc')!.addEventListener('input', scheduleSave);
  document.getElementById('poll-rounds')!.addEventListener('input', scheduleSave);
  document.getElementById('poll-show-results')!.addEventListener('change', () => {
    clearTimeout(saveTimer);
    doSave();
  });
  document.getElementById('poll-show-labels')!.addEventListener('change', () => {
    clearTimeout(saveTimer);
    doSave();
  });
}

function renderSizeTab(poll: Poll) {
  const firstImg = poll.images[0];
  const W = poll.containerWidth;
  const H = poll.containerHeight;
  const PRESETS = [
    { w: 400, h: 300 }, { w: 600, h: 400 }, { w: 800, h: 500 },
    { w: 800, h: 600 }, { w: 1000, h: 700 }, { w: 1200, h: 800 },
    { w: 1400, h: 900 }, { w: 1600, h: 1000 },
  ];

  const el = document.querySelector('[data-content="size"]')!;
  el.innerHTML = `
    <div class="size-editor">
      <div class="size-controls">
        <div class="size-row">
          <span class="size-row-label">Presets</span>
          ${PRESETS.map(p => `
            <button class="size-preset" data-w="${p.w}" data-h="${p.h}">${p.w}&times;${p.h}</button>
          `).join('')}
        </div>
        <div class="size-row">
          <span class="size-row-label">Size</span>
          <span class="size-dim-label">W</span>
          <input id="container-w" class="size-dim-input" type="number" min="150" max="2000" value="${W}" step="10">
          <button id="lock-ar" class="btn btn-secondary" title="Lock aspect ratio" style="padding:2px 6px;font-size:0.85rem;min-width:28px">
            <span id="lock-icon">🔓</span>
          </button>
          <span class="size-dim-label">H</span>
          <input id="container-h" class="size-dim-input" type="number" min="150" max="2000" value="${H}" step="10">
          <span class="size-row-label" style="margin-left:12px">Fit</span>
          <div class="size-fit-group">
            <button class="size-fit-btn ${poll.fitMode === 'contain' ? 'active' : ''}" data-fit="contain">Fit within</button>
            <button class="size-fit-btn ${poll.fitMode === 'cover' ? 'active' : ''}" data-fit="cover">Fill</button>
            <button class="size-fit-btn ${poll.fitMode === 'scale-down' ? 'active' : ''}" data-fit="scale-down">Native</button>
          </div>
        </div>
        <div class="size-row">
          <label class="size-check-label">
            <input type="checkbox" id="allow-scrolling" ${poll.allowScrolling ? 'checked' : ''}>
            Allow scrolling (tall images scroll vertically)
          </label>
        </div>
        <div class="size-row">
          ${firstImg ? `<button class="btn btn-secondary" id="detect-size" style="font-size:0.8rem">Detect from images</button>` : ''}
          <span id="detect-info" style="display:none;font-size:0.75rem;color:var(--text-dim)"></span>
          <button class="btn btn-secondary" id="reset-size" style="font-size:0.85rem">Reset Default</button>
        </div>
      </div>
    </div>
  `;

  const wInput = document.getElementById('container-w') as HTMLInputElement;
  const hInput = document.getElementById('container-h') as HTMLInputElement;
  const lockIcon = document.getElementById('lock-icon')!;
  let fitMode: FitMode = poll.fitMode;
  let arLocked = false;
  let ar = W / H;

  // Remove old preview panel, create new one
  const oldPanel = document.getElementById('preview-panel');
  if (oldPanel) oldPanel.remove();
  const panel = document.createElement('div');
  panel.id = 'preview-panel';
  panel.className = 'preview-panel';
  panel.innerHTML = firstImg
    ? `<div class="preview-panel-inner" id="preview-inner" style="width:${W}px;height:${H}px">
         <img src="/uploads/${escAttr(firstImg.filename)}" alt="Preview" style="object-fit:${fitMode}">
          <span class="preview-panel-dims">${W} &times; ${H} &middot; ${fitMode === 'contain' ? 'fit' : fitMode === 'scale-down' ? 'native' : 'cover'}</span>
       </div>`
    : `<div class="preview-empty">Upload an image to preview</div>`;
  document.body.appendChild(panel);

  panel.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'IMG' && firstImg) {
      openLightbox((target as HTMLImageElement).src, imgLabel(poll.images, firstImg.id));
    }
  });

  const updatePreview = () => {
    const inner = document.getElementById('preview-inner');
    if (!inner) return;
    const w = parseInt(wInput.value, 10) || 200;
    const h = parseInt(hInput.value, 10) || 200;
    const scroll = (document.getElementById('allow-scrolling') as HTMLInputElement).checked;
    inner.style.width = w + 'px';
    inner.style.height = scroll ? 'auto' : (h + 'px');
    inner.style.maxHeight = scroll ? h + 'px' : '';
    inner.style.overflowY = scroll ? 'auto' : 'hidden';
    const img = inner.querySelector('img') as HTMLImageElement;
    if (img) {
      img.style.objectFit = fitMode;
      img.style.height = scroll ? 'auto' : '100%';
    }
    const dims = inner.querySelector('.preview-panel-dims')!;
    dims.textContent = `${w} \u00d7 ${h} \u00b7 ${fitMode === 'contain' ? 'fit' : fitMode === 'scale-down' ? 'native' : 'cover'}${scroll ? ' \u00b7 scroll' : ''}`;
  };

  const syncFromW = () => { if (arLocked) { hInput.value = Math.round(parseInt(wInput.value, 10) / ar).toString(); updatePreview(); } };
  const syncFromH = () => { if (arLocked) { wInput.value = Math.round(parseInt(hInput.value, 10) * ar).toString(); updatePreview(); } };

  document.getElementById('lock-ar')!.addEventListener('click', () => {
    arLocked = !arLocked;
    ar = parseInt(wInput.value, 10) / parseInt(hInput.value, 10);
    lockIcon.textContent = arLocked ? '🔒' : '🔓';
  });

  const detectBtn = document.getElementById('detect-size') as HTMLButtonElement | null;
  const detectInfo = document.getElementById('detect-info');
  if (detectBtn && detectInfo) {
    detectBtn.addEventListener('click', async () => {
      detectBtn.textContent = 'Scanning...';
      detectBtn.disabled = true;
      detectInfo.style.display = 'none';
      let maxW = 150, maxH = 150;
      const dims: { w: number; h: number }[] = [];
      const measure = (url: string): Promise<{ w: number; h: number }> => new Promise(resolve => {
        const img = new Image();
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => resolve({ w: 0, h: 0 });
        img.src = url;
      });
      for (const img of poll.images) {
        const d = await measure(`/uploads/${img.filename}`);
        if (d.w > 0) { dims.push(d); if (d.w > maxW) maxW = d.w; if (d.h > maxH) maxH = d.h; }
      }
      const clampedW = Math.min(Math.max(maxW, 200), 2000);
      const clampedH = Math.min(Math.max(maxH, 200), 2000);
      wInput.value = clampedW.toString();
      hInput.value = clampedH.toString();
      if (arLocked) ar = clampedW / clampedH;
      updatePreview();
      detectInfo.textContent = `max ${maxW}\u00d7${maxH} across ${dims.length} image(s) \u2192 ${clampedW}\u00d7${clampedH}`;
      detectInfo.style.display = 'inline';
      detectBtn.textContent = 'Detect from images';
      detectBtn.disabled = false;
    });
  }

  el.querySelectorAll('.size-fit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      fitMode = (btn as HTMLElement).dataset.fit as FitMode;
      el.querySelectorAll('.size-fit-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      updatePreview();
      saveSize();
    });
  });

  document.getElementById('allow-scrolling')!.addEventListener('change', () => {
    updatePreview();
    saveSize();
  });

  const collectSize = () => ({
    containerWidth: parseInt(wInput.value, 10),
    containerHeight: parseInt(hInput.value, 10),
    fitMode,
    allowScrolling: (document.getElementById('allow-scrolling') as HTMLInputElement).checked,
  });

  let sizeTimer: ReturnType<typeof setTimeout>;
  const saveSize = async () => {
    clearTimeout(sizeTimer);
    try {
      await api(`/polls/${pollId}`, {
        method: 'PATCH',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify(collectSize()),
      });
    } catch (e: any) { showToast(e.message, 'error'); }
  };

  wInput.addEventListener('input', () => {
    syncFromW();
    clearTimeout(sizeTimer);
    sizeTimer = setTimeout(() => saveSize(), 600);
  });
  hInput.addEventListener('input', () => {
    syncFromH();
    clearTimeout(sizeTimer);
    sizeTimer = setTimeout(() => saveSize(), 600);
  });

  el.querySelectorAll('.size-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const bw = parseInt((btn as HTMLElement).dataset.w!, 10);
      const bh = parseInt((btn as HTMLElement).dataset.h!, 10);
      wInput.value = bw.toString();
      hInput.value = bh.toString();
      if (arLocked) ar = bw / bh;
      updatePreview();
      saveSize();
    });
  });

  document.getElementById('reset-size')?.addEventListener('click', () => {
    wInput.value = '800'; hInput.value = '600';
    fitMode = 'contain';
    (document.getElementById('allow-scrolling') as HTMLInputElement).checked = false;
    el.querySelectorAll('.size-fit-btn').forEach(b => b.classList.remove('active'));
    el.querySelector('[data-fit="contain"]')?.classList.add('active');
    updatePreview();
    saveSize();
  });
}

function renderShareTab(_poll: Poll) {
  const el = document.querySelector('[data-content="share"]')!;
  const voteUrl = `${window.location.origin}/vote/${pollId}`;

  el.innerHTML = `
    <h3 style="margin-bottom:12px">Voter Link</h3>
    <div class="share-section">
      <div class="share-url" id="vote-url">${voteUrl}</div>
      <button class="btn btn-secondary" id="copy-vote">Copy</button>
    </div>
    <h3 style="margin-bottom:12px">Share Admin Panel</h3>
    <p style="color:var(--text-dim);margin-bottom:12px;font-size:0.85rem">
      Creates a read-only link for others to view results.
    </p>
    <div class="share-section">
      <div class="share-url" id="share-url">—</div>
      <button class="btn btn-primary" id="gen-share">Generate</button>
    </div>
  `;

  document.getElementById('copy-vote')!.addEventListener('click', () => {
    navigator.clipboard.writeText(voteUrl);
    showToast('Voter link copied!', 'success');
  });

  document.getElementById('gen-share')!.addEventListener('click', async () => {
    try {
      const data = await api<{ shareToken: string; shareUrl: string }>(`/polls/${pollId}/share`, {
        headers: authHeaders(token),
      });
      const surl = `${window.location.origin}${data.shareUrl}?share=${data.shareToken}`;
      document.getElementById('share-url')!.textContent = surl;
      showToast('Share link generated', 'success');
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  });
}

interface VoterData {
  name: string;
  fingerprint: string;
  votedAt: number;
  selections: Selection[];
}

async function renderMetadataTab() {
  const el = document.querySelector('[data-content="metadata"]')!;
  el.innerHTML = '<p style="color:var(--text-dim)">Loading...</p>';

  try {
    const [resData, votersData] = await Promise.all([
      api<{ totalVotes: number; imageStats: Record<string, { wins: number; appearances: number }>; poll: any }>(`/polls/${pollId}/results`, { headers: authHeaders(token) }),
      api<{ voters: VoterData[] }>(`/polls/${pollId}/voters`, { headers: authHeaders(token) }),
    ]);

    let html = '<div class="results-section"><h3 style="margin-bottom:16px">Results</h3>';
    html += `<p style="color:var(--text-dim);margin-bottom:16px">${resData.totalVotes} vote(s)</p>`;

    const sorted = [...resData.poll.images].sort((a: any, b: any) => {
      const sa = resData.imageStats[a.id];
      const sb = resData.imageStats[b.id];
      const pa = sa.appearances > 0 ? sa.wins / sa.appearances : 0;
      const pb = sb.appearances > 0 ? sb.wins / sb.appearances : 0;
      return pb - pa;
    });

    for (const img of sorted) {
      const stats = resData.imageStats[img.id];
      const pct = stats.appearances > 0
        ? Math.min(100, Math.max(0, Math.round((stats.wins / stats.appearances) * 100)))
        : 0;
      html += `
        <div class="results-bar">
          <img src="/uploads/${escAttr(img.filename)}" alt="" title="${escAttr(imgLabel(resData.poll.images, img.id))}">
          <div style="flex:1">
            <div style="font-size:0.8rem;margin-bottom:2px">${escHtml(imgLabel(resData.poll.images, img.id))}</div>
            <div class="results-bar-fill">
              <div class="results-bar-inner" style="width:${pct}%"></div>
            </div>
          </div>
          <div class="results-bar-label">${pct}% (${stats.wins}/${stats.appearances})</div>
        </div>
      `;
    }
    html += '</div>';

    html += '<h3 style="margin-top:32px;margin-bottom:12px">Voters</h3>';
    if (votersData.voters.length === 0) {
      html += '<p style="color:var(--text-dim)">No votes yet.</p>';
    } else {
      html += '<table><thead><tr><th>Voter</th><th>ID</th><th>Voted</th><th>Selections</th></tr></thead><tbody>';
      for (const v of votersData.voters) {
        html += `
          <tr class="voter-row" data-fp="${v.fingerprint}">
            <td>${escHtml(v.name)}</td>
            <td style="font-family:monospace;font-size:0.75rem">${v.fingerprint}</td>
            <td>${new Date(v.votedAt).toLocaleString()}</td>
            <td><button class="btn btn-secondary" style="padding:4px 10px;font-size:0.75rem" data-toggle="${v.fingerprint}">View (${v.selections.length})</button></td>
          </tr>
          <tr class="selections-detail" id="sel-${v.fingerprint}">
            <td colspan="4">
              ${v.selections.map((s, i) => {
                const leftImg = resData.poll.images.find((img: any) => img.id === s.leftImageId);
                const rightImg = resData.poll.images.find((img: any) => img.id === s.rightImageId);
                return `
                  <div class="sel-row">
                    <span>R${s.round + 1}</span>
                    ${leftImg ? `<img src="/uploads/${escAttr(leftImg.filename)}" class="${s.winnerId === leftImg.id ? 'winner' : 'loser'}" title="${escAttr(imgLabel(resData.poll.images, leftImg.id))}">` : ''}
                    <span>vs</span>
                    ${rightImg ? `<img src="/uploads/${escAttr(rightImg.filename)}" class="${s.winnerId === rightImg.id ? 'winner' : 'loser'}" title="${escAttr(imgLabel(resData.poll.images, rightImg.id))}">` : ''}
                  </div>
                `;
              }).join('')}
            </td>
          </tr>
        `;
      }
      html += '</tbody></table>';
    }

    el.innerHTML = html;

    el.querySelectorAll('[data-toggle]').forEach(btn => {
      btn.addEventListener('click', () => {
        const fp = (btn as HTMLElement).dataset.toggle!;
        document.getElementById(`sel-${fp}`)!.classList.toggle('open');
      });
    });

    el.querySelectorAll('.results-bar img, .sel-row img').forEach(img => {
      img.addEventListener('click', (e) => {
        e.stopPropagation();
        const el = img as HTMLImageElement;
        openLightbox(el.src, el.title || undefined);
      });
    });
  } catch (e: any) {
    el.innerHTML = `<p style="color:var(--danger)">Failed to load: ${escHtml(e.message)}</p>`;
  }
}

function imgIdx(images: { id: string }[], imageId: string): number {
  return images.findIndex(i => i.id === imageId) + 1;
}

function imgLabel(images: { id: string; originalName: string }[], imageId: string): string {
  return `#${imgIdx(images, imageId)} ${images.find(i => i.id === imageId)?.originalName || ''}`;
}
