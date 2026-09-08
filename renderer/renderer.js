const state = {
  clips: [],
  query: '',
  tab: 'all',
  activeId: null,
  status: { monitoring: true, primaryShortcut: false, fallbackShortcut: false, autoPaste: false },
};

const list = document.querySelector('#clip-list');
const searchInput = document.querySelector('#search-input');
const countBadge = document.querySelector('#count-badge');
const settingsMenu = document.querySelector('#settings-menu');
const settingsButton = document.querySelector('#settings-button');
const monitorToggle = document.querySelector('#monitor-toggle');
const monitorStatus = document.querySelector('#monitor-status');
const shortcutStatus = document.querySelector('#shortcut-status');
const toast = document.querySelector('#toast');
let toastTimer;

function filteredClips() {
  const term = state.query.trim().toLocaleLowerCase();
  return state.clips.filter((clip) => {
    if (state.tab === 'pinned' && !clip.pinned) return false;
    if (!term) return true;
    return `${clip.value} ${clip.label}`.toLocaleLowerCase().includes(term);
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatTime(timestamp) {
  const delta = Date.now() - timestamp;
  if (delta < 60_000) return '刚刚';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`;
  return new Date(timestamp).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

function clipTitle(clip) {
  if (clip.type === 'link') {
    try { return new URL(clip.value).hostname; } catch { return '链接'; }
  }
  if (clip.type === 'color') return '颜色值';
  if (clip.type === 'image') return '剪贴板图片';
  const firstLine = clip.value.split(/\r?\n/)[0].trim();
  return firstLine.length > 25 ? `${firstLine.slice(0, 25)}…` : firstLine || '文本';
}

function typeIcon(clip) {
  if (clip.type === 'link') return '<div class="type-icon link">↗</div>';
  if (clip.type === 'image') return '<div class="type-icon image">▧</div>';
  if (clip.type === 'color') return `<div class="type-icon color"><i style="background:${escapeHtml(clip.value)}"></i></div>`;
  return '<div class="type-icon">≡</div>';
}

function renderClip(clip) {
  const preview = clip.type === 'image'
    ? `<img class="clip-image" src="${escapeHtml(clip.preview)}" alt="剪贴板图片预览" />`
    : `<p class="clip-preview ${clip.type === 'link' ? 'link' : ''}">${escapeHtml(clip.value)}</p>`;
  return `
    <article class="clip-card ${clip.type === 'image' ? 'with-image' : ''} ${state.activeId === clip.id ? 'active' : ''}" data-id="${clip.id}" role="option" aria-selected="${state.activeId === clip.id}" tabindex="0">
      ${typeIcon(clip)}
      <div class="clip-content">
        <strong>${escapeHtml(clipTitle(clip))}</strong>
        ${preview}
        <div class="clip-meta"><span>${escapeHtml(formatTime(clip.createdAt))}</span><i></i><span>${escapeHtml(clip.label)}</span></div>
      </div>
      ${clip.pinned ? '<span class="pin-mark" title="已固定">⌖</span>' : ''}
      <div class="card-actions">
        <button class="card-action pin" data-action="pin" aria-label="${clip.pinned ? '取消固定' : '固定'}" title="${clip.pinned ? '取消固定' : '固定'}">⌖</button>
        <button class="card-action delete" data-action="delete" aria-label="删除" title="删除">×</button>
      </div>
    </article>`;
}

function render() {
  const visible = filteredClips();
  if (!visible.some((clip) => clip.id === state.activeId)) state.activeId = visible[0]?.id ?? null;
  countBadge.textContent = `${visible.length} 项`;
  if (!visible.length) {
    const isSearch = Boolean(state.query.trim());
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">▣</div>
        <h2>${isSearch ? '没有找到匹配内容' : state.tab === 'pinned' ? '还没有固定项目' : '剪贴板历史为空'}</h2>
        <p>${isSearch ? '换个关键词试试。' : '在其他应用中复制文本、链接、颜色或图片，它们会自动出现在这里。'}</p>
        ${isSearch ? '' : '<div><kbd>Win</kbd><kbd>V</kbd></div>'}
      </div>`;
  } else {
    list.innerHTML = visible.map(renderClip).join('');
  }
}

function renderStatus() {
  monitorToggle.setAttribute('aria-checked', String(state.status.monitoring));
  monitorStatus.classList.toggle('paused', !state.status.monitoring);
  monitorStatus.innerHTML = `<span class="status-dot"></span>${state.status.monitoring ? '正在监听' : '监听已暂停'}`;
  if (state.status.primaryShortcut) {
    shortcutStatus.innerHTML = '<kbd>Win</kbd><b>+</b><kbd>V</kbd>';
    shortcutStatus.title = '全局快捷键已启用';
  } else {
    shortcutStatus.textContent = '点击托盘图标打开';
    shortcutStatus.title = '全局快捷键注册失败';
  }
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 5000);
}

async function chooseClip(id) {
  try {
    const result = await window.winV.pasteClip(id);
    if (result.message) showToast(result.message);
    else if (!result.ok) showToast('该记录已不存在');
  } catch {
    showToast('粘贴失败，请重试');
  }
}

list.addEventListener('click', async (event) => {
  const card = event.target.closest('.clip-card');
  if (!card) return;
  const id = card.dataset.id;
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'pin') {
    event.stopPropagation();
    await window.winV.togglePin(id);
    return;
  }
  if (action === 'delete') {
    event.stopPropagation();
    await window.winV.removeClip(id);
    showToast('已删除');
    return;
  }
  await chooseClip(id);
});

list.addEventListener('focusin', (event) => {
  const card = event.target.closest('.clip-card');
  if (!card) return;
  state.activeId = card.dataset.id;
  list.querySelectorAll('.clip-card').forEach((element) => element.classList.toggle('active', element.dataset.id === state.activeId));
});

searchInput.addEventListener('input', () => {
  state.query = searchInput.value;
  render();
});

document.querySelectorAll('.tab').forEach((button) => {
  button.addEventListener('click', () => {
    state.tab = button.dataset.tab;
    document.querySelectorAll('.tab').forEach((tab) => {
      const active = tab === button;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    render();
  });
});

settingsButton.addEventListener('click', () => { settingsMenu.hidden = !settingsMenu.hidden; });
document.querySelector('#close-button').addEventListener('click', () => window.winV.hide());
document.querySelector('#clear-button').addEventListener('click', async () => {
  await window.winV.clearHistory();
  settingsMenu.hidden = true;
  showToast('已清除未固定记录');
});
monitorToggle.addEventListener('click', async () => {
  state.status = await window.winV.setMonitoring(!state.status.monitoring);
  renderStatus();
});

document.addEventListener('pointerdown', (event) => {
  if (!settingsMenu.hidden && !settingsMenu.contains(event.target) && !settingsButton.contains(event.target)) settingsMenu.hidden = true;
});

document.addEventListener('keydown', async (event) => {
  if (event.key === 'Escape') {
    if (!settingsMenu.hidden) settingsMenu.hidden = true;
    else window.winV.hide();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
    event.preventDefault();
    searchInput.focus();
    searchInput.select();
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Enter', 'Delete'].includes(event.key) || document.activeElement === searchInput) return;
  const visible = filteredClips();
  if (!visible.length) return;
  if (event.key === 'Enter') {
    event.preventDefault();
    if (state.activeId) await chooseClip(state.activeId);
    return;
  }
  if (event.key === 'Delete') {
    event.preventDefault();
    if (state.activeId) await window.winV.removeClip(state.activeId);
    return;
  }
  event.preventDefault();
  const current = Math.max(0, visible.findIndex((clip) => clip.id === state.activeId));
  const delta = event.key === 'ArrowDown' ? 1 : -1;
  state.activeId = visible[(current + delta + visible.length) % visible.length].id;
  render();
  list.querySelector(`[data-id="${state.activeId}"]`)?.scrollIntoView({ block: 'nearest' });
});

window.winV.onClipsUpdated((clips) => {
  state.clips = clips;
  render();
});
window.winV.onStatusUpdated((status) => {
  state.status = status;
  renderStatus();
});
window.winV.onWindowShown(() => {
  settingsMenu.hidden = true;
  const first = list.querySelector('.clip-card');
  first?.focus({ preventScroll: true });
});

Promise.all([window.winV.getClips(), window.winV.getStatus()]).then(([clips, status]) => {
  state.clips = clips;
  state.status = status;
  render();
  renderStatus();
});
