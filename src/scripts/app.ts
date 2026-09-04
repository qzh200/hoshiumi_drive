/**
 * Drive 前端逻辑（只读版 · v0.3）
 *
 * 设计原则：
 *   - 整个应用是 WebDAV 的「只读浏览器 + 客户端打包器 + 全文搜索 + 富预览」。
 *   - 后端只做：列目录 / 单文件下载 / 预览 / 必要的元数据；不做任何写操作、不做 auth。
 *   - 文件夹打包在浏览器里用 client-zip 流式完成；不需要服务端 zip。
 *   - 搜索是客户端全量索引，**只走当前目录子树**（不递归到整棵树）。
 *   - 多选默认关闭，需要点工具栏「多选」按钮进入。
 *   - 预览：媒体 / 代码高亮 / Markdown / Word(.docx) / CSV / ZIP 内部浏览；
 *     按「是否整段装进内存」分档设上限（视频/音频不设上限，只流式）。
 *
 * 行为：
 *   - 列表：GET /api/list/[path-to-dir]/（path 在 URL 段里）
 *   - 单文件下载：直接 <a href="/api/download/[file]"> 或 <a download>
 *   - 预览：GET /api/preview/[file]（含 Range 透传，路径在 URL 段里）
 *   - 文件夹打包：递归 list → **限并发** fetch 每文件 → client-zip 流式打 zip →
 *     StreamSaver（Service Worker 通道）→ 浏览器原生下载栏落盘；不支持时回退 Blob + <a download>
 *   - 多选：工具栏按钮切换；进入后行首 checkbox 出现，底部操作栏可一键打包选中
 *   - 搜索：弹窗内输入；首次搜索时构建当前目录子树的索引；结果路径为可点击面包屑
 *   - 预览增强：图片灯箱、代码高亮、Markdown、Word、CSV、ZIP 内部浏览
 */

import { downloadZip } from 'client-zip';
import JSZip from 'jszip';
import streamSaver from 'streamsaver';
import type { ArchiveEntry, ArchiveState, DriveItem, DriveListResponse, IndexEntry, PreviewKind, PreviewState } from './types';
import { ICON_CHECK, ICON_DOWNLOAD, ICON_EYE, ICON_FOLDER, ICON_PACK, ICON_X, fileIcon } from './icons';
import { classifyPreview, extOf, fileKind, guessMime, languageFor } from './filetype';
import { escapeHtml, fileMetaLine, formatSize, previewMetaLine, readError } from './utils';
import { buildArchiveCrumb, listArchiveEntries } from './archive';
import { renderDocxPreview, renderMediaPreview, renderSpreadsheetPreview, renderTextPreview } from './preview-render';

// ---------- 预览大小限制（客户端防御） ----------
//
// 关键区分：这个文件会不会被浏览器「整段装进内存」。
//   - 视频/音频：浏览器用 Range 流式播放，内存只放当前 chunk，不设总大小上限。
//   - 图片：<img> 整张解码，单独给一个较大但有限的上限。
//   - PDF：pdfium 用 Range 分块加载，可以放宽很多。
//   - 压缩包 / Office / 文本：需要在浏览器里整体载入内存解析，各自给贴近实际的上限。

/** 压缩包内浏览上限：200MB（JSZip 在浏览器内解压大包很贵） */
const MAX_ARCHIVE_PREVIEW_BYTES = 200 * 1024 * 1024;
/** Office（docx/xlsx/pptx/odf）预览上限：30MB（解析只取文本/表格，30MB 足够常见文档） */
const MAX_OFFICE_PREVIEW_BYTES = 30 * 1024 * 1024;
/** 文本/代码/Markdown 预览上限：2MB（再大就让用户下载） */
const MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024;
/** 图片预览上限：100MB（太大的图 <img> 解码吃力、内存吃紧） */
const MAX_IMAGE_PREVIEW_BYTES = 100 * 1024 * 1024;
/** PDF 预览上限：1GB（浏览器 pdfium 用 Range 分块加载，可以放宽很多） */
const MAX_PDF_PREVIEW_BYTES = 1024 * 1024 * 1024;
/** 未知/二进制兜底：200MB（其实二进制走「提示下载」，不会真拉下来渲染） */
const MAX_DEFAULT_PREVIEW_BYTES = 200 * 1024 * 1024;


// ---------- 状态 ----------

const root = document.documentElement;
let prefix = '';
let lastList: DriveListResponse | null = null;
let previewState: PreviewState | null = null;
let selectionMode = false;
const selected = new Set<string>();
let searchIndex: Map<string, IndexEntry> | null = null;
let searchIndexScope = ''; // 索引对应的 prefix；切目录时清掉
let searchIndexPromise: Promise<Map<string, IndexEntry>> | null = null;
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
// 压缩包内浏览状态
let archiveState: ArchiveState | null = null;
// 当前预览持有的 blob URL（zip 内文件预览用），切预览或关闭时 revoke
let currentBlobUrl: string | null = null;

const $ = <T extends Element>(sel: string) => root.querySelector(sel) as T | null;

const refs = {
  crumb: $('[data-crumb]') as HTMLElement,
  up: $('[data-up]') as HTMLButtonElement,
  list: $('[data-list]') as HTMLElement,
  notice: $('[data-notice]') as HTMLElement,
  rowTpl: $('[data-row-template]') as HTMLTemplateElement,
  toasts: $('[data-toasts]') as HTMLElement,
  progress: $('[data-progress]') as HTMLElement | null,
  // 外层预览 dialog：顶层文件预览 + ZIP 内容浏览器共用
  preview: $('[data-preview]') as HTMLDialogElement,
  previewName: $('[data-preview-name]') as HTMLElement,
  previewBody: $('[data-preview-body]') as HTMLElement,
  previewNote: $('[data-preview-note]') as HTMLElement,
  previewDownload: $('[data-preview-download]') as HTMLAnchorElement,
  previewClose: $('[data-preview-close]') as HTMLButtonElement,
  previewPrev: $('[data-preview-prev]') as HTMLButtonElement,
  previewNext: $('[data-preview-next]') as HTMLButtonElement,
  // 内层预览 dialog：专门承载 ZIP 内文件预览；独立于外层，关闭不影响 ZIP 浏览器
  previewInner: $('[data-preview-inner]') as HTMLDialogElement,
  previewInnerName: $('[data-preview-inner-name]') as HTMLElement,
  previewInnerBody: $('[data-preview-inner-body]') as HTMLElement,
  previewInnerNote: $('[data-preview-inner-note]') as HTMLElement,
  previewInnerDownload: $('[data-preview-inner-download]') as HTMLAnchorElement,
  previewInnerClose: $('[data-preview-inner-close]') as HTMLButtonElement,
  previewInnerPrev: $('[data-preview-inner-prev]') as HTMLButtonElement,
  previewInnerNext: $('[data-preview-inner-next]') as HTMLButtonElement,
  actionbar: $('[data-actionbar]') as HTMLElement,
  actionbarCount: $('[data-actionbar-count]') as HTMLElement,
  actionbarAll: $('[data-actionbar-all]') as HTMLButtonElement,
  actionbarPack: $('[data-actionbar-pack]') as HTMLButtonElement,
  actionbarClear: $('[data-actionbar-clear]') as HTMLButtonElement,
  selectToggle: $('[data-select-toggle]') as HTMLButtonElement,
  // 打包下载方式切换（Service Worker 流式 / Blob）
  dlMode: $('[data-dl-mode]') as HTMLButtonElement,
  dlModeLabel: $('[data-dl-mode-label]') as HTMLElement,
  searchBtn: $('[data-search-btn]') as HTMLButtonElement,
  searchModal: $('[data-search-modal]') as HTMLDialogElement,
  searchInput: $('[data-search-input]') as HTMLInputElement,
  searchClose: $('[data-search-close]') as HTMLButtonElement,
  searchStatus: $('[data-search-status]') as HTMLElement,
  searchResults: $('[data-search-results]') as HTMLElement,
};

/**
 * 当前预览 dialog 的 DOM 引用。
 * - 顶层文件预览 / ZIP 内容浏览器 → outer
 * - ZIP 内文件预览 → inner（独立层，关闭时只清 blob URL，不动外层 archive state）
 * 渲染类辅助函数（setPreviewNote / renderMediaPreview / ...）通过访问 activePreview 写入正确的 dialog。
 */
interface PreviewDom {
  dialog: HTMLDialogElement;
  name: HTMLElement;
  body: HTMLElement;
  note: HTMLElement;
  download: HTMLAnchorElement;
  close: HTMLButtonElement;
  prev: HTMLButtonElement;
  next: HTMLButtonElement;
}

const previewDom: Record<'outer' | 'inner', PreviewDom> = {
  outer: {
    dialog: refs.preview,
    name: refs.previewName,
    body: refs.previewBody,
    note: refs.previewNote,
    download: refs.previewDownload,
    close: refs.previewClose,
    prev: refs.previewPrev,
    next: refs.previewNext,
  },
  inner: {
    dialog: refs.previewInner,
    name: refs.previewInnerName,
    body: refs.previewInnerBody,
    note: refs.previewInnerNote,
    download: refs.previewInnerDownload,
    close: refs.previewInnerClose,
    prev: refs.previewInnerPrev,
    next: refs.previewInnerNext,
  },
};
let activePreview: PreviewDom = previewDom.outer;

/** 跟踪预览期间创建的 blob URL；切预览 / 关闭时 revoke 避免内存泄漏 */
function setBlobUrl(url: string | null) {
  if (currentBlobUrl && currentBlobUrl !== url) {
    try { URL.revokeObjectURL(currentBlobUrl); } catch { /* ignore */ }
  }
  currentBlobUrl = url;
}

/** 关闭预览时清理 archive 状态和 blob URL */
function cleanupArchiveState() {
  archiveState = null;
  setBlobUrl(null);
}

async function api<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : ({} as T);
  if (!response.ok) throw new Error((data as { error?: string }).error || '请求失败');
  return data;
}

// URL builders：path 走 URL 段（不是 query 参数），可以直接分享 / 收藏
//   例：/api/preview/hadoop/%E4%B8%80%E9%94%AE%E9%83%A8%E7%BD%B2/%E8%84%9A%E6%9C%AC.zip
// encodeURI 保留 /，只对中文字符等做百分号编码

/** /api/list/[prefix]；prefix 必须以 / 结尾或为空 */
function apiListUrl(prefix: string): string {
  if (!prefix) return '/api/list/';
  return `/api/list/${prefix.split('/').filter(Boolean).map(encodeURIComponent).join('/')}/`;
}

/** /api/preview/[key]；key 是文件路径，不以 / 结尾 */
function apiPreviewUrl(key: string): string {
  return `/api/preview/${key.split('/').filter(Boolean).map(encodeURIComponent).join('/')}`;
}

/** /api/download/[key]；key 是文件路径，不以 / 结尾 */
function apiDownloadUrl(key: string): string {
  return `/api/download/${key.split('/').filter(Boolean).map(encodeURIComponent).join('/')}`;
}

// ---------- toast ----------

interface ToastHandle {
  setProgress: (pct: number | null) => void;
  setDetail: (text: string) => void;
  done: (tone: 'success' | 'error', detail?: string) => void;
  close: () => void;
}

function toast(title: string, detail?: string, iconHtml: string = ICON_PACK): ToastHandle {
  const host = refs.toasts;
  const el = document.createElement('div');
  el.className = 'drive-toast';
  el.dataset.tone = 'info';

  const icon = document.createElement('span');
  icon.className = 'drive-toast__icon';
  icon.innerHTML = iconHtml;

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

  return {
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
}

// ---------- 下载通知 ----------
//
// 浏览器原生 <a download> 触发后没有标准事件能感知「下载完成」，
// 所以这里的 toast 是「点击已触发」级别的反馈——告诉用户「我收到了，
// 浏览器接管了，请在下载栏查看」。
//
// 视觉上跟 packFolder 的 toast 对齐：info → success 两段式，
// 500ms 后转 success，自动 3s 关闭。
function notifyDownload(name: string, size?: number) {
  const sizeLine = size !== undefined ? ` · ${formatSize(size)}` : '';
  const detail = size !== undefined ? `文件大小 ${formatSize(size)}` : '已发送下载请求';
  const t = toast(`下载已触发：${name}`, detail, ICON_DOWNLOAD);
  // 进度条走个 indeterminate，给一个「正在移交」的感觉，再转 success
  t.setProgress(null);
  setTimeout(() => t.done('success', `请在浏览器下载栏查看${sizeLine}`), 500);
}

// ---------- 预览 ----------


function setPreviewNote(text: string, tone?: 'info' | 'warn') {
  activePreview.note.textContent = text;
  if (tone) activePreview.note.dataset.tone = tone;
  else activePreview.note.removeAttribute('data-tone');
}

function setGalleryNav(visible: boolean) {
  activePreview.prev.hidden = !visible;
  activePreview.next.hidden = !visible;
}



/** 渲染当前 archiveState 的内容（面包屑 + 列表） */
function renderArchiveEntries() {
  const arc = archiveState;
  if (!arc) return;
  // ZIP 内容浏览器只在外层 dialog 里呈现
  const body = previewDom.outer.body;
  body.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'drive-preview__archive';

  wrap.appendChild(buildArchiveCrumb(arc, (innerPath) => navigateArchiveTo(innerPath)));

  const entries = listArchiveEntries(arc);
  const totalSize = entries.reduce((s, e) => s + (e.isDir ? 0 : e.size), 0);
  const summary = document.createElement('div');
  summary.className = 'drive-preview__archive-summary';
  summary.innerHTML = `<div><strong>${entries.length}</strong> 个条目</div><div>当前层大小：<strong>${formatSize(totalSize)}</strong></div>`;
  wrap.appendChild(summary);

  if (entries.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'drive-preview__placeholder';
    empty.textContent = '（空目录）';
    wrap.appendChild(empty);
  } else {
    const list = document.createElement('ul');
    list.className = 'drive-preview__archive-list';
    const MAX = 500;
    for (const e of entries.slice(0, MAX)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'drive-preview__archive-item';
      if (e.isDir) btn.dataset.kind = 'folder';
      else btn.dataset.kind = fileKind(e.name);
      btn.addEventListener('click', () => onArchiveEntryClick(e));
      const icon = document.createElement('span');
      icon.className = 'drive-preview__archive-item-icon';
      // 与外层 .drive-row__icon 一样：docx/doc/sheet 归到 code 配色
      if (e.isDir) icon.dataset.kind = 'folder';
      else {
        const k = fileKind(e.name);
        icon.dataset.kind = k === 'docx' || k === 'doc' || k === 'sheet' ? 'code' : k;
      }
      icon.innerHTML = e.isDir ? ICON_FOLDER : fileIcon(e.name);
      const name = document.createElement('span');
      name.className = 'drive-preview__archive-item-name';
      name.textContent = e.isDir ? `${e.name}/` : e.name;
      name.title = e.fullPath;
      const size = document.createElement('span');
      size.className = 'drive-preview__archive-item-size';
      size.textContent = e.isDir ? '文件夹' : formatSize(e.size);
      btn.append(icon, name, size);
      list.appendChild(btn);
    }
    if (entries.length > MAX) {
      const more = document.createElement('li');
      more.className = 'drive-preview__archive-more';
      more.textContent = `（还有 ${entries.length - MAX} 项未显示，请下载后用本地工具浏览）`;
      list.appendChild(more);
    }
    wrap.appendChild(list);
  }
  body.replaceChildren(wrap);
}

function navigateArchiveTo(innerPath: string) {
  if (!archiveState) return;
  archiveState = { ...archiveState, innerPath };
  renderArchiveEntries();
}

/** zip 内条目点击：文件夹 → 进入；文件 → 预览；嵌套 zip → 替换 archiveState */
async function onArchiveEntryClick(entry: ArchiveEntry) {
  if (!archiveState) return;
  if (entry.isDir) {
    navigateArchiveTo(entry.fullPath);
    return;
  }
  // 嵌套 zip？直接打开为新的 archive 视图
  const kind = fileKind(entry.name);
  if (kind === 'archive') {
    await openNestedArchive(entry);
    return;
  }
  await openArchiveFile(entry);
}

/** 从 zip 内取文件 → blob URL → 调 openPreview(sourceUrl) */
async function openArchiveFile(entry: ArchiveEntry) {
  if (!archiveState) return;
  const file = archiveState.zip.file(entry.fullPath);
  if (!file) {
    previewDom.outer.body.innerHTML = `<p class="drive-preview__placeholder">找不到条目：${escapeHtml(entry.fullPath)}</p>`;
    return;
  }
  // 文件预览将出现在独立的内层 dialog（关闭它不影响外层 ZIP 浏览器）
  activePreview = previewDom.inner;
  activePreview.body.innerHTML = '<p class="drive-preview__placeholder">正在解压文件…</p>';
  if (!activePreview.dialog.open) activePreview.dialog.showModal();
  try {
    const buffer = await file.async('uint8array');
    const mime = guessMime(entry.name);
    // 用 slice() 产生一个不带泛型参数的 Uint8Array，TS Blob 构造签名才能接受
    const blob = new Blob([buffer.slice()], { type: mime });
    const url = URL.createObjectURL(blob);
    setBlobUrl(url);
    const kind = classifyPreview(mime, entry.name);
    await openPreview({
      key: `${archiveState.zipKey}!${entry.fullPath}`,
      name: entry.name,
      kind,
      mime,
      size: entry.size,
      uploaded: entry.date && entry.date.getTime() > 0 ? entry.date.toISOString() : undefined,
      sourceUrl: url,
      sourceLabel: `ZIP 内 · ${archiveState.zipName}`,
    });
  } catch (err) {
    activePreview.body.innerHTML = `<p class="drive-preview__placeholder">解压失败：${escapeHtml(readError(err))}</p>`;
  }
}

/** 嵌套 zip：用内层 zip 替换当前 archiveState（仍在 outer dialog 展示） */
async function openNestedArchive(entry: ArchiveEntry) {
  if (!archiveState) return;
  // 嵌套 zip 替换外层 archiveState，所有提示都打到外层 dialog
  activePreview = previewDom.outer;
  const file = archiveState.zip.file(entry.fullPath);
  if (!file) {
    activePreview.body.innerHTML = `<p class="drive-preview__placeholder">找不到条目：${escapeHtml(entry.fullPath)}</p>`;
    return;
  }
  activePreview.body.innerHTML = '<p class="drive-preview__placeholder">正在解压嵌套压缩包…</p>';
  try {
    const buffer = await file.async('uint8array');
    const innerZip = await JSZip.loadAsync(buffer);
    archiveState = {
      zip: innerZip,
      zipKey: `${archiveState.zipKey}!${entry.fullPath}`,
      zipName: entry.name,
      innerPath: '',
    };
    renderArchiveEntries();
  } catch (err) {
    activePreview.body.innerHTML = `<p class="drive-preview__placeholder">嵌套压缩包解析失败：${escapeHtml(readError(err))}</p>`;
  }
}


function showPreviewError(message: string, noteTone: 'info' | 'warn' = 'warn') {
  activePreview.body.innerHTML = `<p class="drive-preview__placeholder">${escapeHtml(message)}</p>`;
  setPreviewNote('请改用下载', noteTone);
}

/**
 * 按预览类型给出「最大可预览大小」。返回 null 表示不设大小上限。
 * 关键区分是「会不会被浏览器整段装进内存」：见上面注释的 MAX_* 常量说明。
 */
function previewSizeLimitBytes(kind: PreviewKind): number | null {
  switch (kind) {
    case 'video':
    case 'audio':
      return null; // 流式播放，只占当前 chunk，不设总大小上限
    case 'image':
      return MAX_IMAGE_PREVIEW_BYTES;
    case 'pdf':
      return MAX_PDF_PREVIEW_BYTES;
    case 'archive':
      return MAX_ARCHIVE_PREVIEW_BYTES;
    case 'docx':
    case 'sheet':
      return MAX_OFFICE_PREVIEW_BYTES;
    case 'text':
    case 'code':
    case 'markdown':
    case 'csv':
    case 'unknown':
      return MAX_TEXT_PREVIEW_BYTES;
    case 'binary':
    default:
      return MAX_DEFAULT_PREVIEW_BYTES;
  }
}

function previewKindLabel(kind: PreviewKind): string {
  switch (kind) {
    case 'image': return '图片';
    case 'pdf': return 'PDF';
    case 'video': return '视频';
    case 'audio': return '音频';
    case 'archive': return '压缩包';
    case 'docx':
    case 'sheet': return '文档';
    default: return '文件';
  }
}

function checkSizeLimit(state: PreviewState): string | null {
  const size = state.size ?? 0;
  const limit = previewSizeLimitBytes(state.kind);
  if (!size || limit === null) return null;
  if (size > limit) {
    return `${previewKindLabel(state.kind)} ${formatSize(size)} 超过预览上限 ${formatSize(limit)}，请下载后用本地工具查看。`;
  }
  return null;
}

/** 从失败的预览响应里尽量取出可读原因（如 413 时服务端会带 JSON 说明） */
async function previewErrorMessage(res: Response): Promise<string> {
  const base = `HTTP ${res.status}`;
  try {
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('json')) return base;
    const body = (await res.clone().json()) as { error?: string };
    return body && typeof body.error === 'string' && body.error ? `${base} · ${body.error}` : base;
  } catch {
    return base;
  }
}

async function openPreview(state: PreviewState) {
  previewState = state;
  // 顶层文件（state.sourceUrl 不存在）→ 用外层 dialog；ZIP 内文件（sourceUrl 存在）→ 用独立内层 dialog
  activePreview = state.sourceUrl ? previewDom.inner : previewDom.outer;
  activePreview.name.textContent = state.name;
  setPreviewNote(previewMetaLine(state));
  // 下载链接：嵌套文件用 blob URL（API 路径无效），顶层文件用 /api/download/<key>
  activePreview.download.href = state.sourceUrl || apiDownloadUrl(state.key);
  if (state.sourceUrl) activePreview.download.setAttribute('download', state.name);
  else activePreview.download.removeAttribute('download');
  setGalleryNav(Boolean(state.gallery));
  activePreview.body.innerHTML = '<p class="drive-preview__placeholder">载入中…</p>';
  if (!activePreview.dialog.open) activePreview.dialog.showModal();

  // 客户端大小限制（提前拦，省一次下载）
  const sizeError = checkSizeLimit(state);
  if (sizeError) {
    showPreviewError(sizeError);
    return;
  }

  const url = state.sourceUrl || apiPreviewUrl(state.key);

  // 已知二进制 / 其他压缩格式：无法在浏览器内联，直接提示下载（不必发请求）
  if (state.kind === 'binary') {
    showPreviewError(`「.${extOf(state.name)}」格式无法在浏览器中直接预览，请下载后使用本地软件打开。`);
    return;
  }

  // 媒体类：直接走 URL，浏览器自己处理 Range
  if (state.kind === 'image' || state.kind === 'pdf' || state.kind === 'audio' || state.kind === 'video') {
    try {
      // 对 sourceUrl（blob URL）不发 Range 探测；API URL 才探测
      if (state.sourceUrl) {
        renderMediaPreview(activePreview.body, state, url);
      } else {
        const probe = await fetch(url, { headers: { Range: 'bytes=0-0' } });
        if (!probe.ok && probe.status !== 206) {
          showPreviewError(`预览失败：${await previewErrorMessage(probe)}`);
          return;
        }
        renderMediaPreview(activePreview.body, state, url);
      }
    } catch (err) {
      showPreviewError(`请求失败：${escapeHtml(readError(err))}`);
    }
    return;
  }

  // docx / 表格：拿 ArrayBuffer 本地解析（docx 用 mammoth；xlsx/xlsm/xls/ods 用 SheetJS）
  if (state.kind === 'docx' || state.kind === 'sheet') {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        showPreviewError(`预览失败：${await previewErrorMessage(res)}`);
        return;
      }
      const buffer = await res.arrayBuffer();
      const ext = extOf(state.name);
      if (ext === 'docx') {
        await renderDocxPreview(activePreview.body, state, buffer);
      } else if (ext === 'doc') {
        // .doc 老版二进制：无成熟浏览器端解析，明确提示下载
        activePreview.body.innerHTML = `<p class="drive-preview__placeholder">暂不支持 .doc（老版二进制）格式预览，请使用下载后用 WPS / Office 打开。</p>`;
      } else {
        await renderSpreadsheetPreview(activePreview.body, buffer);
      }
    } catch (err) {
      showPreviewError(`请求失败：${escapeHtml(readError(err))}`);
    }
    return;
  }

  // 压缩包：仅在「顶层 zip」走这条分支（archiveState.zip 是新打开的）。
  // 嵌套 zip 由 openNestedArchive 处理（直接替换 archiveState）。
  if (state.kind === 'archive' && !archiveState) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        showPreviewError(`预览失败：${await previewErrorMessage(res)}`);
        return;
      }
      const buffer = await res.arrayBuffer();
      const zip = await JSZip.loadAsync(buffer);
      archiveState = { zip, zipKey: state.key, zipName: state.name, innerPath: '' };
      // 顶层压缩包也用外层 dialog 展示
      activePreview = previewDom.outer;
      renderArchiveEntries();
    } catch (err) {
      showPreviewError(`加载压缩包失败：${escapeHtml(readError(err))}`);
    }
    return;
  }

  // 文本类：拿 text，本地渲染
  try {
    const res = await fetch(url);
    if (!res.ok) {
      showPreviewError(`预览失败：${await previewErrorMessage(res)}`);
      return;
    }
    const text = await res.text();
    if (state.kind === 'markdown') setPreviewNote(previewMetaLine(state) + ' · Markdown 渲染');
    else if (state.kind === 'code') {
      const lang = languageFor(state.name);
      setPreviewNote(previewMetaLine(state) + (lang ? ` · ${lang}` : ' · 自动识别语言'));
    } else if (state.kind === 'csv') {
      setPreviewNote(previewMetaLine(state) + ' · CSV/TSV 表格');
    } else {
      setPreviewNote(previewMetaLine(state) + ` · 文本/未知类型预览（最多 ${formatSize(MAX_TEXT_PREVIEW_BYTES)}）`);
    }
    await renderTextPreview(activePreview.body, state, text);
  } catch (err) {
    showPreviewError(`请求失败：${escapeHtml(readError(err))}`);
  }
}

function navigateGallery(delta: -1 | 1) {
  const state = previewState;
  if (!state?.gallery) return;
  const { keys, names } = state.gallery;
  const nextIndex = (state.gallery.index + delta + keys.length) % keys.length;
  const nextKey = keys[nextIndex];
  const nextName = names[nextIndex];
  const next: PreviewState = {
    ...state,
    key: nextKey,
    name: nextName,
    gallery: { ...state.gallery, index: nextIndex },
  };
  void openPreview(next);
}

// ---------- 多选 ----------

function setSelectionMode(on: boolean) {
  selectionMode = on;
  if (refs.list) refs.list.dataset.selectionMode = on ? 'true' : 'false';
  if (refs.selectToggle) {
    refs.selectToggle.dataset.active = on ? 'true' : 'false';
    refs.selectToggle.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  if (!on) clearSelection();
}

function clearSelection() {
  if (selected.size === 0) return;
  selected.clear();
  refs.list?.querySelectorAll<HTMLInputElement>('input[data-select]').forEach((el) => {
    el.checked = false;
    el.indeterminate = false;
  });
  updateActionBar();
}

function toggleSelect(key: string, checked: boolean) {
  if (checked) selected.add(key);
  else selected.delete(key);
  updateActionBar();
}

function selectAllInCurrent() {
  if (!lastList) return;
  for (const f of lastList.folders) selected.add(f.key);
  for (const f of lastList.files) selected.add(f.key);
  refs.list?.querySelectorAll<HTMLInputElement>('input[data-select]').forEach((el) => {
    el.checked = true;
    el.indeterminate = false;
  });
  updateActionBar();
}

function updateActionBar() {
  const count = selected.size;
  if (count === 0) {
    refs.actionbar.hidden = true;
  } else {
    refs.actionbar.hidden = false;
    refs.actionbarCount.textContent = `已选 ${count} 项`;
  }
}

// ---------- 列表行 ----------

function makeLinkAction(icon: string, label: string, href: string, download: boolean, name?: string, size?: number): HTMLAnchorElement {
  const a = document.createElement('a');
  a.href = href;
  a.className = 'drive-row__action';
  a.title = label;
  a.setAttribute('aria-label', label);
  if (download) a.setAttribute('download', '');
  a.innerHTML = `${icon}<span>${label}</span>`;
  // 下载类 anchor：点一下弹个 toast 提醒用户「已触发」；不 preventDefault，
  // 让浏览器继续按 download 属性处理真正的下载流程
  if (download && name) {
    a.addEventListener('click', () => notifyDownload(name, size));
  }
  return a;
}

function makeButtonAction(icon: string, label: string, handler: () => void, variant: 'default' | 'danger' = 'default'): HTMLButtonElement {
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
    const kind = fileKind(name);
    iconWrap.dataset.kind = kind === 'docx' || kind === 'doc' || kind === 'sheet' ? 'code' : kind;
  }
  (tpl.querySelector('[data-name]') as HTMLElement).textContent = name;
  (tpl.querySelector('[data-meta]') as HTMLElement).textContent = fileMetaLine(item);

  const checkbox = tpl.querySelector('input[data-select]') as HTMLInputElement;
  if (selected.has(item.key)) checkbox.checked = true;
  checkbox.addEventListener('click', (e) => e.stopPropagation());
  checkbox.addEventListener('change', () => {
    toggleSelect(item.key, checkbox.checked);
  });

  const main = tpl.querySelector('[data-row-main]') as HTMLButtonElement;
  const actions = tpl.querySelector('[data-actions]') as HTMLElement;

  // 主区域行为：
  // - 文件夹：selection OFF → 进入；selection ON → 切换选择
  // - 文件：selection OFF → 无操作（防误触，文件预览/下载走右侧按钮）
  //         selection ON → 切换选择
  main.addEventListener('click', () => {
    if (selectionMode) {
      const willSelect = !selected.has(item.key);
      toggleSelect(item.key, willSelect);
      checkbox.checked = willSelect;
      return;
    }
    if (item.folder) open(item.key);
  });

  if (item.folder) {
    actions.appendChild(makeButtonAction(ICON_PACK, '打包', () => void packFolder(item.key, name)));
  } else {
    const kind = fileKind(name);
    actions.appendChild(
      makeButtonAction(ICON_EYE, '预览', () => {
        pushPathState(item.key); // 让地址栏带上文件路径（可直接分享该预览链接）
        openPreview({
          key: item.key,
          name,
          kind: classifyPreview('', name),
          mime: '',
          size: item.size,
          uploaded: item.uploaded,
          gallery: kind === 'image' && lastList ? buildImageGallery(item.key) : undefined,
        });
      }),
    );
    actions.appendChild(
      makeLinkAction(ICON_DOWNLOAD, '下载', apiDownloadUrl(item.key), true, name, item.size),
    );
  }
  return tpl;
}

function buildImageGallery(currentKey: string) {
  if (!lastList) return undefined;
  const images = lastList.files.filter((f) => fileKind(f.name) === 'image');
  const index = images.findIndex((f) => f.key === currentKey);
  if (index < 0 || images.length < 2) return undefined;
  return {
    keys: images.map((f) => f.key),
    names: images.map((f) => f.name),
    index,
  };
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
  items.forEach((item, i) => {
    const row = makeRow(item);
    // 给前 24 行打 stagger 序号（>24 不再延迟，避免长列表下尾行等太久）
    if (i < 24) row.style.setProperty('--row-index', String(i));
    frag.appendChild(row);
  });
  refs.list!.appendChild(frag);
}

// ---------- 页面切换 loading ----------
//
// 切目录时给「视觉一致性」一个交代：顶部进度条 + 列表区 spinner + 行 stagger。
// - 进度条延迟 150ms 出现：避免请求很快时一闪而过；
// - endLoading 一定要在 finally 里调用（包括 fetch 抛错的情况），否则进度条会卡住。
let progressShowTimer: ReturnType<typeof setTimeout> | null = null;
let progressHideTimer: ReturnType<typeof setTimeout> | null = null;
let loadingActive = false;

function startLoading() {
  loadingActive = true;
  // 列表区：先替换为「spinner + 文字」，让用户立刻知道在请求
  if (refs.list) {
    refs.list.classList.add('drive-list--loading');
    refs.list.setAttribute('aria-busy', 'true');
    refs.list.innerHTML =
      '<div class="drive-loading">' +
      '<span class="drive-spinner" aria-hidden="true"></span>' +
      '<span>正在载入文件…</span>' +
      '</div>';
  }
  // 进度条：150ms 内请求完了就不显示，避免一闪
  if (progressShowTimer) clearTimeout(progressShowTimer);
  progressShowTimer = setTimeout(() => {
    if (!loadingActive) return;
    refs.progress?.classList.remove('drive-progress--done');
    refs.progress?.classList.add('drive-progress--active');
  }, 150);
}

function endLoading() {
  loadingActive = false;
  if (progressShowTimer) {
    clearTimeout(progressShowTimer);
    progressShowTimer = null;
  }
  if (refs.progress?.classList.contains('drive-progress--active')) {
    // 走完到 100% 再淡出
    refs.progress.classList.remove('drive-progress--active');
    refs.progress.classList.add('drive-progress--done');
    if (progressHideTimer) clearTimeout(progressHideTimer);
    progressHideTimer = setTimeout(() => {
      refs.progress?.classList.remove('drive-progress--done');
    }, 700);
  }
  if (refs.list) {
    refs.list.classList.remove('drive-list--loading');
    refs.list.removeAttribute('aria-busy');
    // 重新触发 stagger：先去掉再强制 reflow 再加回来
    refs.list.classList.remove('drive-list--entering');
    void refs.list.offsetWidth;
    refs.list.classList.add('drive-list--entering');
  }
}

async function load() {
  clearSelection();
  // 切目录时清掉搜索索引（搜索范围是当前 prefix，切了就要重算）
  searchIndex = null;
  searchIndexScope = '';
  searchIndexPromise = null;
  startLoading();
  try {
    const data = await api<DriveListResponse>(apiListUrl(prefix));
    lastList = data;
    render(data);
  } catch (error) {
    // 失败也要把列表区填上错误信息；endLoading 会清掉 loading 类
    refs.list!.innerHTML = `<p class="drive-loading">载入失败：${escapeHtml(readError(error))}</p>`;
  } finally {
    // 不管成功失败都要收尾，否则进度条会卡住
    endLoading();
  }
  renderCrumb();
  refs.up!.disabled = !prefix;
  // 文件深链：目录列出来后自动打开预览（如在列表里能找到该文件）
  if (pendingOpenFile) {
    const target = pendingOpenFile;
    pendingOpenFile = null;
    if (lastList && target.startsWith(prefix)) {
      const file = lastList.files.find((f) => f.key === target);
      if (file) {
        setTimeout(() => {
          openPreview({
            key: target,
            name: file.name,
            kind: classifyPreview('', file.name),
            mime: '',
            size: file.size,
            uploaded: file.uploaded,
            gallery: fileKind(file.name) === 'image' ? buildImageGallery(target) : undefined,
          });
        }, 150);
      }
    }
  }
}

/** 渲染面包屑：根目录 / 一段 / 二段 / 当前段（不可点）。每段都是 button 可跳转。 */
function renderCrumb() {
  const host = refs.crumb;
  if (!host) return;
  host.innerHTML = '';
  const parts = prefix.split('/').filter(Boolean);
  // 根段
  const root = document.createElement('button');
  root.type = 'button';
  root.className = 'drive-crumb__seg';
  root.textContent = '根目录';
  root.title = '返回根目录';
  if (prefix === '') {
    root.classList.add('drive-crumb__seg--current');
    root.disabled = true;
  } else {
    root.addEventListener('click', () => open(''));
  }
  host.appendChild(root);
  // 中间段 + 当前段
  let acc = '';
  for (let i = 0; i < parts.length; i++) {
    const sep = document.createElement('span');
    sep.className = 'drive-crumb__sep';
    sep.setAttribute('aria-hidden', 'true');
    sep.textContent = '/';
    host.appendChild(sep);

    acc = `${acc}${parts[i]}/`;
    const isLast = i === parts.length - 1;
    const seg = document.createElement(isLast ? 'span' : 'button');
    seg.className = 'drive-crumb__seg';
    seg.textContent = parts[i];
    seg.title = isLast ? `当前：${acc}` : `进入 ${acc}`;
    if (isLast) {
      seg.classList.add('drive-crumb__seg--current');
    } else {
      (seg as HTMLButtonElement).type = 'button';
      const target = acc;
      seg.addEventListener('click', () => open(target));
    }
    host.appendChild(seg);
  }
}

function open(key: string) {
  if (key === prefix) return;
  pushPathState(key);
  applyPathState(key);
}

// ---------- 地址栏路由（?path=<目录|文件>，支持分享 / 收藏 / 前进后退） ----------

/** 目录 key（以 / 结尾或空串）或文件 key → ?path= 参数值 */
function urlPathParam(key: string): string {
  const parts = key.split('/').filter(Boolean).map(encodeURIComponent);
  const dirSuffix = key !== '' && key.endsWith('/') && parts.length > 0 ? '/' : '';
  return parts.join('/') + dirSuffix;
}

/** 生成带 ?path= 的地址（保留当前 pathname，替换 query） */
function urlForPath(key: string): string {
  const param = urlPathParam(key);
  const query = param ? `?path=${param}` : '';
  const keep = location.origin + location.pathname;
  return `${keep}${query}${location.hash}`;
}

/**
 * 从地址栏解析当前位置。
 * ?path 以 / 结尾 = 目录；否则最后一段视为文件（进入父目录后自动打开预览）。
 */
function parseLocationKey(): { key: string; isDir: boolean } {
  const raw = new URLSearchParams(location.search).get('path') || '';
  if (!raw) return { key: '', isDir: true };
  const isDir = raw.endsWith('/');
  const rawParts = raw.split('/').filter((p) => p.length > 0);
  const parts: string[] = [];
  for (const p of rawParts) {
    let seg: string;
    try {
      seg = decodeURIComponent(p);
    } catch {
      return { key: '', isDir: true };
    }
    if (!seg || seg === '.' || seg === '..' || seg.includes('\\') || seg.includes('\0')) {
      return { key: '', isDir: true };
    }
    parts.push(seg);
  }
  if (parts.length === 0) return { key: '', isDir: true };
  return isDir
    ? { key: `${parts.join('/')}/`, isDir: true }
    : { key: parts.join('/'), isDir: false };
}

/** 当前地址对应的内部 key（文件 = 不带尾斜杠的完整路径；目录/根 = 带尾斜杠 / ''） */
function locationKey(): string {
  return parseLocationKey().key;
}

let applyingState = false;
/** 深链：目录加载完成后要自动打开的顶层文件 key */
let pendingOpenFile: string | null = null;

/** 把 key 写进地址栏（pushState，前进/后退可用）；不触发页面加载 */
function pushPathState(key: string) {
  if (urlForPath(key) === location.href.replace(location.hash, '')) return;
  applyingState = true;
  try {
    history.pushState({ driveKey: key }, '', urlForPath(key));
  } finally {
    applyingState = false;
  }
}

/** 应用内部路径状态并刷新列表（不写历史）。key 为目录时列目录；为文件时进父目录后自动打开 */
function applyPathState(key: string) {
  if (key === '' || key.endsWith('/')) {
    // 回到目录视图时把可能开着的预览层关掉
    if (refs.preview?.open) refs.preview.close();
    if (refs.previewInner?.open) refs.previewInner.close();
    pendingOpenFile = null;
    prefix = key;
    load();
    return;
  }
  const last = key.lastIndexOf('/');
  prefix = last >= 0 ? key.slice(0, last + 1) : '';
  pendingOpenFile = key;
  load();
}

// ---------- 客户端流式打包 ----------
//
// 目标：把「打包整个文件夹」的内存占用压到 O(1)，并且像下载普通文件一样落盘。
//   递归 list 收集文件（只需 PROPFIND，不占大内存）→ 限并发 fetch → client-zip 流式打 zip
//   → StreamSaver：数据经 Service Worker 通道喂给一个伪装成下载响应的流，
//     浏览器把它当成普通下载写进磁盘（出现在下载栏，内存只占当前 chunk）；
//   不支持 Service Worker / 非安全上下文的浏览器 → 回退 Blob + <a download>（整包在内存）。
// 不再把 50GB 的文件全 fetch 完 + 攒成一个大 Blob（那会 OOM）。

async function collectFiles(rootKey: string, onProgress?: (count: number) => void): Promise<{ key: string; relPath: string }[]> {
  const out: { key: string; relPath: string }[] = [];
  async function walk(p: string) {
    const data = await api<DriveListResponse>(apiListUrl(p));
    for (const f of data.folders) {
      onProgress?.(out.length);
      await walk(f.key);
    }
    for (const f of data.files) {
      out.push({ key: f.key, relPath: f.key.slice(rootKey.length) });
      onProgress?.(out.length);
    }
  }
  await walk(rootKey);
  return out;
}

/** 同时进行的文件 fetch 数（3~6 个并发，避免一次全开把 pending 连接/服务端压力/缓存打满） */
const ZIP_FETCH_CONCURRENCY = 3;

interface ZipSlot {
  ok: boolean;
  name: string;
  res?: Response;
  error?: Error;
}

/** 打包输入：zip 内的相对路径 + 存储 key */
type ZipItem = { name: string; key: string };
/** 进度回调：已打包 done/total 个文件 */
type ZipProgress = (done: number, total: number) => void;

/**
 * 生成 client-zip 的输入流：**限并发**预取文件，并按原顺序 yield。
 * 只维护 ZIP_FETCH_CONCURRENCY 个在途请求，其余按需补充；
 * 在途的 Response body 不会被消费，配合 client-zip 流式写出 + 磁盘 backpressure，
 * 内存只占「当前网络 chunk + zip encoder buffer + 写盘 buffer」。
 */
async function* createZipInput(
  items: ZipItem[],
  onProgress?: ZipProgress,
): AsyncGenerator<{ name: string; input: Response }> {
  const controllers = new Map<number, AbortController>();
  const pendings = new Map<number, Promise<ZipSlot>>();

  const start = (index: number) => {
    const ctrl = new AbortController();
    controllers.set(index, ctrl);
    const name = items[index].name;
    const p = fetch(apiDownloadUrl(items[index].key), { signal: ctrl.signal }).then(
      (res) => ({ ok: res.ok, name, res }),
      (error: unknown) => ({ ok: false, name, error: error instanceof Error ? error : new Error(String(error)) }),
    );
    pendings.set(index, p);
    return p;
  };

  // 预填首窗口
  for (let i = 0; i < Math.min(ZIP_FETCH_CONCURRENCY, items.length); i++) start(i);

  try {
    for (let i = 0; i < items.length; i++) {
      const slot = await pendings.get(i)!;
      pendings.delete(i);
      controllers.delete(i);
      if (!slot.ok || !slot.res) throw slot.error ?? new Error(`下载 ${slot.name} 失败`);
      if (!slot.res.ok) throw new Error(`下载 ${slot.name} 失败：HTTP ${slot.res.status}`);
      onProgress?.(i + 1, items.length);
      const next = i + ZIP_FETCH_CONCURRENCY;
      if (next < items.length) start(next);
      yield { name: slot.name, input: slot.res };
    }
  } finally {
    // 出错/提前结束：取消仍挂在途的请求，避免泄漏连接
    for (const [, ctrl] of controllers) {
      try { ctrl.abort(); } catch { /* ignore */ }
    }
  }
}

/** StreamSaver 静态资源位置（sw.js / mitm.html 由 scripts/sync-streamsaver.mjs 同步进 public/） */
const STREAMSAVER_MITM_URL = '/streamsaver/mitm.html';

/** 打包下载方式：'streamsaver' = Service Worker 流式下载（可用时）；'blob' = 始终 Blob 普通下载 */
type DownloadMode = 'streamsaver' | 'blob';
const DL_MODE_KEY = 'drive.downloadMode';
const DL_MODE_LABEL: Record<DownloadMode, string> = { streamsaver: 'SW 下载', blob: 'Blob 下载' };
const DL_MODE_TITLE: Record<DownloadMode, string> = {
  streamsaver: '打包下载：Service Worker 流式下载（默认，不占内存，下载栏可见）。点击切换为 Blob 普通下载（整包在内存，兼容旧环境 / dev 偏慢时可切）。',
  blob: '打包下载：Blob 普通下载（整包在内存，兼容旧环境）。点击切换为 Service Worker 流式下载（默认，不占内存）。',
};

function readDownloadMode(): DownloadMode {
  try {
    return localStorage.getItem(DL_MODE_KEY) === 'blob' ? 'blob' : 'streamsaver';
  } catch {
    return 'streamsaver';
  }
}
function persistDownloadMode(mode: DownloadMode) {
  try { localStorage.setItem(DL_MODE_KEY, mode); } catch { /* ignore */ }
}

let downloadMode: DownloadMode = readDownloadMode();

function renderDownloadModeButton() {
  if (!refs.dlMode) return;
  refs.dlMode.dataset.mode = downloadMode;
  refs.dlMode.setAttribute('aria-pressed', String(downloadMode === 'streamsaver'));
  refs.dlMode.title = DL_MODE_TITLE[downloadMode];
  if (refs.dlModeLabel) refs.dlModeLabel.textContent = DL_MODE_LABEL[downloadMode];
}

function cycleDownloadMode() {
  downloadMode = downloadMode === 'streamsaver' ? 'blob' : 'streamsaver';
  persistDownloadMode(downloadMode);
  renderDownloadModeButton();
}

/** 当前是否要走 StreamSaver（用户选了 blob 就永远不走） */
function shouldUseStreamSaver(): boolean {
  return downloadMode !== 'blob' && streamSaverUsable();
}

let streamSaverMitmConfigured = false;

/** StreamSaver 需要 Service Worker + 安全上下文（https 或 localhost）；否则直接走 Blob */
function streamSaverUsable(): boolean {
  if (typeof window === 'undefined') return false;
  if (!('serviceWorker' in navigator)) return false;
  if (!window.isSecureContext) return false;
  return true;
}

/** 创建 StreamSaver 的下载流（首次使用时把 mitm 指到自托管地址） */
function streamSaverDownload(fileName: string): WritableStream<Uint8Array> {
  if (!streamSaverMitmConfigured) {
    streamSaver.mitm = STREAMSAVER_MITM_URL;
    streamSaverMitmConfigured = true;
  }
  return streamSaver.createWriteStream(fileName);
}

/** 目标块大小：把细碎小 chunk 合并成大块再喂给 StreamSaver（跨线程 postMessage 按块数计开销） */
const STREAMSAVER_CHUNK_BYTES = 256 * 1024;

/**
 * 合并小 chunk 的 TransformStream。
 * dev（wrangler pages dev）里上游/代理常吐出很小的 chunk，若逐块 postMessage 给
 * Service Worker，跨线程拷贝 + 消息开销会把下载拖慢；合并到 ~256KB 再送一次能明显提速。
 */
function coalesceChunks(targetBytes: number): TransformStream<Uint8Array, Uint8Array> {
  let parts: Uint8Array[] = [];
  let total = 0;
  const emit = (controller: TransformStreamDefaultController<Uint8Array>) => {
    if (parts.length === 0) return;
    if (parts.length === 1) {
      controller.enqueue(parts[0]);
    } else {
      const out = new Uint8Array(total);
      let offset = 0;
      for (const part of parts) {
        out.set(part, offset);
        offset += part.byteLength;
      }
      controller.enqueue(out);
    }
    parts = [];
    total = 0;
  };
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (chunk.byteLength >= targetBytes) {
        emit(controller);
        controller.enqueue(chunk);
        return;
      }
      parts.push(chunk);
      total += chunk.byteLength;
      if (total >= targetBytes) emit(controller);
    },
    flush(controller) {
      emit(controller);
    },
  });
}

/** Blob 兜底：zip 流 → blob → 临时 <a> 触发下载（无 Service Worker / 非 https 的浏览器） */
async function saveZipAsBlob(
  fileName: string,
  items: ZipItem[],
  onProgress?: ZipProgress,
): Promise<{ streamed: false; size: number }> {
  const blob = await downloadZip(createZipInput(items, onProgress)).blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return { streamed: false, size: blob.size };
}

/**
 * 把 items 打包成 zip 并触发浏览器下载。返回 { streamed, size }：
 * - streamed === true  → 走了 StreamSaver（浏览器原生下载栏，流式写盘）；
 * - streamed === false → 回退 Blob 落盘（size 为 zip 字节数）。
 *
 * useStreamSaver 由调用方按「用户选择的下载方式」传入：
 * - 用户选了 Blob → 直接 Blob；
 * - 用户选了 Service Worker → 环境可用才走 SW；SW 初始化/中途失败都会**重建
 *   zip 管线**（重新限并发 fetch 全部文件）用 Blob 再试一次，保证尽量有文件可下。
 */
async function saveZipStream(
  fileName: string,
  items: ZipItem[],
  onProgress?: ZipProgress,
  useStreamSaver = true,
): Promise<{ streamed: boolean; size: number }> {
  if (useStreamSaver && streamSaverUsable()) {
    try {
      let fileStream: WritableStream<Uint8Array>;
      try {
        fileStream = streamSaverDownload(fileName);
      } catch (err) {
        // 初始化就失败（如 SW 注册被拒）：直接走 Blob，别再试 StreamSaver
        console.warn('[打包] StreamSaver 初始化失败，回退 Blob:', err);
        return saveZipAsBlob(fileName, items, onProgress);
      }
      const response = downloadZip(createZipInput(items, onProgress));
      if (!response.body) throw new Error('无法读取 ZIP 输出流');
      // 合并小 chunk 后再 pipeTo，避免逐小块跨线程 postMessage 拖慢下载。
      // 不要 preventClose：pipeTo 结束时正常 close → StreamSaver 发 'end' 收尾下载。
      await response.body.pipeThrough(coalesceChunks(STREAMSAVER_CHUNK_BYTES)).pipeTo(fileStream);
      return { streamed: true, size: 0 };
    } catch (err) {
      console.warn('[打包] StreamSaver 下载中断，改用 Blob 重试:', err);
      // fallthrough → Blob
    }
  }
  return saveZipAsBlob(fileName, items, onProgress);
}

async function packFolder(folderKey: string, folderName: string) {
  if (!folderKey.endsWith('/')) folderKey = `${folderKey}/`;
  const t = toast(`正在打包「${folderName}」…`, '正在收集文件…');
  t.setProgress(null);

  let files: { key: string; relPath: string }[];
  try {
    files = await collectFiles(folderKey, (count) => t.setDetail(`已发现 ${count} 个文件`));
  } catch (err) {
    t.done('error', `收集失败：${readError(err)}`);
    return;
  }
  if (files.length === 0) {
    t.done('error', '文件夹为空');
    return;
  }
  t.setDetail(`共 ${files.length} 个文件，开始流式打包…`);

  const items = files.map((f) => ({ name: `${folderName}/${f.relPath}`, key: f.key }));
  const viaSw = shouldUseStreamSaver();
  t.setDetail(viaSw
    ? `共 ${files.length} 个文件 · Service Worker 流式下载中…`
    : `共 ${files.length} 个文件 · 按设置使用 Blob 打包（整包在内存）…`);

  const onProgress: ZipProgress = (done, total) => t.setDetail(`已打包 ${done}/${total} 个文件${viaSw ? '，浏览器下载中…' : '…'}`);
  try {
    const { streamed, size } = await saveZipStream(`${folderName}.zip`, items, onProgress, viaSw);
    t.done('success', streamed
      ? `打包完成：${folderName}.zip · ${files.length} 个文件（已进入浏览器下载栏）`
      : `已保存为 ${folderName}.zip · ${formatSize(size)} · ${files.length} 个文件（普通下载）${downloadMode === 'streamsaver' ? ' · 本次未能走 Service Worker' : ''}`);
  } catch (err) {
    t.done('error', `打包失败：${readError(err)}`);
  }
}

async function packSelected() {
  const keys = Array.from(selected);
  if (keys.length === 0) return;

  const folderKeys = keys.filter((k) => k.endsWith('/'));
  const fileKeys = keys.filter((k) => !k.endsWith('/'));

  const t = toast(`正在打包 ${keys.length} 个选中项…`, '正在收集文件…');
  t.setProgress(null);

  const items: ZipItem[] = [];
  for (const k of fileKeys) {
    const rel = k.slice(prefix.length);
    if (!rel) continue;
    items.push({ name: rel, key: k });
  }
  for (const folderKey of folderKeys) {
    const folderName = folderKey.replace(/\/$/, '').split('/').pop()!;
    let sub: { key: string; relPath: string }[];
    try {
      sub = await collectFiles(folderKey);
    } catch (err) {
      t.done('error', `收集失败：${readError(err)}`);
      return;
    }
    for (const f of sub) {
      items.push({ name: `${folderName}/${f.relPath}`, key: f.key });
    }
  }

  if (items.length === 0) {
    t.done('error', '没有可打包的文件');
    return;
  }
  t.setDetail(`共 ${items.length} 个文件，开始流式打包…`);

  const base = `selection-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
  const viaSw = shouldUseStreamSaver();
  t.setDetail(viaSw
    ? `共 ${items.length} 个文件 · Service Worker 流式下载中…`
    : `共 ${items.length} 个文件 · 按设置使用 Blob 打包（整包在内存）…`);
  const onProgress: ZipProgress = (done, total) => t.setDetail(`已打包 ${done}/${total} 个文件${viaSw ? '，浏览器下载中…' : '…'}`);
  try {
    const { streamed, size } = await saveZipStream(base, items, onProgress, viaSw);
    t.done('success', streamed
      ? `打包完成：${base} · ${items.length} 个文件（已进入浏览器下载栏）`
      : `已保存为 ${base} · ${formatSize(size)} · ${items.length} 个文件（普通下载）${downloadMode === 'streamsaver' ? ' · 本次未能走 Service Worker' : ''}`);
  } catch (err) {
    t.done('error', `打包失败：${readError(err)}`);
  }
}

// ---------- 搜索 ----------

/** 为当前 prefix 构建子树索引。切目录后旧索引作废（由 load 清掉） */
async function buildIndex(scope: string): Promise<Map<string, IndexEntry>> {
  if (searchIndex && searchIndexScope === scope) return searchIndex;
  if (searchIndexPromise && searchIndexScope === scope) return searchIndexPromise;

  searchIndexScope = scope;
  searchIndex = null;
  searchIndexPromise = (async () => {
    const idx = new Map<string, IndexEntry>();
    const queue: string[] = [scope];
    while (queue.length) {
      const p = queue.shift()!;
      const data = await api<DriveListResponse>(apiListUrl(p));
      for (const f of data.folders) {
        idx.set(f.key, { key: f.key, name: f.name, folder: true, parent: p, uploaded: f.uploaded, scopePrefix: scope });
        queue.push(f.key);
      }
      for (const f of data.files) {
        idx.set(f.key, { key: f.key, name: f.name, folder: false, parent: p, size: f.size, uploaded: f.uploaded, scopePrefix: scope });
      }
    }
    searchIndex = idx;
    return idx;
  })();

  return searchIndexPromise;
}

function renderSearchStatus(text: string, tone?: 'info' | 'warn') {
  refs.searchStatus.textContent = text;
  if (tone) refs.searchStatus.dataset.tone = tone;
  else refs.searchStatus.removeAttribute('data-tone');
}

/** 把 entry.key 拆成面包屑段：scopePrefix 之前（根的祖先） + scope 内的层级 */
function breadcrumbFor(entry: IndexEntry): { segments: { name: string; prefix: string }[]; filename: string } {
  const segments: { name: string; prefix: string }[] = [];
  // 从 entry.key 拆出相对 scopePrefix 的部分，再按 '/' 切段
  const rel = entry.key.slice(entry.scopePrefix.length);
  const parts = rel.split('/').filter((p) => p.length > 0);
  // 最后一个是 filename（不算路径段）
  const filename = entry.folder ? '' : (parts.pop() ?? '');
  // 累积生成每段的 prefix
  let acc = entry.scopePrefix;
  for (const part of parts) {
    acc = `${acc}${part}/`;
    segments.push({ name: part, prefix: acc });
  }
  return { segments, filename: filename || entry.name };
}

function renderSearchResults(results: IndexEntry[], query: string) {
  refs.searchResults.innerHTML = '';
  if (results.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'drive-search__empty';
    empty.textContent = query ? `没有匹配「${query}」的结果` : '没有匹配项';
    refs.searchResults.appendChild(empty);
    return;
  }
  const frag = document.createDocumentFragment();
  for (const e of results) {
    const li = document.createElement('li');
    li.className = 'drive-search__item';
    const { segments, filename } = breadcrumbFor(e);

    const iconWrap = document.createElement('span');
    iconWrap.className = 'drive-search__item-icon';
    iconWrap.innerHTML = e.folder ? ICON_FOLDER : fileIcon(e.name);
    if (!e.folder) {
      const kind = fileKind(e.name);
      iconWrap.dataset.kind = kind === 'docx' || kind === 'doc' || kind === 'sheet' ? 'code' : kind;
    }

    const body = document.createElement('div');
    body.className = 'drive-search__item-body';

    const name = document.createElement('div');
    name.className = 'drive-search__item-name';
    name.innerHTML = highlightMatch(filename, query);
    if (e.folder) {
      name.classList.add('drive-search__item-name--folder');
    }

    const crumb = document.createElement('div');
    crumb.className = 'drive-search__item-crumb';
    // 根段：固定一个 / 链接，prefix 为空 = 根目录
    const rootSeg = document.createElement('button');
    rootSeg.type = 'button';
    rootSeg.className = 'drive-search__crumb';
    rootSeg.textContent = '/';
    rootSeg.title = '回到根目录';
    rootSeg.addEventListener('click', (ev) => { ev.stopPropagation(); closeSearch(); open(''); });
    crumb.appendChild(rootSeg);
    // 中间段：scopePrefix 内的层级
    for (const seg of segments) {
      const slash = document.createElement('span');
      slash.className = 'drive-search__crumb-sep';
      slash.textContent = ' / ';
      crumb.appendChild(slash);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'drive-search__crumb';
      btn.textContent = seg.name;
      btn.title = `进入 ${seg.prefix || '根目录'}`;
      const target = seg.prefix;
      btn.addEventListener('click', (ev) => { ev.stopPropagation(); closeSearch(); open(target); });
      crumb.appendChild(btn);
    }
    body.append(name, crumb);

    const meta = document.createElement('span');
    meta.className = 'drive-search__item-meta';
    meta.textContent = e.folder ? '' : formatSize(e.size);

    li.append(iconWrap, body, meta);
    li.tabIndex = 0;
    li.addEventListener('click', () => navigateToResult(e));
    li.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        navigateToResult(e);
      }
    });
    frag.appendChild(li);
  }
  refs.searchResults.appendChild(frag);
}

function highlightMatch(name: string, query: string): string {
  const safe = escapeHtml(name);
  if (!query) return safe;
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return safe.replace(new RegExp(escapedQuery, 'gi'), (m) => `<mark>${m}</mark>`);
}

function navigateToResult(entry: IndexEntry) {
  closeSearch();
  if (entry.folder) {
    open(entry.key);
    return;
  }
  const parent = entry.parent;
  pushPathState(entry.key); // 让地址栏带上文件路径
  if (parent !== prefix) {
    prefix = parent;
    load();
  }
  setTimeout(() => {
    openPreview({
      key: entry.key,
      name: entry.name,
      kind: classifyPreview('', entry.name),
      mime: '',
      size: entry.size,
      uploaded: entry.uploaded,
    });
  }, 250);
}

async function runSearch(query: string) {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(async () => {
    const q = query.trim();
    if (!q) {
      renderSearchStatus(`输入关键词开始搜索（搜索范围：${prefix || '根目录'} 及子目录）`);
      renderSearchResults([], '');
      return;
    }
    renderSearchStatus(`正在构建索引（范围：${prefix || '根目录'}）…`);
    let idx: Map<string, IndexEntry>;
    try {
      idx = await buildIndex(prefix);
    } catch (err) {
      renderSearchStatus(`索引失败：${readError(err)}`, 'warn');
      return;
    }
    const lower = q.toLowerCase();
    const results: IndexEntry[] = [];
    for (const e of idx.values()) {
      if (e.name.toLowerCase().includes(lower)) results.push(e);
    }
    results.sort((a, b) => {
      if (a.folder !== b.folder) return a.folder ? -1 : 1;
      return a.name.localeCompare(b.name, 'zh-Hans-CN');
    });
    renderSearchStatus(
      results.length === 0
        ? `共 ${idx.size} 项，0 个匹配`
        : `共 ${idx.size} 项，匹配 ${results.length} 个`,
    );
    renderSearchResults(results.slice(0, 200), q);
  }, 200);
}

function openSearch() {
  if (refs.searchModal.open) return;
  refs.searchInput.value = '';
  renderSearchStatus(`输入关键词开始搜索（搜索范围：${prefix || '根目录'} 及子目录）`);
  renderSearchResults([], '');
  refs.searchModal.showModal();
  setTimeout(() => refs.searchInput.focus(), 30);
}

function closeSearch() {
  if (refs.searchModal.open) refs.searchModal.close();
}

// ---------- 事件绑定 ----------

function bind() {
  refs.up?.addEventListener('click', () => {
    open(prefix.replace(/[^/]+\/$/, ''));
  });

  // ----- 外层预览 dialog（顶层文件 / ZIP 内容浏览器） -----
  refs.previewClose?.addEventListener('click', () => refs.preview?.close());
  // 关闭外层时清掉 archive 状态；如果内层还开着，一起关掉避免孤立
  refs.preview?.addEventListener('close', () => {
    cleanupArchiveState();
    if (refs.previewInner.open) refs.previewInner.close();
  });
  refs.previewPrev?.addEventListener('click', () => navigateGallery(-1));
  refs.previewNext?.addEventListener('click', () => navigateGallery(1));
  // 保留 ESC 关闭；不再「点击空白处关闭」——必须用右上角 ✕ 关闭按钮
  refs.preview?.addEventListener('keydown', (e) => {
    if (!previewState?.gallery) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); navigateGallery(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); navigateGallery(1); }
  });
  // 预览里的「下载」按钮：点一下弹 toast 提醒；不阻止浏览器继续按 download 属性下载
  refs.previewDownload?.addEventListener('click', () => {
    const a = refs.previewDownload;
    if (!a) return;
    // href 还没被 openPreview 写好时是 '#'，忽略（不应该被点中，但保险）
    if (!a.getAttribute('href') || a.getAttribute('href') === '#') return;
    const name = a.getAttribute('download') || previewState?.name || '文件';
    notifyDownload(name, previewState?.size);
  });

  // ----- 内层预览 dialog（ZIP 内文件预览；独立层，关闭不影响外层） -----
  refs.previewInnerClose?.addEventListener('click', () => refs.previewInner?.close());
  // 关闭内层只清掉当前持有的 blob URL，不动外层 archive state
  refs.previewInner?.addEventListener('close', () => {
    setBlobUrl(null);
    // 回到默认 outer 引用；下次顶层预览直接用 outer
    activePreview = previewDom.outer;
  });
  refs.previewInnerPrev?.addEventListener('click', () => navigateGallery(-1));
  refs.previewInnerNext?.addEventListener('click', () => navigateGallery(1));
  // 内层预览（ZIP 内文件）的下载按钮同理
  refs.previewInnerDownload?.addEventListener('click', () => {
    const a = refs.previewInnerDownload;
    if (!a) return;
    if (!a.getAttribute('href') || a.getAttribute('href') === '#') return;
    const name = a.getAttribute('download') || previewState?.name || '文件';
    notifyDownload(name, previewState?.size);
  });
  refs.previewInner?.addEventListener('keydown', (e) => {
    if (!previewState?.gallery) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); navigateGallery(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); navigateGallery(1); }
  });

  refs.selectToggle?.addEventListener('click', () => setSelectionMode(!selectionMode));
  // 打包下载方式切换（Service Worker 流式 ↔ Blob）
  refs.dlMode?.addEventListener('click', () => cycleDownloadMode());
  refs.actionbarAll?.addEventListener('click', () => selectAllInCurrent());
  refs.actionbarPack?.addEventListener('click', () => void packSelected());
  refs.actionbarClear?.addEventListener('click', () => clearSelection());

  refs.searchBtn?.addEventListener('click', () => openSearch());
  refs.searchClose?.addEventListener('click', () => closeSearch());
  refs.searchInput?.addEventListener('input', () => void runSearch(refs.searchInput.value));
  // 保留 ESC 关闭搜索弹窗；不再「点击空白处关闭」——必须用右上角 ✕ 关闭按钮
  refs.searchModal?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
  });

  // 地址栏路由：浏览器前进/后退
  window.addEventListener('popstate', () => {
    if (applyingState) return;
    const state = history.state as { driveKey?: string } | null;
    applyPathState(state && typeof state.driveKey === 'string' ? state.driveKey : locationKey());
  });
}

// 初始 selection mode 状态
setSelectionMode(false);
// 下载方式按钮显示当前选择
renderDownloadModeButton();

bind();
// 启动：按地址栏 ?path= 深链定位（无参数 = 根目录）
applyPathState(locationKey());
