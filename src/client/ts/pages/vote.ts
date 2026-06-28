import { showToast, openLightbox } from '../main';
import { api, voterHeaders, storeVoterToken } from '../utils/api';
import { escHtml } from '../utils/sanitize';
import type { Pairing, Poll } from '../types';

interface VotePageState {
  poll: Poll | null;
  pairings: Pairing[];
  currentRound: number;
  selections: Array<{ round: number; leftImageId: string; rightImageId: string; winnerId: string }>;
  animating: boolean;
  keyHandler: ((e: KeyboardEvent) => void) | null;
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
      renderPostVote(container, pollId);
      return;
    }

    const data = await api<{ pairings: Pairing[]; totalRounds: number; voterToken: string }>(`/polls/${pollId}/pairings`, { headers: vh });
    if (data.voterToken) storeVoterToken(data.voterToken);
    state.pairings = data.pairings;
    state.currentRound = 0;
    state.selections = [];
    state.animating = false;

    renderIntroScreen(container);
  } catch (e: any) {
    container.innerHTML = `<div class="vote-hero"><h2>Error</h2><p>${escHtml(e.message)}</p></div>`;
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
    </div>
  `;

  document.getElementById('start-vote')!.addEventListener('click', () => {
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

  for (let i = 0; i < state.pairings.length; i++) {
    const dot = document.createElement('div');
    dot.className = 'progress-dot';
    dot.id = `progress-dot-${i}`;
    if (i === 0) dot.classList.add('current');
    bar.appendChild(dot);
  }

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
  stage.innerHTML = `
    <div class="round-counter">Round ${state.currentRound + 1} / ${state.pairings.length}</div>
    <div class="vote-option left" id="vote-left" data-side="left">
      <img src="/uploads/${pairing.left.filename}" alt="${escHtml(pairing.left.originalName)}" draggable="false">
      <div class="option-label">${escHtml(imgLabel(p.images, pairing.left.id))}</div>
    </div>
    <div class="vote-vs">VS</div>
    <div class="vote-option right" id="vote-right" data-side="right">
      <img src="/uploads/${pairing.right.filename}" alt="${escHtml(pairing.right.originalName)}" draggable="false">
      <div class="option-label">${escHtml(imgLabel(p.images, pairing.right.id))}</div>
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
    renderPostVote(container, pollId);
  } catch (e: any) {
    showToast(e.message, 'error');
    container.innerHTML = `<div class="vote-hero"><h2>Error submitting</h2><p>${escHtml(e.message)}</p></div>`;
  }
}

function renderPostVote(container: HTMLElement, pollId: string) {
  const p = state.poll!;
  container.innerHTML = `
    <div class="vote-hero">
      <h2>${escHtml(p.title || 'Poll')}</h2>
      <p>Thank you for voting!</p>
    </div>
  `;
}
