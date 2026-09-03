/**
 * Drive 前端逻辑（TypeScript）
 *
 * 行为：
 *   - 列表：GET /api/files?prefix=...
 *   - 上传：POST /api/files（multipart）
 *   - 新建文件夹：POST /api/folder
 *   - 重命名：PATCH /api/files
 *   - 删除：DELETE /api/files
 *   - 登录/登出：POST /api/auth/{login,logout}
 *   - 预览：GET /api/preview?path=...（不下载）
 *
 * 交互约定：
 *   - 文件夹：点行主区域 = 进入
 *   - 文件：行主区域不触发预览，避免误触；点行右侧「预览 / 下载 / 重命名 / 删除」
 *   - 重命名 / 删除 / 新建文件夹：全部走自定义 dialog（不走原生 prompt/confirm）
 */

interface DriveItem {
  key: string;
  name: string;
  folder: boolean;
  size?: number;
  uploaded?: string;
}

interface DriveListResponse {
  prefix: string;
  folders: DriveItem[];
  files: DriveItem[];
}

interface SessionResponse {
  authenticated: boolean;
}

// ---- 图标（按文件类型） ----
const ICON_FOLDER =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4h4l2 2h7A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5v-11Z"/></svg>';
const ICON_FILE_DEFAULT =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>';
const ICON_FILE_IMAGE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="M3 17l5-5 4 4 3-3 6 6"/></svg>';
const ICON_FILE_VIDEO =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="14" height="14" rx="2"/><path d="M17 9l4-2v10l-4-2z"/></svg>';
const ICON_FILE_AUDIO =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V6l11-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>';
const ICON_FILE_PDF =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><text x="8" y="17" font-size="6" font-weight="700" fill="currentColor" stroke="none">PDF</text></svg>';
const ICON_FILE_CODE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 18l6-6-6-6"/><path d="M8 6l-6 6 6 6"/></svg>';
const ICON_FILE_TEXT =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/></svg>';
const ICON_FILE_ARCHIVE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></svg>';

/** 根据文件名返回 (svg, modifier class) */
function fileIcon(name: string): { svg: string; kind: string } {
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'heic'].includes(ext)) return { svg: ICON_FILE_IMAGE, kind: 'image' };
  if (['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v'].includes(ext)) return { svg: ICON_FILE_VIDEO, kind: 'video' };
  if (['mp3', 'wav', 'flac', 'ogg', 'm4a', 'opus', 'aac'].includes(ext)) return { svg: ICON_FILE_AUDIO, kind: 'audio' };
  if (ext === 'pdf') return { svg: ICON_FILE_PDF, kind: 'pdf' };
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz'].includes(ext)) return { svg: ICON_FILE_ARCHIVE, kind: 'archive' };
  if (
    [
      'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'json', 'jsonc', 'json5',
      'css', 'scss', 'less', 'html', 'htm', 'xml', 'svg', 'vue', 'svelte',
      'py', 'rb', 'rs', 'go', 'java', 'kt', 'swift', 'c', 'cc', 'cpp', 'h', 'hpp', 'm', 'mm',
      'php', 'sh', 'bash', 'zsh', 'ps1', 'sql', 'lua', 'r', 'dart', 'toml', 'yaml', 'yml',
    ].includes(ext)
  ) {
    return { svg: ICON_FILE_CODE, kind: 'code' };
  }
  if (['txt', 'md', 'markdown', 'log', 'csv', 'tsv', 'ini', 'conf', 'env', 'rst'].includes(ext)) {
    return { svg: ICON_FILE_TEXT, kind: 'text' };
  }
  return { svg: ICON_FILE_DEFAULT, kind: 'file' };
}

const root = document.documentElement;
let prefix = '';
let authenticated = false;

const $ = <T extends Element>(sel: string) => root.querySelector(sel) as T | null;

const refs = {
  modeReadonly: $('[data-account-readonly]') as HTMLElement,
  modeAuth: $('[data-account-auth]') as HTMLElement,
  login: $('[data-login]') as HTMLButtonElement,
  logout: $('[data-logout]') as HTMLButtonElement,
  tools: $('[data-tools]') as HTMLElement,
  crumb: $('[data-crumb]') as HTMLElement,
  up: $('[data-up]') as HTMLButtonElement,
  list: $('[data-list]') as HTMLElement,
  notice: $('[data-notice]') as HTMLElement,
  upload: $('#upload') as HTMLInputElement,
  newFolderBtn: $('[data-new-folder]') as HTMLButtonElement,
  rowTpl: $('[data-row-template]') as HTMLTemplateElement,
  // 登录
  loginDialog: $('[data-login-dialog]') as HTMLDialogElement,
  loginForm: $('[data-login-form]') as HTMLFormElement,
  loginKey: $('[data-key]') as HTMLInputElement,
  loginCancel: $('[data-cancel]') as HTMLButtonElement,
  // 通用 prompt
  promptDialog: $('[data-prompt-dialog]') as HTMLDialogElement,
  promptForm: $('[data-prompt-form]') as HTMLFormElement,
  promptTitle: $('[data-prompt-title]') as HTMLElement,
  promptLabel: $('[data-prompt-label]') as HTMLElement,
  promptInput: $('[data-prompt-input]') as HTMLInputElement,
  promptHint: $('[data-prompt-hint]') as HTMLElement,
  promptCancel: $('[data-prompt-cancel]') as HTMLButtonElement,
  promptConfirm: $('[data-prompt-confirm]') as HTMLButtonElement,
  // 确认
  confirmDialog: $('[data-confirm-dialog]') as HTMLDialogElement,
  confirmForm: $('[data-confirm-form]') as HTMLFormElement,
  confirmTitle: $('[data-confirm-title]') as HTMLElement,
  confirmBody: $('[data-confirm-body]') as HTMLElement,
  confirmCancel: $('[data-confirm-cancel]') as HTMLButtonElement,
  confirmOk: $('[data-confirm-ok]') as HTMLButtonElement,
  // 预览
  preview: $('[data-preview]') as HTMLDialogElement,
  previewName: $('[data-preview-name]') as HTMLElement,
  previewBody: $('[data-preview-body]') as HTMLElement,
  previewNote: $('[data-preview-note]') as HTMLElement,
  previewDownload: $('[data-preview-download]') as HTMLAnchorElement,
  previewClose: $('[data-preview-close]') as HTMLButtonElement,
};

function notice(message = '') {
  if (!refs.notice) return;
  refs.notice.textContent = message;
}

function formatSize(size?: number): string {
  if (!size) return '—';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : ({} as T);
  if (!response.ok) throw new Error((data as { error?: string }).error || '请求失败');
  return data;
}

// ---------- 自定义 dialog 辅助 ----------

/** 打开一个输入型 dialog，返回用户输入的字符串（取消/空返回 null） */
function openPrompt(opts: { title: string; label: string; initial?: string; hint?: string; confirmText?: string }): Promise<string | null> {
  return new Promise((resolve) => {
    refs.promptTitle.textContent = opts.title;
    refs.promptLabel.textContent = opts.label;
    refs.promptInput.value = opts.initial ?? '';
    refs.promptHint.textContent = opts.hint ?? '';
    refs.promptConfirm.textContent = opts.confirmText ?? '确认';

    let settled = false;
    const cleanup = () => {
      refs.promptForm.removeEventListener('submit', onSubmit);
      refs.promptCancel.removeEventListener('click', onCancel);
      refs.promptDialog.removeEventListener('close', onClose);
    };
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      refs.promptDialog.close();
      resolve(value);
    };
    const onSubmit = (e: Event) => {
      e.preventDefault();
      const v = refs.promptInput.value.trim();
      if (!v) return;
      finish(v);
    };
    const onCancel = () => finish(null);
    const onClose = () => {
      if (!settled) finish(null);
    };

    refs.promptForm.addEventListener('submit', onSubmit);
    refs.promptCancel.addEventListener('click', onCancel);
    refs.promptDialog.addEventListener('close', onClose);
    refs.promptDialog.showModal();
    refs.promptInput.focus();
    refs.promptInput.select();
  });
}

/** 打开一个确认型 dialog，resolve true / false */
function openConfirm(opts: { title: string; body: string; okText?: string }): Promise<boolean> {
  return new Promise((resolve) => {
    refs.confirmTitle.textContent = opts.title;
    refs.confirmBody.textContent = opts.body;
    refs.confirmOk.textContent = opts.okText ?? '确认';

    let settled = false;
    const cleanup = () => {
      refs.confirmForm.removeEventListener('submit', onSubmit);
      refs.confirmCancel.removeEventListener('click', onCancel);
      refs.confirmDialog.removeEventListener('close', onClose);
    };
    const finish = (v: boolean) => {
      if (settled) return;
      settled = true;
      cleanup();
      refs.confirmDialog.close();
      resolve(v);
    };
    const onSubmit = (e: Event) => {
      e.preventDefault();
      finish(true);
    };
    const onCancel = () => finish(false);
    const onClose = () => {
      if (!settled) finish(false);
    };

    refs.confirmForm.addEventListener('submit', onSubmit);
    refs.confirmCancel.addEventListener('click', onCancel);
    refs.confirmDialog.addEventListener('close', onClose);
    refs.confirmDialog.showModal();
    refs.confirmOk.focus();
  });
}

// ---------- 预览 ----------

function renderPreview(mime: string, blobUrl: string, fileName: string): { note?: string; tone?: 'info' | 'warn' } {
  const body = refs.previewBody;
  body.innerHTML = '';
  const m = (mime || '').toLowerCase();

  if (m.startsWith('image/')) {
    const img = document.createElement('img');
    img.alt = fileName;
    img.src = blobUrl;
    body.appendChild(img);
    return {};
  }
  if (m === 'application/pdf') {
    const iframe = document.createElement('iframe');
    iframe.src = blobUrl;
    iframe.title = fileName;
    body.appendChild(iframe);
    return {};
  }
  if (m.startsWith('audio/')) {
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.src = blobUrl;
    body.appendChild(audio);
    return {};
  }
  if (m.startsWith('video/')) {
    const video = document.createElement('video');
    video.controls = true;
    video.src = blobUrl;
    body.appendChild(video);
    return {};
  }
  if (
    m.startsWith('text/') ||
    m === 'application/json' ||
    m === 'application/xml' ||
    m === 'application/javascript' ||
    m === 'application/x-yaml' ||
    m === 'application/ld+json' ||
    m === 'application/markdown' ||
    m === 'image/svg+xml'
  ) {
    fetch(blobUrl)
      .then((r) => r.text())
      .then((text) => {
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        code.textContent = text;
        pre.appendChild(code);
        body.replaceChildren(pre);
      })
      .catch((e) => {
        body.innerHTML = `<p class="drive-preview__placeholder">读取失败：${(e as Error).message}</p>`;
      });
    body.innerHTML = '<p class="drive-preview__placeholder">正在读取文本…</p>';
    return { note: '文本预览，仅显示前 256 KB' };
  }
  body.innerHTML = `<p class="drive-preview__placeholder">该文件类型（${m || '未知'}）不支持在线预览。<br/>请点击右上角「下载」获取。</p>`;
  return { note: '当前文件类型无法内联预览', tone: 'warn' };
}

async function openPreview(key: string, name: string) {
  refs.previewName.textContent = name;
  refs.previewNote.textContent = '';
  refs.previewNote.removeAttribute('data-tone');
  refs.previewDownload.href = `/api/download?path=${encodeURIComponent(key)}`;
  refs.previewBody.innerHTML = '<p class="drive-preview__placeholder">载入中…</p>';
  refs.preview.showModal();

  const url = `/api/preview?path=${encodeURIComponent(key)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      refs.previewBody.innerHTML = `<p class="drive-preview__placeholder">预览失败：HTTP ${res.status}</p>`;
      refs.previewNote.textContent = '请改用下载';
      refs.previewNote.dataset.tone = 'warn';
      return;
    }
    const mime = res.headers.get('content-type') || 'application/octet-stream';
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    refs.preview.addEventListener('close', () => URL.revokeObjectURL(blobUrl), { once: true });
    const meta = renderPreview(mime, blobUrl, name);
    if (meta.note) {
      refs.previewNote.textContent = meta.note;
      if (meta.tone) refs.previewNote.dataset.tone = meta.tone;
    }
  } catch (err) {
    refs.previewBody.innerHTML = `<p class="drive-preview__placeholder">请求失败：${(err as Error).message}</p>`;
    refs.previewNote.textContent = '请检查网络后重试';
    refs.previewNote.dataset.tone = 'warn';
  }
}

// ---------- 列表行 ----------

function makeActionButton(icon: string, label: string, handler: () => void, variant: 'default' | 'danger' = 'default'): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'drive-row__action' + (variant === 'danger' ? ' drive-row__action--danger' : '');
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.innerHTML = `${icon}<span>${label}</span>`;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    handler();
  });
  return btn;
}

const ICON_EYE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>';
const ICON_DOWNLOAD =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v12M6 12l6 6 6-6"/></svg>';
const ICON_PENCIL =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4l10-10-4-4L4 16v4z"/></svg>';
const ICON_TRASH =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/></svg>';

function makeRow(item: DriveItem): HTMLElement {
  const tpl = refs.rowTpl.content.firstElementChild!.cloneNode(true) as HTMLElement;
  tpl.dataset.folder = String(item.folder);
  tpl.dataset.key = item.key;
  const iconWrap = tpl.querySelector('[data-icon]') as HTMLElement;
  if (item.folder) {
    iconWrap.innerHTML = ICON_FOLDER;
    iconWrap.dataset.kind = 'folder';
  } else {
    const ic = fileIcon(item.name);
    iconWrap.innerHTML = ic.svg;
    iconWrap.dataset.kind = ic.kind;
  }
  (tpl.querySelector('[data-name]') as HTMLElement).textContent = item.name;
  (tpl.querySelector('[data-meta]') as HTMLElement).textContent = item.folder ? '文件夹' : formatSize(item.size);

  const main = tpl.querySelector('[data-row-main]') as HTMLButtonElement;
  const actions = tpl.querySelector('[data-actions]') as HTMLElement;

  if (item.folder) {
    // 文件夹：行主区域 = 进入；不显示预览按钮
    main.addEventListener('click', () => open(item.key));
  } else {
    // 文件：行主区域不做任何事（防止误触预览）；用户必须点「预览 / 下载」按钮
    main.addEventListener('click', (e) => {
      e.preventDefault();
      // 不做事，强制用右侧按钮
    });

    // 预览
    actions.appendChild(makeActionButton(ICON_EYE, '预览', () => openPreview(item.key, item.name)));

    // 下载
    const downloadLink = document.createElement('a');
    downloadLink.href = `/api/download?path=${encodeURIComponent(item.key)}`;
    downloadLink.className = 'drive-row__action';
    downloadLink.title = '下载';
    downloadLink.setAttribute('aria-label', '下载');
    downloadLink.innerHTML = `${ICON_DOWNLOAD}<span>下载</span>`;
    actions.appendChild(downloadLink);

    // 编辑操作（仅登录态）
    if (authenticated) {
      actions.appendChild(
        makeActionButton(ICON_PENCIL, '重命名', () => renameItem(item.key, item.name)),
      );
      actions.appendChild(
        makeActionButton(ICON_TRASH, '删除', () => removeItem(item.key, item.name), 'danger'),
      );
    }
  }
  return tpl;
}

function render(data: DriveListResponse) {
  refs.list!.innerHTML = '';
  const items = [...data.folders, ...data.files];
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'drive-loading';
    empty.textContent = '此目录为空';
    refs.list!.appendChild(empty);
    return;
  }
  const frag = document.createDocumentFragment();
  for (const item of items) frag.appendChild(makeRow(item));
  refs.list!.appendChild(frag);
}

async function load() {
  notice();
  refs.list!.innerHTML = '<p class="drive-loading">正在载入文件…</p>';
  try {
    render(await api<DriveListResponse>(`/api/files?prefix=${encodeURIComponent(prefix)}`));
  } catch (error) {
    notice((error as Error).message);
  }
  refs.crumb!.textContent = prefix || '根目录';
  refs.up!.disabled = !prefix;
}

function open(key: string) {
  prefix = key;
  load();
}

async function removeItem(key: string, name: string) {
  const ok = await openConfirm({
    title: '删除文件',
    body: `确定要删除「${name}」吗？此操作不可撤销。`,
    okText: '删除',
  });
  if (!ok) return;
  try {
    await api(`/api/files?path=${encodeURIComponent(key)}`, { method: 'DELETE' });
    load();
  } catch (error) {
    notice((error as Error).message);
  }
}

async function renameItem(key: string, name: string) {
  const newName = await openPrompt({
    title: '重命名',
    label: '新名称',
    initial: name,
    hint: '不要包含路径分隔符 / 与 \\',
    confirmText: '保存',
  });
  if (!newName || newName === name) return;
  if (newName.includes('/') || newName.includes('\\')) {
    notice('文件名不能包含 / 或 \\');
    return;
  }
  const parent = key.split('/').slice(0, -1).join('/');
  const sep = key.includes('/') ? '/' : '';
  const destination = `${parent}${sep}${newName}`;
  try {
    await api('/api/files', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: key, to: destination }),
    });
    load();
  } catch (error) {
    notice((error as Error).message);
  }
}

async function newFolder() {
  const name = await openPrompt({
    title: '新建文件夹',
    label: '文件夹名',
    hint: '不能为空，不允许 / 与 \\',
    confirmText: '创建',
  });
  if (!name) return;
  if (name.includes('/') || name.includes('\\')) {
    notice('文件夹名不能包含 / 或 \\');
    return;
  }
  try {
    await api('/api/folder', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: `${prefix}${name}` }),
    });
    load();
  } catch (error) {
    notice((error as Error).message);
  }
}

async function uploadFiles(files: FileList) {
  for (const file of Array.from(files)) {
    const form = new FormData();
    form.append('path', `${prefix}${file.name}`);
    form.append('file', file);
    try {
      await api('/api/files', { method: 'POST', body: form });
    } catch (error) {
      notice((error as Error).message);
      break;
    }
  }
  refs.upload.value = '';
  load();
}

function applyAuthState() {
  refs.modeReadonly!.hidden = authenticated;
  refs.modeAuth!.hidden = !authenticated;
  refs.tools!.hidden = !authenticated;
}

async function setup() {
  try {
    const session = await api<SessionResponse>('/api/auth/session');
    authenticated = session.authenticated;
  } catch {
    authenticated = false;
  }
  applyAuthState();
  load();
}

function bind() {
  refs.login?.addEventListener('click', () => refs.loginDialog?.showModal());
  refs.loginCancel?.addEventListener('click', () => refs.loginDialog?.close());
  refs.loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: refs.loginKey.value }),
      });
      refs.loginDialog.close();
      refs.loginKey.value = '';
      setup();
    } catch (error) {
      notice((error as Error).message);
    }
  });
  refs.logout?.addEventListener('click', async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      /* ignore */
    }
    setup();
  });
  refs.up?.addEventListener('click', () => {
    prefix = prefix.replace(/[^/]+\/$/, '');
    load();
  });
  refs.upload?.addEventListener('change', (event) => {
    const files = (event.target as HTMLInputElement).files;
    if (files && files.length) void uploadFiles(files);
  });
  refs.newFolderBtn?.addEventListener('click', () => void newFolder());
  refs.previewClose?.addEventListener('click', () => refs.preview?.close());
  refs.preview?.addEventListener('click', (e) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) refs.preview.close();
  });
}

bind();
setup().catch((e) => notice((e as Error).message));
