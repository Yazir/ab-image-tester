import { navigate, showToast } from '../main';
import { api } from '../utils/api';

export function renderHome(container: HTMLElement) {
  container.innerHTML = `
    <div class="hero">
      <h2>A/B Test Your Images</h2>
      <p>Create a poll, upload images, and let voters pick their favorites in pairwise comparisons.</p>
      <button class="btn btn-primary" id="create-btn">Create New Poll</button>
    </div>
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
    }
  });
}
