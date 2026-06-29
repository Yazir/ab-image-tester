import { showToast, openLightbox } from '../main';
import { api, voterHeaders, storeVoterToken } from '../utils/api';
import { escHtml, escAttr } from '../utils/sanitize';
import type { Image, Pairing, Poll } from '../types';

const GITHUB_URL = 'https://github.com/yazir/ab-image-tester';

interface VotePageState {
  poll: Poll | null;
  pairings: Pairing[];
  currentRound: number;
  selections: Array<{ round: number; leftImageId: string; rightImageId: string; winnerId: string }>;
  animating: boolean;
  keyHandler: ((e: KeyboardEvent) => void) | null;
}

const PROGRESS_PREFIX = 'vote_progress_';

function saveProgress(pollId: string, selections: Array<{ round: number; leftImageId: string; rightImageId: string; winnerId: string }>) {
  localStorage.setItem(PROGRESS_PREFIX + pollId, JSON.stringify(selections));
}

function loadProgress(pollId: string): Array<{ round: number; leftImageId: string; rightImageId: string; winnerId: string }> | null {
  const raw = localStorage.getItem(PROGRESS_PREFIX + pollId);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

function clearProgress(pollId: string) {
  localStorage.removeItem(PROGRESS_PREFIX + pollId);
}

const state: VotePageState = {
  poll: null,
  pairings: [],
  currentRound: 0,
  selections: [],
  animating: false,
  keyHandler: null,
};

function teardownStage() {
  const stage = document.getElementById('vote-stage');
  if (stage) stage.remove();
  const bar = document.getElementById('progress-sidebar');
  if (bar) bar.remove();
  if (state.keyHandler) {
    window.removeEventListener('keydown', state.keyHandler);
    state.keyHandler = null;
  }
}

export function renderVote(container: HTMLElement, pollId: string) {
  teardownStage();
  container.innerHTML = '<div class="vote-hero"><p>Loading...</p></div>';
  loadVote(container, pollId);
}

function validatePartialSelections(savedSelections: Array<{ round: number; leftImageId: string; rightImageId: string; winnerId: string }>, pairings: Pairing[]): boolean {
  if (savedSelections.length > pairings.length) return false;
  for (let i = 0; i < savedSelections.length; i++) {
    const sel = savedSelections[i];
    const pairing = pairings[i];
    if (sel.round !== pairing.round) return false;
    const actualIds = new Set([pairing.left.id, pairing.right.id]);
    if (!actualIds.has(sel.leftImageId)) return false;
    if (!actualIds.has(sel.rightImageId)) return false;
    if (!actualIds.has(sel.winnerId)) return false;
  }
  return true;
}

async function loadVote(container: HTMLElement, pollId: string) {
  try {
    const vh = voterHeaders();
    const { voted } = await api<{ voted: boolean }>(`/polls/${pollId}/voted`, { headers: vh });

    state.poll = await api<Poll>(`/polls/view/${pollId}`);

    if (state.poll.images.length < 2) {
      container.innerHTML = `<div class="vote-hero"><h2>${escHtml(state.poll.title || 'Poll')}</h2><p>Not enough images yet. The host needs to upload at least 2.</p></div>`;
      return;
    }

    if (voted) {
      clearProgress(pollId);
      renderPostVote(container, pollId);
      return;
    }

    const data = await api<{ pairings: Pairing[]; totalRounds: number; voterToken: string }>(`/polls/${pollId}/pairings`, { headers: vh });
    if (data.voterToken) storeVoterToken(data.voterToken);
    state.pairings = data.pairings;

    const savedSelections = loadProgress(pollId);
    if (savedSelections && validatePartialSelections(savedSelections, state.pairings)) {
      state.selections = savedSelections;
      state.currentRound = savedSelections.length;
      state.animating = false;
      container.innerHTML = '';
      renderProgressSidebar();
      renderStage();
      return;
    }

    clearProgress(pollId);
    state.currentRound = 0;
    state.selections = [];
    state.animating = false;

    renderIntroScreen(container);
  } catch (e: any) {
    const msg = e.message || '';
    if (msg.includes('IP vote limit')) {
      container.innerHTML = `<div class="vote-hero"><h2>${escHtml(state.poll?.title || 'Poll')}</h2><p>Vote limit reached. ${escHtml(msg)}</p><p style="color:var(--text-dim);margin-top:8px">Only a limited number of votes are allowed per network.</p></div>`;
    } else {
      container.innerHTML = `<div class="vote-hero"><h2>Error</h2><p>${escHtml(msg)}</p></div>`;
    }
  }
}

function imgIdx(images: { id: string }[], imageId: string): number {
  return images.findIndex(i => i.id === imageId) + 1;
}

function imgLabel(images: { id: string; originalName: string }[], imageId: string): string {
  return `#${imgIdx(images, imageId)} ${images.find(i => i.id === imageId)?.originalName || ''}`;
}

function renderIntroScreen(container: HTMLElement) {
  const p = state.poll!;
  container.innerHTML = `
    <div class="vote-hero">
      <h2>${escHtml(p.title || 'Image Poll')}</h2>
      <p>${escHtml(p.description || 'Pick your favorites!')}</p>
      <div class="image-count">${p.images.length} images &middot; ${state.pairings.length} rounds</div>
      <button class="btn btn-primary" id="start-vote">Start Voting</button>
      <a href="${GITHUB_URL}" target="_blank" rel="noopener" class="github-link">GitHub</a>
    </div>
  `;

  document.getElementById('start-vote')!.addEventListener('click', () => {
    container.innerHTML = '';
    renderProgressSidebar();
    renderStage();
  });
}

function renderProgressSidebar() {
  const existing = document.getElementById('progress-sidebar');
  if (existing) existing.remove();

  const bar = document.createElement('div');
  bar.id = 'progress-sidebar';
  bar.className = 'progress-sidebar';

  const dots = document.createElement('div');
  dots.className = 'progress-dots';

  for (let i = 0; i < state.pairings.length; i++) {
    const dot = document.createElement('div');
    dot.className = 'progress-dot';
    dot.id = `progress-dot-${i}`;
    if (i === 0) dot.classList.add('current');
    dots.appendChild(dot);
  }
  bar.appendChild(dots);

  const label = document.createElement('span');
  label.className = 'progress-label';
  label.id = 'progress-label';
  label.textContent = `Rounds 1 / ${state.pairings.length}`;
  bar.appendChild(label);

  document.body.appendChild(bar);
}

function updateProgress() {
  for (let i = 0; i < state.pairings.length; i++) {
    const dot = document.getElementById(`progress-dot-${i}`);
    if (!dot) continue;
    dot.className = 'progress-dot';
    if (i < state.currentRound) dot.classList.add('done');
    if (i === state.currentRound) dot.classList.add('current');
  }
  const label = document.getElementById('progress-label');
  if (label) {
    label.textContent = `Rounds ${state.currentRound + 1} / ${state.pairings.length}`;
  }
}

function renderStage() {
  if (state.currentRound >= state.pairings.length) {
    submitVotes();
    return;
  }

  const pairing = state.pairings[state.currentRound];
  const p = state.poll!;

  const oldStage = document.getElementById('vote-stage');
  if (oldStage) oldStage.remove();
  if (state.keyHandler) {
    window.removeEventListener('keydown', state.keyHandler);
    state.keyHandler = null;
  }

  const stage = document.createElement('div');
  stage.id = 'vote-stage';
  stage.className = 'vote-stage';
  stage.style.setProperty('--container-w', `${p.containerWidth}px`);
  stage.style.setProperty('--container-h', `${p.containerHeight}px`);
  stage.style.setProperty('--fit-mode', p.fitMode);
  const scrollClass = p.allowScrolling ? ' allow-scroll' : '';
  stage.innerHTML = `
    <div class="vote-option left${scrollClass}" id="vote-left" data-side="left">
      <img src="/uploads/${escAttr(pairing.left.filename)}" alt="${escHtml(pairing.left.originalName)}" draggable="false">
      ${p.showLabels ? `<div class="option-label">${escHtml(imgLabel(p.images, pairing.left.id))}</div>` : ''}
    </div>
    <div class="vote-vs">VS</div>
    <div class="vote-option right${scrollClass}" id="vote-right" data-side="right">
      <img src="/uploads/${escAttr(pairing.right.filename)}" alt="${escHtml(pairing.right.originalName)}" draggable="false">
      ${p.showLabels ? `<div class="option-label">${escHtml(imgLabel(p.images, pairing.right.id))}</div>` : ''}
    </div>
  `;
  document.body.appendChild(stage);

  updateProgress();

  const leftEl = document.getElementById('vote-left')!;
  const rightEl = document.getElementById('vote-right')!;

  const choose = (side: 'left' | 'right') => {
    if (state.animating) return;
    state.animating = true;

    const winner = side === 'left' ? pairing.left : pairing.right;
    state.selections.push({
      round: state.currentRound,
      leftImageId: pairing.left.id,
      rightImageId: pairing.right.id,
      winnerId: winner.id,
    });

    saveProgress(state.poll!.id, state.selections);

    if (side === 'left') {
      leftEl.classList.add('smack-winner');
      rightEl.classList.add('smack-loser');
    } else {
      rightEl.classList.add('smack-winner');
      leftEl.classList.add('smack-loser');
    }

    setTimeout(() => {
      state.currentRound++;
      state.animating = false;
      renderStage();
    }, 500);
  };

  leftEl.addEventListener('click', () => choose('left'));
  rightEl.addEventListener('click', () => choose('right'));

  const keyHandler = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') choose('left');
    else if (e.key === 'ArrowRight') choose('right');
  };
  window.addEventListener('keydown', keyHandler);
  state.keyHandler = keyHandler;
}

async function submitVotes() {
  const pollId = state.poll!.id;
  teardownStage();

  const container = document.getElementById('app-content')!;
  try {
    await api(`/polls/${pollId}/vote`, {
      method: 'POST',
      headers: { ...voterHeaders(), 'Content-Type': 'application/json', 'Origin': window.location.origin },
      body: JSON.stringify({ selections: state.selections }),
    });
    clearProgress(pollId);
    renderPostVote(container, pollId);
  } catch (e: any) {
    showToast(e.message, 'error');
    container.innerHTML = `<div class="vote-hero"><h2>Error submitting</h2><p>${escHtml(e.message)}</p></div>`;
  }
}

function renderPostVote(container: HTMLElement, pollId: string) {
  const p = state.poll!;
  const alreadyVoted = !state.selections.length;
  const msg = alreadyVoted ? 'You have already voted.' : 'Thank you for voting!';
  const resultsBtn = p.showResults
    ? `<button class="btn btn-primary" id="show-results">Show Results</button>`
    : '';
  container.innerHTML = `
    <div class="vote-hero">
      <h2>${escHtml(p.title || 'Poll')}</h2>
      <p>${escHtml(msg)}</p>
      ${resultsBtn}
    </div>
  `;
  if (p.showResults) {
    document.getElementById('show-results')!.addEventListener('click', () => {
      renderResults(container, pollId);
    });
  }
}

async function renderResults(container: HTMLElement, pollId: string) {
  container.innerHTML = '<div class="vote-hero"><p>Loading results...</p></div>';

  try {
    const data = await api<{
      poll: { id: string; title: string; description: string; images: Image[]; rounds: number };
      totalVotes: number;
      imageStats: Record<string, { wins: number; appearances: number }>;
    }>(`/polls/${pollId}/results`);

    const sorted = [...data.poll.images].sort((a, b) => {
      const sa = data.imageStats[a.id];
      const sb = data.imageStats[b.id];
      const pa = sa.appearances > 0 ? sa.wins / sa.appearances : 0;
      const pb = sb.appearances > 0 ? sb.wins / sb.appearances : 0;
      return pb - pa;
    });

    let html = `
      <div class="vote-hero" style="padding:24px 20px">
        <h2>${escHtml(data.poll.title || 'Poll')} — Results</h2>
        <p style="color:var(--text-dim);margin-bottom:24px">${data.totalVotes} vote(s)</p>
        <div class="results-grid">
    `;

    for (const img of sorted) {
      const stats = data.imageStats[img.id];
      const pct = stats.appearances > 0
        ? Math.min(100, Math.max(0, Math.round((stats.wins / stats.appearances) * 100)))
        : 0;
      html += `
        <div class="results-card">
          <div class="results-card-img">
            <img src="/uploads/${escAttr(img.filename)}" alt="${escHtml(img.originalName)}" draggable="false">
          </div>
          <div class="results-card-info">
            <div class="results-card-name" title="${escAttr(img.originalName)}">${escHtml(img.originalName)}</div>
            <div class="results-bar-fill">
              <div class="results-bar-inner" style="width:${pct}%"></div>
            </div>
            <div class="results-card-stat">${pct}% — ${stats.wins}/${stats.appearances} wins</div>
          </div>
        </div>
      `;
    }

    html += '</div></div>';
    container.innerHTML = html;

    container.querySelectorAll('.results-card-img img').forEach(img => {
      img.addEventListener('click', () => {
        openLightbox((img as HTMLImageElement).src);
      });
    });
  } catch (e: any) {
    container.innerHTML = `<div class="vote-hero"><h2>Error</h2><p>${escHtml(e.message)}</p></div>`;
  }
}
