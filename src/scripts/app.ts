/**
 * Drive 前端逻辑（TypeScript）
 *
 * 行为：
 *   - 列表：GET /api/files?prefix=...
 *   - 上传：POST /api/files（multipart，XHR 上报进度）
 *   - 新建文件夹：POST /api/folder
 *   - 重命名（文件/文件夹）：PATCH /api/files
 *   - 删除（文件/文件夹）：DELETE /api/files
 *   - 登录/登出：POST /api/auth/{login,logout}
 *   - 预览：GET /api/preview?path=...
 *
 * 交互约定：
 *   - 文件夹：点行主区域进入；登录后可 重命名 / 删除
 *   - 文件：行主区域不触发预览，防误触；右侧 预览 / 下载（登录后再加 重命名 / 删除）
 *   - 所有操作都有 toast 反馈：进行中（带进度条）→ 成功 / 失败
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

// ---------- 图标 ----------
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
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M7.5 16.5h3M9 14.2v4.6"/></svg>';
const ICON_FILE_CODE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 18l6-6-6-6"/><path d="M8 6l-6 6 6 6"/></svg>';
const ICON_FILE_TEXT =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/></svg>';
const ICON_FILE_ARCHIVE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></svg>';
const ICON_CHECK =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
const ICON_X =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
const ICON_UPLOAD =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
const ICON_FOLDER_PLUS =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/><path d="M12 11v6M9 14h6"/></svg>';
const ICON_EYE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>';
const ICON_DOWNLOAD =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v12M6 12l6 6 6-6"/></svg>';
const ICON_PENCIL =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4l10-10-4-4L4 16v4z"/></svg>';
const ICON_TRASH =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/></svg>';

/** 根据文件名返回图标 svg */
function fileIcon(name: string): string {
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'heic'].includes(ext)) return ICON_FILE_IMAGE;
  if (['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v'].includes(ext)) return ICON_FILE_VIDEO;
  if (['mp3', 'wav', 'flac', 'ogg', 'm4a', 'opus', 'aac'].includes(ext)) return ICON_FILE_AUDIO;
  if (ext === 'pdf') return ICON_FILE_PDF;
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz'].includes(ext)) return ICON_FILE_ARCHIVE;
  if (
    [
      'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'json', 'jsonc', 'json5',
      'css', 'scss', 'less', 'html', 'htm', 'xml', 'vue', 'svelte',
      'py', 'rb', 'rs', 'go', 'java', 'kt', 'swift', 'c', 'cc', 'cpp', 'h', 'hpp', 'm', 'mm',
      'php', 'sh', 'bash', 'zsh', 'ps1', 'sql', 'lua', 'r', 'dart', 'toml', 'yaml', 'yml',
    ].includes(ext)
  ) {
    return ICON_FILE_CODE;
  }
  if (['txt', 'md', 'markdown', 'log', 'csv', 'tsv', 'ini', 'conf', 'env', 'rst'].includes(ext)) return ICON_FILE_TEXT;
  return ICON_FILE_DEFAULT;
}

/** 文件图标的类型（用来染色） */
function fileKind(name: string): string {
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'heic'].includes(ext)) return 'image';
  if (['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'flac', 'ogg', 'm4a', 'opus', 'aac'].includes(ext)) return 'audio';
  if (ext === 'pdf') return 'pdf';
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz'].includes(ext)) return 'archive';
  if (['txt', 'md', 'markdown', 'log', 'csv', 'tsv', 'ini', 'conf', 'env', 'rst'].includes(ext)) return 'text';
  return 'file';
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
  toasts: $('[data-toasts]') as HTMLElement,
  loginDialog: $('[data-login-dialog]') as HTMLDialogElement,
  loginForm: $('[data-login-form]') as HTMLFormElement,
  loginKey: $('[data-key]') as HTMLInputElement,
  loginCancel: $('[data-cancel]') as HTMLButtonElement,
  promptDialog: $('[data-prompt-dialog]') as HTMLDialogElement,
  promptForm: $('[data-prompt-form]') as HTMLFormElement,
  promptTitle: $('[data-prompt-title]') as HTMLElement,
  promptLabel: $('[data-prompt-label]') as HTMLElement,
  promptInput: $('[data-prompt-input]') as HTMLInputElement,
  promptHint: $('[data-prompt-hint]') as HTMLElement,
  promptCancel: $('[data-prompt-cancel]') as HTMLButtonElement,
  promptConfirm: $('[data-prompt-confirm]') as HTMLButtonElement,
  confirmDialog: $('[data-confirm-dialog]') as HTMLDialogElement,
  confirmForm: $('[data-confirm-form]') as HTMLFormElement,
  confirmTitle: $('[data-confirm-title]') as HTMLElement,
  confirmBody: $('[data-confirm-body]') as HTMLElement,
  confirmCancel: $('[data-confirm-cancel]') as HTMLButtonElement,
  confirmOk: $('[data-confirm-ok]') as HTMLButtonElement,
  preview: $('[data-preview]') as HTMLDialogElement,
  previewName: $('[data-preview-name]') as HTMLElement,
  previewBody: $('[data-preview-body]') as HTMLElement,
  previewNote: $('[data-preview-note]') as HTMLElement,
  previewDownload: $('[data-preview-download]') as HTMLAnchorElement,
  previewClose: $('[data-preview-close]') as HTMLButtonElement,
};

function escapeHtml(value: string): string {
  const el = document.createElement('span');
  el.textContent = value;
  return el.innerHTML;
}

// ---------- toast ----------

interface ToastHandle {
  setProgress: (pct: number | null) => void; // null = indeterminate
  setDetail: (text: string) => void;
  done: (tone: 'success' | 'error', detail?: string) => void;
  close: () => void;
}

function toast(title: string, detail?: string): ToastHandle {
  const host = refs.toasts;
  const el = document.createElement('div');
  el.className = 'drive-toast';
  el.dataset.tone = 'info';

  const icon = document.createElement('span');
  icon.className = 'drive-toast__icon';
  icon.innerHTML = ICON_UPLOAD;

  const body = document.createElement('div');
  body.className = 'drive-toast__body';

  const titleEl = document.createElement('span');
  titleEl.className = 'drive-toast__title';
  titleEl.textContent = title;

  const detailEl = document.createElement('span');
  detailEl.className = 'drive-toast__detail';
  detailEl.textContent = detail ?? '';

  const progressWrap = document.createElement('div');
  progressWrap.className = 'drive-toast__progress';
  const bar = document.createElement('div');
  bar.className = 'drive-toast__progress-bar';
  progressWrap.appendChild(bar);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'drive-toast__close';
  closeBtn.setAttribute('aria-label', '关闭');
  closeBtn.innerHTML = ICON_X;

  body.append(titleEl, detailEl, progressWrap);
  el.append(icon, body, closeBtn);
  host.appendChild(el);

  let timer: ReturnType<typeof setTimeout> | null = null;
  let tone: 'info' | 'success' | 'error' = 'info';

  const schedule = (ms: number) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => dismiss(), ms);
  };
  const dismiss = () => {
    if (!el.isConnected) return;
    el.dataset.leaving = 'true';
    setTimeout(() => el.remove(), 200);
  };

  closeBtn.addEventListener('click', dismiss);

  const api: ToastHandle = {
    setProgress(pct) {
      if (progressWrap.parentElement !== body) body.appendChild(progressWrap);
      if (pct === null) {
        bar.style.width = '';
        bar.dataset.indeterminate = 'true';
      } else {
        delete bar.dataset.indeterminate;
        bar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
      }
    },
    setDetail(text) {
      detailEl.textContent = text;
    },
    done(nextTone, nextDetail) {
      tone = nextTone;
      el.dataset.tone = tone;
      icon.innerHTML = nextTone === 'success' ? ICON_CHECK : ICON_X;
      if (nextDetail !== undefined) detailEl.textContent = nextDetail;
      progressWrap.remove();
      schedule(3000);
    },
    close() {
      dismiss();
    },
  };

  // 进行中的 toast 不自动消失；设置成功后会自动排程关闭
  return api;
}

function toastSuccess(title: string, detail?: string) {
  const t = toast(title, detail);
  t.done('success');
}

function toastError(title: string, detail?: string) {
  const t = toast(title, detail);
  t.done('error');
}

// ---------- dialog 辅助 ----------

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
    const onClose = () => { if (!settled) finish(null); };
    refs.promptForm.addEventListener('submit', onSubmit);
    refs.promptCancel.addEventListener('click', onCancel);
    refs.promptDialog.addEventListener('close', onClose);
    refs.promptDialog.showModal();
    refs.promptInput.focus();
    refs.promptInput.select();
  });
}

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
    const onSubmit = (e: Event) => { e.preventDefault(); finish(true); };
    const onCancel = () => finish(false);
    const onClose = () => { if (!settled) finish(false); };
    refs.confirmForm.addEventListener('submit', onSubmit);
    refs.confirmCancel.addEventListener('click', onCancel);
    refs.confirmDialog.addEventListener('close', onClose);
    refs.confirmDialog.showModal();
    refs.confirmOk.focus();
  });
}

// ---------- API ----------

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : ({} as T);
  if (!response.ok) throw new Error((data as { error?: string }).error || '请求失败');
  return data;
}

function readError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 带进度的 multipart 上传（XHR） */
function uploadWithProgress(path: string, file: File, onProgress: (pct: number) => void): Promise<{ ok: boolean; status: number }> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('path', path);
    form.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/files');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress((e.loaded / e.total) * 100);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve({ ok: true, status: xhr.status });
      else {
        let msg = `上传失败 (HTTP ${xhr.status})`;
        try {
          const d = JSON.parse(xhr.responseText);
          if (d?.error) msg = d.error;
        } catch { /* ignore */ }
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error('网络错误，上传中断'));
    xhr.send(form);
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
    body.innerHTML = '<p class="drive-preview__placeholder">正在读取文本…</p>';
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
        body.innerHTML = `<p class="drive-preview__placeholder">读取失败：${escapeHtml(readError(e))}</p>`;
      });
    return { note: '文本预览，仅显示前 256 KB' };
  }
  body.innerHTML = '<p class="drive-preview__placeholder">该文件类型暂不支持在线预览，请点击右上角「下载」。</p>';
  return { note: '无法内联预览', tone: 'warn' };
}

async function openPreview(key: string, name: string) {
  refs.previewName.textContent = name;
  refs.previewNote.textContent = '';
  refs.previewNote.removeAttribute('data-tone');
  refs.previewDownload.href = `/api/download?path=${encodeURIComponent(key)}`;
  refs.previewBody.innerHTML = '<p class="drive-preview__placeholder">载入中…</p>';
  refs.preview.showModal();
  try {
    const res = await fetch(`/api/preview?path=${encodeURIComponent(key)}`);
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
    refs.previewBody.innerHTML = `<p class="drive-preview__placeholder">请求失败：${escapeHtml(readError(err))}</p>`;
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

function makeRow(item: DriveItem): HTMLElement {
  const tpl = refs.rowTpl.content.firstElementChild!.cloneNode(true) as HTMLElement;
  tpl.dataset.folder = String(item.folder);
  tpl.dataset.key = item.key;
  const iconWrap = tpl.querySelector('[data-icon]') as HTMLElement;
  const name = item.name;
  if (item.folder) {
    iconWrap.innerHTML = ICON_FOLDER;
    iconWrap.dataset.kind = 'folder';
  } else {
    iconWrap.innerHTML = fileIcon(name);
    iconWrap.dataset.kind = fileKind(name);
  }
  (tpl.querySelector('[data-name]') as HTMLElement).textContent = name;
  (tpl.querySelector('[data-meta]') as HTMLElement).textContent = item.folder ? '文件夹' : formatSize(item.size);

  const main = tpl.querySelector('[data-row-main]') as HTMLButtonElement;
  const actions = tpl.querySelector('[data-actions]') as HTMLElement;

  if (item.folder) {
    // 文件夹：主区域进入
    main.addEventListener('click', () => open(item.key));
    // 登录后：重命名 / 删除（DELETE /api/files?path=xxx 对目录同样有效）
    if (authenticated) {
      actions.appendChild(makeActionButton(ICON_PENCIL, '重命名', () => renameItem(item.key, item.name)));
      actions.appendChild(makeActionButton(ICON_TRASH, '删除', () => removeItem(item.key, item.name), 'danger'));
    }
  } else {
    // 文件：主区域不触发预览（防误触）
    actions.appendChild(makeActionButton(ICON_EYE, '预览', () => openPreview(item.key, name)));
    const downloadLink = document.createElement('a');
    downloadLink.href = `/api/download?path=${encodeURIComponent(item.key)}`;
    downloadLink.className = 'drive-row__action';
    downloadLink.title = '下载';
    downloadLink.setAttribute('aria-label', '下载');
    downloadLink.innerHTML = `${ICON_DOWNLOAD}<span>下载</span>`;
    actions.appendChild(downloadLink);
    if (authenticated) {
      actions.appendChild(makeActionButton(ICON_PENCIL, '重命名', () => renameItem(item.key, item.name)));
      actions.appendChild(makeActionButton(ICON_TRASH, '删除', () => removeItem(item.key, item.name), 'danger'));
    }
  }
  return tpl;
}

function formatSize(size?: number): string {
  if (!size) return '—';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`;
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
  try {
    const data = await api<DriveListResponse>(`/api/files?prefix=${encodeURIComponent(prefix)}`);
    render(data);
  } catch (error) {
    refs.list!.innerHTML = `<p class="drive-loading">载入失败：${escapeHtml(readError(error))}</p>`;
  }
  refs.crumb!.textContent = prefix || '根目录';
  refs.up!.disabled = !prefix;
}

function open(key: string) {
  prefix = key;
  load();
}

// ---------- 操作 ----------

async function removeItem(key: string, name: string) {
  const isFolder = key.endsWith('/');
  const ok = await openConfirm({
    title: isFolder ? '删除文件夹' : '删除文件',
    body: isFolder
      ? `确定要删除文件夹「${name}」吗？文件夹内的所有内容也会一并删除，此操作不可撤销。`
      : `确定要删除「${name}」吗？此操作不可撤销。`,
    okText: '删除',
  });
  if (!ok) return;
  const t = toast(`正在删除「${name}」…`);
  try {
    await api(`/api/files?path=${encodeURIComponent(key)}`, { method: 'DELETE' });
    t.done('success', '已删除');
    load();
  } catch (error) {
    t.done('error', readError(error));
  }
}

async function renameItem(key: string, name: string) {
  const isFolder = key.endsWith('/');
  const newName = await openPrompt({
    title: isFolder ? '重命名文件夹' : '重命名文件',
    label: '新名称',
    initial: name,
    hint: '不能包含 / 与 \\',
    confirmText: '保存',
  });
  if (!newName || newName === name) return;
  if (newName.includes('/') || newName.includes('\\')) {
    toastError('名称不合法', '不能包含 / 与 \\');
    return;
  }
  const parent = key.split('/').slice(0, -1).join('/');
  const sep = key.includes('/') ? '/' : '';
  const destination = `${parent}${sep}${newName}${isFolder ? '/' : ''}`;
  const t = toast(`正在重命名「${name}」…`);
  try {
    await api('/api/files', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: key, to: destination }),
    });
    t.done('success', `已重命名为「${newName}」`);
    load();
  } catch (error) {
    t.done('error', readError(error));
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
    toastError('名称不合法', '不能包含 / 与 \\');
    return;
  }
  const t = toast(`正在创建「${name}」…`);
  try {
    await api('/api/folder', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: `${prefix}${name}` }),
    });
    t.done('success', '文件夹已创建');
    load();
  } catch (error) {
    t.done('error', readError(error));
  }
}

async function uploadFiles(files: FileList) {
  for (const file of Array.from(files)) {
    const t = toast(`正在上传「${file.name}」…`, '0%');
    t.setProgress(0);
    try {
      await uploadWithProgress(`${prefix}${file.name}`, file, (pct) => {
        t.setProgress(pct);
        t.setDetail(`${Math.round(pct)}% · ${formatSize(file.size)}`);
      });
      t.done('success', `已上传 ${formatSize(file.size)}`);
    } catch (error) {
      t.done('error', readError(error));
      break;
    }
  }
  refs.upload.value = '';
  load();
}

// ---------- 登录状态 ----------

function applyAuthState() {
  refs.modeReadonly!.hidden = authenticated;
  refs.modeAuth!.hidden = !authenticated;
  refs.tools!.hidden = !authenticated;
  load();
}

async function setup() {
  try {
    const session = await api<SessionResponse>('/api/auth/session');
    authenticated = session.authenticated;
  } catch {
    authenticated = false;
  }
  applyAuthState();
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
      toastSuccess('登录成功', '已获得编辑权限');
      setup();
    } catch (error) {
      toastError('登录失败', readError(error));
    }
  });
  refs.logout?.addEventListener('click', async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
      toastSuccess('已退出登录', '回到只读模式');
    } catch (error) {
      toastError('退出失败', readError(error));
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
setup();
