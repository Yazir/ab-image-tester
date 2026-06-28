import { navigate, showToast } from '../main';
import { api, loadConfig, adminKeyRequired, adminKeyHeaders } from '../utils/api';

const GITHUB_URL = 'https://github.com/yazir/ab-image-tester';

export async function renderHome(container: HTMLElement) {
  await loadConfig();

  if (!adminKeyRequired) {
    container.innerHTML = `
      <div class="hero">
        <h2>A/B Test Your Images</h2>
        <p>Create a poll, upload images, and let voters pick their favorites in pairwise comparisons.</p>
        <button class="btn btn-primary" id="create-btn">Create New Poll</button>
      </div>
      <a href="${GITHUB_URL}" target="_blank" rel="noopener" class="github-link">GitHub</a>
    `;

    document.getElementById('create-btn')!.addEventListener('click', async () => {
      try {
        const btn = document.getElementById('create-btn') as HTMLButtonElement;
        btn.disabled = true;
        btn.textContent = 'Creating...';
        const data = await api<{ pollId: string; adminToken: string }>('/polls', { method: 'POST' });
        sessionStorage.setItem(`adminToken-${data.pollId}`, data.adminToken);
        navigate(`/admin/${data.pollId}`);
      } catch (e: any) {
        showToast(e.message || 'Failed to create poll', 'error');
        const btn = document.getElementById('create-btn') as HTMLButtonElement;
        btn.disabled = false;
        btn.textContent = 'Create New Poll';
      }
    });
    return;
  }

  container.innerHTML = `
    <div class="landing-page">
      <button class="poll-create-toggle" id="poll-create-toggle" title="Create Poll">+</button>
      <div class="landing-sidebar" id="poll-create-panel">
        <h3>Create Poll</h3>
        <input type="password" id="poll-key-input" placeholder="Enter poll create key" autocomplete="off">
        <button class="btn btn-secondary" id="create-btn">Create Poll</button>
      </div>
      <div class="landing-center">
        <div class="landing-hero">
          <h1>A/B Image Tester</h1>
          <p class="tagline">Coming Soon</p>
          <p class="subtitle">An A/B preference testing tool for images. Be the first to know when it launches.</p>
          <form class="waitlist-form" id="waitlist-form">
            <input type="email" id="waitlist-email" placeholder="Enter your email" required autocomplete="email">
            <button type="submit" class="btn btn-primary">Notify Me</button>
          </form>
          <div id="waitlist-msg"></div>
        </div>
      </div>
    </div>
    <a href="${GITHUB_URL}" target="_blank" rel="noopener" class="github-link">GitHub</a>
  `;

  const keyInput = document.getElementById('poll-key-input') as HTMLInputElement;
  const panel = document.getElementById('poll-create-panel')!;
  const toggle = document.getElementById('poll-create-toggle') as HTMLButtonElement;

  toggle.addEventListener('click', () => {
    const open = panel.classList.toggle('open');
    toggle.textContent = open ? '\u00D7' : '+';
  });

  document.addEventListener('click', (e) => {
    if (panel.classList.contains('open') && !panel.contains(e.target as Node) && e.target !== toggle) {
      panel.classList.remove('open');
      toggle.textContent = '+';
    }
  });

  document.getElementById('create-btn')!.addEventListener('click', async () => {
    try {
      const btn = document.getElementById('create-btn') as HTMLButtonElement;
      const key = keyInput.value.trim();
      if (!key) {
        showToast('Poll create key is required', 'error');
        return;
      }
      btn.disabled = true;
      btn.textContent = 'Creating...';
      const data = await api<{ pollId: string; adminToken: string }>('/polls', { method: 'POST', headers: adminKeyHeaders(key) });
      sessionStorage.setItem(`adminToken-${data.pollId}`, data.adminToken);
      navigate(`/admin/${data.pollId}`);
    } catch (e: any) {
      showToast(e.message || 'Failed to create poll', 'error');
      const btn = document.getElementById('create-btn') as HTMLButtonElement;
      btn.disabled = false;
      btn.textContent = 'Create New Poll';
    }
  });

  document.getElementById('waitlist-form')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = (document.getElementById('waitlist-email') as HTMLInputElement).value.trim();
    const msg = document.getElementById('waitlist-msg')!;
    if (!email || !email.includes('@')) {
      msg.className = 'waitlist-error';
      msg.textContent = 'Please enter a valid email';
      return;
    }
    try {
      await api('/waitlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
      msg.className = 'waitlist-success';
      msg.textContent = 'You are on the list!';
      (document.getElementById('waitlist-email') as HTMLInputElement).value = '';
    } catch (e: any) {
      msg.className = 'waitlist-error';
      msg.textContent = e.message || 'Something went wrong';
    }
  });
}
