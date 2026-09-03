/**
 * Drive 前端逻辑（只读版 · v0.3）
 *
 * 设计原则：
 *   - 整个应用是 WebDAV 的「只读浏览器 + 客户端打包器」。
 *   - 后端只做：列目录 / 单文件下载 / 预览 / 必要的元数据；不做任何写操作、不做 auth。
 *   - 文件夹打包在浏览器里用 client-zip 流式完成；不需要服务端 zip。
 *
 * 行为：
 *   - 列表：GET /api/list?prefix=...
 *   - 单文件下载：直接 <a href="/api/download?path=...">
 *   - 预览：GET /api/preview?path=...（含 Range 透传，视频/音频可拖进度条）
 *   - 文件夹打包：递归 list → 并发 fetch 每文件 → client-zip 流式打 zip → 浏览器落盘
 *   - 增强预览：图片灯箱（同一目录左右切换）、代码高亮、Markdown 渲染、元数据
 *
 * 交互约定：
 *   - 文件夹：点行主区域进入；右侧 进入 / 打包
 *   - 文件：行主区域不触发预览（防误触）；右侧 预览 / 下载
 *   - 所有操作都有 toast 反馈：进行中 → 成功 / 失败
 */

import { downloadZip } from 'client-zip';
import { marked } from 'marked';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import json from 'highlight.js/lib/languages/json';
import yaml from 'highlight.js/lib/languages/yaml';
import bash from 'highlight.js/lib/languages/bash';
import markdown from 'highlight.js/lib/languages/markdown';
import rust from 'highlight.js/lib/languages/rust';
import go from 'highlight.js/lib/languages/go';
import sql from 'highlight.js/lib/languages/sql';
import 'highlight.js/styles/atom-one-dark.css';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('css', css);
hljs.registerLanguage('json', json);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('go', go);
hljs.registerLanguage('sql', sql);

// ---------- 类型 ----------

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

type PreviewKind = 'image' | 'pdf' | 'audio' | 'video' | 'code' | 'markdown' | 'text' | 'unknown';

interface PreviewState {
  key: string;
  name: string;
  kind: PreviewKind;
  mime: string;
  size?: number;
  uploaded?: string;
  // 图片灯箱上下文：同目录下其他图片
  gallery?: { keys: string[]; names: string[]; index: number };
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
const ICON_EYE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>';
const ICON_DOWNLOAD =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v12M6 12l6 6 6-6"/></svg>';
const ICON_PACK =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/><path d="M12 10v6M9 13l3 3 3-3"/></svg>';

const ICON_EXT_KIND: Record<string, string> = {
  image: ICON_FILE_IMAGE,
  video: ICON_FILE_VIDEO,
  audio: ICON_FILE_AUDIO,
  pdf: ICON_FILE_PDF,
  archive: ICON_FILE_ARCHIVE,
  text: ICON_FILE_TEXT,
  code: ICON_FILE_CODE,
};
const CODE_EXTS = new Set([
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx',
  'css', 'scss', 'less',
  'html', 'htm', 'xml', 'vue', 'svelte',
  'py', 'rb', 'rs', 'go', 'java', 'kt', 'swift',
  'c', 'cc', 'cpp', 'h', 'hpp', 'm', 'mm',
  'php', 'sh', 'bash', 'zsh', 'ps1', 'sql', 'lua', 'r', 'dart', 'toml', 'yaml', 'yml',
  'json', 'jsonc', 'json5',
]);
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'heic', 'ico']);
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v']);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'flac', 'ogg', 'm4a', 'opus', 'aac']);
const ARCHIVE_EXTS = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz']);
const TEXT_EXTS = new Set(['txt', 'md', 'markdown', 'log', 'csv', 'tsv', 'ini', 'conf', 'env', 'rst']);

/** 根据文件名返回图标 svg */
function fileIcon(name: string): string {
  const kind = fileKind(name);
  return ICON_EXT_KIND[kind] ?? ICON_FILE_DEFAULT;
}

/** 文件类型（决定图标染色 + 预览分支） */
function fileKind(name: string): 'image' | 'video' | 'audio' | 'pdf' | 'code' | 'archive' | 'text' | 'file' {
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (ext === 'pdf') return 'pdf';
  if (ARCHIVE_EXTS.has(ext)) return 'archive';
  if (CODE_EXTS.has(ext)) return 'code';
  if (TEXT_EXTS.has(ext)) return 'text';
  return 'file';
}

function extOf(name: string): string {
  return (name.split('.').pop() ?? '').toLowerCase();
}

// ---------- 状态 ----------

const root = document.documentElement;
let prefix = '';
let lastList: DriveListResponse | null = null;
let previewState: PreviewState | null = null;

const $ = <T extends Element>(sel: string) => root.querySelector(sel) as T | null;

const refs = {
  crumb: $('[data-crumb]') as HTMLElement,
  up: $('[data-up]') as HTMLButtonElement,
  list: $('[data-list]') as HTMLElement,
  notice: $('[data-notice]') as HTMLElement,
  rowTpl: $('[data-row-template]') as HTMLTemplateElement,
  toasts: $('[data-toasts]') as HTMLElement,
  preview: $('[data-preview]') as HTMLDialogElement,
  previewName: $('[data-preview-name]') as HTMLElement,
  previewBody: $('[data-preview-body]') as HTMLElement,
  previewNote: $('[data-preview-note]') as HTMLElement,
  previewDownload: $('[data-preview-download]') as HTMLAnchorElement,
  previewClose: $('[data-preview-close]') as HTMLButtonElement,
  previewPrev: $('[data-preview-prev]') as HTMLButtonElement,
  previewNext: $('[data-preview-next]') as HTMLButtonElement,
};

// ---------- 工具 ----------

function escapeHtml(value: string): string {
  const el = document.createElement('span');
  el.textContent = value;
  return el.innerHTML;
}

function readError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function formatSize(size?: number): string {
  if (!size) return '—';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDate(input?: string): string {
  if (!input) return '';
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return input;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

function fileMetaLine(item: DriveItem): string {
  if (item.folder) return '文件夹';
  const size = formatSize(item.size);
  const date = formatDate(item.uploaded);
  return date ? `${size} · ${date}` : size;
}

function previewMetaLine(state: PreviewState): string {
  const parts: string[] = [];
  parts.push(formatSize(state.size));
  if (state.uploaded) parts.push(formatDate(state.uploaded));
  if (state.gallery) {
    const { index, keys } = state.gallery;
    parts.push(`${index + 1} / ${keys.length}`);
  }
  return parts.join(' · ');
}

async function api<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : ({} as T);
  if (!response.ok) throw new Error((data as { error?: string }).error || '请求失败');
  return data;
}

// ---------- toast ----------

interface ToastHandle {
  setProgress: (pct: number | null) => void;
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
  icon.innerHTML = ICON_PACK;

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

function toastSuccess(title: string, detail?: string) {
  const t = toast(title, detail);
  t.done('success');
}

// ---------- 预览 ----------

function classifyPreview(mime: string, name: string): PreviewKind {
  const m = (mime || '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m === 'application/pdf') return 'pdf';
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('video/')) return 'video';
  const ext = extOf(name);
  if (['md', 'markdown'].includes(ext)) return 'markdown';
  if (CODE_EXTS.has(ext)) return 'code';
  if (m.startsWith('text/') || m === 'application/json' || m === 'application/xml' || m === 'application/javascript' || m === 'application/x-yaml' || m === 'application/ld+json') return 'text';
  return 'unknown';
}

function languageFor(name: string): string | null {
  const map: Record<string, string> = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
    ts: 'typescript', tsx: 'typescript',
    py: 'python',
    html: 'xml', htm: 'xml', xml: 'xml', vue: 'xml', svelte: 'xml',
    css: 'css', scss: 'css', less: 'css',
    json: 'json', jsonc: 'json', json5: 'json',
    yaml: 'yaml', yml: 'yaml',
    sh: 'bash', bash: 'bash', zsh: 'bash',
    md: 'markdown', markdown: 'markdown',
    rs: 'rust',
    go: 'go',
    sql: 'sql',
  };
  return map[extOf(name)] ?? null;
}

function setPreviewNote(text: string, tone?: 'info' | 'warn') {
  refs.previewNote.textContent = text;
  if (tone) refs.previewNote.dataset.tone = tone;
  else refs.previewNote.removeAttribute('data-tone');
}

function setGalleryNav(visible: boolean) {
  refs.previewPrev.hidden = !visible;
  refs.previewNext.hidden = !visible;
}

function renderMediaPreview(state: PreviewState, url: string) {
  const body = refs.previewBody;
  body.innerHTML = '';
  if (state.kind === 'image') {
    const img = document.createElement('img');
    img.alt = state.name;
    img.src = url;
    body.appendChild(img);
    return;
  }
  if (state.kind === 'pdf') {
    const iframe = document.createElement('iframe');
    iframe.src = url;
    iframe.title = state.name;
    body.appendChild(iframe);
    return;
  }
  if (state.kind === 'audio') {
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.preload = 'metadata';
    audio.src = url;
    body.appendChild(audio);
    return;
  }
  if (state.kind === 'video') {
    const video = document.createElement('video');
    video.controls = true;
    video.preload = 'metadata';
    video.src = url;
    body.appendChild(video);
    return;
  }
}

async function renderTextPreview(state: PreviewState, text: string) {
  const body = refs.previewBody;
  body.innerHTML = '';
  if (state.kind === 'markdown') {
    const wrap = document.createElement('article');
    wrap.className = 'drive-preview__markdown';
    wrap.innerHTML = marked.parse(text) as string;
    body.appendChild(wrap);
    return;
  }
  if (state.kind === 'code') {
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    const lang = languageFor(state.name);
    try {
      if (lang) {
        const out = hljs.highlight(text, { language: lang, ignoreIllegals: true });
        code.innerHTML = out.value;
        code.className = `language-${lang} hljs`;
      } else {
        const out = hljs.highlightAuto(text);
        code.innerHTML = out.value;
        code.className = 'hljs';
      }
    } catch {
      code.textContent = text;
    }
    pre.appendChild(code);
    body.appendChild(pre);
    return;
  }
  // 纯文本
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  code.textContent = text;
  pre.appendChild(code);
  body.appendChild(pre);
}

function showPreviewError(message: string) {
  refs.previewBody.innerHTML = `<p class="drive-preview__placeholder">${escapeHtml(message)}</p>`;
  setPreviewNote('请改用下载', 'warn');
}

async function openPreview(state: PreviewState) {
  previewState = state;
  refs.previewName.textContent = state.name;
  setPreviewNote(previewMetaLine(state));
  refs.previewDownload.href = `/api/download?path=${encodeURIComponent(state.key)}`;
  setGalleryNav(Boolean(state.gallery));
  refs.previewBody.innerHTML = '<p class="drive-preview__placeholder">载入中…</p>';
  if (!refs.preview.open) refs.preview.showModal();

  const url = `/api/preview?path=${encodeURIComponent(state.key)}`;
  // 媒体类直接走 URL，浏览器自己会处理 Range（视频/音频拖进度条）
  if (state.kind === 'image' || state.kind === 'pdf' || state.kind === 'audio' || state.kind === 'video') {
    try {
      // 触发一次 HEAD-style 检查：通过 Range: bytes=0-0 探测是否可访问
      const probe = await fetch(url, { headers: { Range: 'bytes=0-0' } });
      if (!probe.ok && probe.status !== 206) {
        showPreviewError(`预览失败：HTTP ${probe.status}`);
        return;
      }
      renderMediaPreview(state, url);
    } catch (err) {
      showPreviewError(`请求失败：${escapeHtml(readError(err))}`);
    }
    return;
  }
  // 文本类需要拿到内容
  try {
    const res = await fetch(url);
    if (!res.ok) {
      showPreviewError(`预览失败：HTTP ${res.status}`);
      return;
    }
    const text = await res.text();
    if (state.kind === 'markdown') {
      setPreviewNote(previewMetaLine(state) + ' · Markdown 渲染');
    } else if (state.kind === 'code') {
      const lang = languageFor(state.name);
      setPreviewNote(previewMetaLine(state) + (lang ? ` · ${lang}` : ' · 自动识别语言'));
    } else {
      setPreviewNote(previewMetaLine(state) + ' · 文本预览（最多 256 KB）');
    }
    await renderTextPreview(state, text);
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

// ---------- 列表行 ----------

function makeLinkAction(icon: string, label: string, href: string, download: boolean): HTMLAnchorElement {
  const a = document.createElement('a');
  a.href = href;
  a.className = 'drive-row__action';
  a.title = label;
  a.setAttribute('aria-label', label);
  if (download) a.setAttribute('download', '');
  a.innerHTML = `${icon}<span>${label}</span>`;
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
    iconWrap.dataset.kind = fileKind(name);
  }
  (tpl.querySelector('[data-name]') as HTMLElement).textContent = name;
  (tpl.querySelector('[data-meta]') as HTMLElement).textContent = fileMetaLine(item);

  const main = tpl.querySelector('[data-row-main]') as HTMLButtonElement;
  const actions = tpl.querySelector('[data-actions]') as HTMLElement;

  if (item.folder) {
    // 文件夹：主区域进入；右侧 进入 / 打包
    main.addEventListener('click', () => open(item.key));
    actions.appendChild(makeButtonAction(ICON_PACK, '打包', () => void packFolder(item.key, name)));
  } else {
    // 文件：主区域不触发预览（防误触）；右侧 预览 / 下载
    const kind = fileKind(name);
    actions.appendChild(
      makeButtonAction(ICON_EYE, '预览', () =>
        openPreview({
          key: item.key,
          name,
          kind: classifyPreview('', name),
          mime: '',
          size: item.size,
          uploaded: item.uploaded,
          // 图片构建灯箱上下文
          gallery: kind === 'image' && lastList ? buildImageGallery(item.key) : undefined,
        }),
      ),
    );
    actions.appendChild(
      makeLinkAction(ICON_DOWNLOAD, '下载', `/api/download?path=${encodeURIComponent(item.key)}`, true),
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
  for (const item of items) frag.appendChild(makeRow(item));
  refs.list!.appendChild(frag);
}

async function load() {
  try {
    const data = await api<DriveListResponse>(`/api/list?prefix=${encodeURIComponent(prefix)}`);
    lastList = data;
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

// ---------- 客户端流式打包 ----------

/** 递归列出某个目录下的所有文件，返回 [{ key, relPath }]（relPath 相对于根目录） */
async function collectFiles(rootKey: string, onProgress?: (count: number) => void): Promise<{ key: string; relPath: string }[]> {
  const out: { key: string; relPath: string }[] = [];
  async function walk(prefix: string) {
    const data = await api<DriveListResponse>(`/api/list?prefix=${encodeURIComponent(prefix)}`);
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
  t.setDetail(`共 ${files.length} 个文件，开始打包…`);

  // 构造 client-zip 输入：异步 iterable 流式喂入。
  // 先并发启动所有 fetch（不 await），再用 for-await 边 ready 边 yield。
  // client-zip 会按 yield 顺序逐个读取 body stream，真正的流式打包。
  const inflight = files.map((f) => {
    const responsePromise = fetch(`/api/download?path=${encodeURIComponent(f.key)}`);
    return { name: `${folderName}/${f.relPath}`, responsePromise };
  });

  async function* inputStream() {
    for (const item of inflight) {
      const res = await item.responsePromise;
      if (!res.ok) throw new Error(`下载 ${item.name} 失败：HTTP ${res.status}`);
      yield { name: item.name, input: res };
    }
  }

  try {
    // 下载到 Blob（个人量级够用；超大会爆内存，但用户已选「全客户端」模式）
    const blob = await downloadZip(inputStream()).blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${folderName}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    t.done('success', `已保存为 ${folderName}.zip · ${formatSize(blob.size)} · ${files.length} 个文件`);
  } catch (err) {
    t.done('error', `打包失败：${readError(err)}`);
  }
}

// ---------- 事件绑定 ----------

function bind() {
  refs.up?.addEventListener('click', () => {
    prefix = prefix.replace(/[^/]+\/$/, '');
    load();
  });

  refs.previewClose?.addEventListener('click', () => refs.preview?.close());
  refs.previewPrev?.addEventListener('click', () => navigateGallery(-1));
  refs.previewNext?.addEventListener('click', () => navigateGallery(1));
  refs.preview?.addEventListener('click', (e) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) refs.preview.close();
  });

  // 预览内键盘：图片灯箱 ←/→ 切换，Esc 关闭（Esc 由 dialog 原生处理）
  refs.preview?.addEventListener('keydown', (e) => {
    if (!previewState?.gallery) return;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      navigateGallery(-1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      navigateGallery(1);
    }
  });
}

bind();
load();
