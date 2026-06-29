import { renderHome } from './pages/home';
import { renderAdmin } from './pages/admin';
import { renderVote } from './pages/vote';
import { renderConsole } from './pages/console';
import { escHtml, escAttr } from './utils/sanitize';
const content = document.getElementById('app-content');
function route() {
    const path = window.location.pathname;
    const panel = document.getElementById('preview-panel');
    if (panel)
        panel.remove();
    const toggleBtn = document.getElementById('preview-toggle-btn');
    if (toggleBtn)
        toggleBtn.remove();
    const stage = document.getElementById('vote-stage');
    if (stage)
        stage.remove();
    const bar = document.getElementById('progress-sidebar');
    if (bar)
        bar.remove();
    if (path === '/') {
        renderHome(content);
    }
    else if (path === '/console') {
        renderConsole(content);
    }
    else if (path.startsWith('/admin/')) {
        const pollId = path.split('/admin/')[1];
        renderAdmin(content, pollId);
    }
    else if (path.startsWith('/vote/')) {
        const pollId = path.split('/vote/')[1];
        renderVote(content, pollId);
    }
    else {
        content.innerHTML = `<div class="hero"><h2>404</h2><p>Page not found</p></div>`;
    }
}
window.addEventListener('popstate', route);
window.addEventListener('DOMContentLoaded', route);
export function navigate(url) {
    history.pushState({}, '', url);
    route();
}
export function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.remove();
    }, 3500);
}
export function openLightbox(src, subtitle) {
    const existing = document.querySelector('.lightbox-overlay');
    if (existing)
        existing.remove();
    const overlay = document.createElement('div');
    overlay.className = 'lightbox-overlay';
    overlay.innerHTML = `<img src="${escAttr(src)}" alt="">${subtitle ? `<span class="lightbox-subtitle">${escHtml(subtitle)}</span>` : ''}`;
    overlay.addEventListener('click', () => overlay.remove());
    document.addEventListener('keydown', function closeOnEsc(e) {
        if (e.key === 'Escape') {
            overlay.remove();
            document.removeEventListener('keydown', closeOnEsc);
        }
    });
    document.body.appendChild(overlay);
}
