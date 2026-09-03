/**
 * Drive 前端逻辑（TypeScript）
 *
 * 行为完全保留自旧 app.js：
 *   - 列表：GET /api/files?prefix=...
 *   - 上传：POST /api/files（multipart，字段 path + file）
 *   - 新建文件夹：POST /api/folder
 *   - 重命名：PATCH /api/files
 *   - 删除：DELETE /api/files
 *   - 登录：POST /api/auth/login / 登出：POST /api/auth/logout
 *
 * 视觉通过 global.css 中的 .drive-* 类名；本脚本只负责「绑数据 → DOM」。
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

const ICON_FOLDER = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4h4l2 2h7A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5v-11Z"/></svg>';
const ICON_FILE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>';

const root = document.documentElement;
let prefix = '';
let authenticated = false;

const $ = <T extends Element>(sel: string) => root.querySelector(sel) as T | null;
const $$ = <T extends Element>(sel: string) => Array.from(root.querySelectorAll(sel) as NodeListOf<T>);

const refs = {
  mode: $('[data-mode]') as HTMLElement,
  login: $('[data-login]') as HTMLButtonElement,
  logout: $('[data-logout]') as HTMLButtonElement,
  tools: $('[data-tools]') as HTMLElement,
  crumb: $('[data-crumb]') as HTMLElement,
  up: $('[data-up]') as HTMLButtonElement,
  list: $('[data-list]') as HTMLElement,
  notice: $('[data-notice]') as HTMLElement,
  dialog: $('[data-login-dialog]') as HTMLDialogElement,
  form: $('[data-login-form]') as HTMLFormElement,
  key: $('[data-key]') as HTMLInputElement,
  cancel: $('[data-cancel]') as HTMLButtonElement,
  upload: $('#upload') as HTMLInputElement,
  newFolder: $('[data-new-folder]') as HTMLButtonElement,
  rowTpl: $('[data-row-template]') as HTMLTemplateElement,
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

function escapeHtml(value: string): string {
  const el = document.createElement('span');
  el.textContent = value;
  return el.innerHTML;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : ({} as T);
  if (!response.ok) throw new Error((data as { error?: string }).error || '请求失败');
  return data;
}

function makeRow(item: DriveItem): HTMLElement {
  const tpl = refs.rowTpl.content.firstElementChild!.cloneNode(true) as HTMLElement;
  tpl.dataset.folder = String(item.folder);
  tpl.dataset.key = item.key;
  tpl.querySelector('[data-icon]')!.innerHTML = item.folder ? ICON_FOLDER : ICON_FILE;
  (tpl.querySelector('[data-name]') as HTMLElement).textContent = item.name;
  (tpl.querySelector('[data-meta]') as HTMLElement).textContent = item.folder
    ? '文件夹'
    : formatSize(item.size);

  const actions = tpl.querySelector('[data-actions]') as HTMLElement;
  if (item.folder) {
    tpl.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-action]')) return;
      open(item.key);
    });
  } else {
    const download = document.createElement('a');
    download.href = `/api/download?path=${encodeURIComponent(item.key)}`;
    download.className = 'drive-row__action';
    download.textContent = '下载';
    download.addEventListener('click', (e) => e.stopPropagation());
    actions.appendChild(download);

    if (authenticated) {
      const rename = document.createElement('button');
      rename.type = 'button';
      rename.className = 'drive-row__action';
      rename.dataset.action = 'rename';
      rename.textContent = '重命名';
      rename.addEventListener('click', (e) => {
        e.stopPropagation();
        renameItem(item.key);
      });
      actions.appendChild(rename);

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'drive-row__action drive-row__action--danger';
      del.dataset.action = 'delete';
      del.textContent = '删除';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        removeItem(item.key);
      });
      actions.appendChild(del);
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

async function removeItem(key: string) {
  if (!confirm(`删除 ${key.split('/').pop()}？`)) return;
  try {
    await api(`/api/files?path=${encodeURIComponent(key)}`, { method: 'DELETE' });
    load();
  } catch (error) {
    notice((error as Error).message);
  }
}

async function renameItem(key: string) {
  const name = prompt('新文件名', key.split('/').pop() ?? '');
  if (!name) return;
  const parent = key.split('/').slice(0, -1).join('/');
  const sep = key.includes('/') ? '/' : '';
  const destination = `${parent}${sep}${name}`;
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
  const name = prompt('文件夹名称');
  if (!name) return;
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

async function setup() {
  try {
    const session = await api<SessionResponse>('/api/auth/session');
    authenticated = session.authenticated;
  } catch {
    authenticated = false;
  }
  refs.mode!.textContent = authenticated ? '可编辑' : '只读访问';
  refs.tools!.hidden = !authenticated;
  refs.login!.hidden = authenticated;
  refs.logout!.hidden = !authenticated;
  load();
}

function bind() {
  refs.login?.addEventListener('click', () => refs.dialog?.showModal());
  refs.cancel?.addEventListener('click', () => refs.dialog?.close());
  refs.form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: refs.key.value }),
      });
      refs.dialog?.close();
      refs.key.value = '';
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
  refs.newFolder?.addEventListener('click', () => void newFolder());
}

bind();
setup().catch((e) => notice((e as Error).message));
