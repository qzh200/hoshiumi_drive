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
 *     超过上限的文件禁止预览。
 *
 * 行为：
 *   - 列表：GET /api/list?prefix=...
 *   - 单文件下载：直接 <a href="/api/download?path=...">
 *   - 预览：GET /api/preview?path=...（含 Range 透传）
 *   - 文件夹打包：递归 list → 并发 fetch 每文件 → client-zip 流式打 zip → 浏览器落盘
 *   - 多选：工具栏按钮切换；进入后行首 checkbox 出现，底部操作栏可一键打包选中
 *   - 搜索：弹窗内输入；首次搜索时构建当前目录子树的索引；结果路径为可点击面包屑
 *   - 预览增强：图片灯箱、代码高亮、Markdown、Word、CSV、ZIP 内部浏览
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
import { convertToHtml as mammothConvert } from 'mammoth';
import JSZip from 'jszip';
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

interface IndexEntry {
  key: string;
  name: string;
  folder: boolean;
  parent: string;
  size?: number;
  uploaded?: string;
  /** 索引构建时所在的「根 prefix」，用于面包屑 */
  scopePrefix: string;
}

type PreviewKind = 'image' | 'pdf' | 'audio' | 'video' | 'code' | 'markdown' | 'docx' | 'csv' | 'archive' | 'text' | 'unknown';

interface PreviewState {
  key: string;
  name: string;
  kind: PreviewKind;
  mime: string;
  size?: number;
  uploaded?: string;
  gallery?: { keys: string[]; names: string[]; index: number };
}

// ---------- 预览大小限制（客户端防御） ----------

/** 通用预览上限：100MB */
const MAX_PREVIEW_BYTES = 100 * 1024 * 1024;
/** 文本/代码/Markdown 预览上限：2MB（再大就让用户下载） */
const MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024;
/** 压缩包内浏览上限：200MB（JSZip 在浏览器内解压大包很贵） */
const MAX_ARCHIVE_PREVIEW_BYTES = 200 * 1024 * 1024;

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
const ARCHIVE_EXTS = new Set(['zip', 'jar', 'apk', 'epub', 'odt', 'ods', 'odp']);
const TEXT_EXTS = new Set(['txt', 'md', 'markdown', 'log', 'csv', 'tsv', 'ini', 'conf', 'env', 'rst']);
const DOCX_EXTS = new Set(['docx']);
const DOC_EXTS = new Set(['doc']);
const CSV_EXTS = new Set(['csv', 'tsv']);

function fileIcon(name: string): string {
  const kind = fileKind(name);
  return ICON_EXT_KIND[kind] ?? ICON_FILE_DEFAULT;
}

function fileKind(name: string): 'image' | 'video' | 'audio' | 'pdf' | 'docx' | 'doc' | 'archive' | 'code' | 'text' | 'file' {
  const ext = extOf(name);
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (ext === 'pdf') return 'pdf';
  if (DOCX_EXTS.has(ext)) return 'docx';
  if (DOC_EXTS.has(ext)) return 'doc';
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
let selectionMode = false;
const selected = new Set<string>();
let searchIndex: Map<string, IndexEntry> | null = null;
let searchIndexScope = ''; // 索引对应的 prefix；切目录时清掉
let searchIndexPromise: Promise<Map<string, IndexEntry>> | null = null;
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

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
  actionbar: $('[data-actionbar]') as HTMLElement,
  actionbarCount: $('[data-actionbar-count]') as HTMLElement,
  actionbarAll: $('[data-actionbar-all]') as HTMLButtonElement,
  actionbarPack: $('[data-actionbar-pack]') as HTMLButtonElement,
  actionbarClear: $('[data-actionbar-clear]') as HTMLButtonElement,
  selectToggle: $('[data-select-toggle]') as HTMLButtonElement,
  searchBtn: $('[data-search-btn]') as HTMLButtonElement,
  searchModal: $('[data-search-modal]') as HTMLDialogElement,
  searchInput: $('[data-search-input]') as HTMLInputElement,
  searchClose: $('[data-search-close]') as HTMLButtonElement,
  searchStatus: $('[data-search-status]') as HTMLElement,
  searchResults: $('[data-search-results]') as HTMLElement,
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
  if (state.size) parts.push(formatSize(state.size));
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

// ---------- 预览 ----------

function classifyPreview(mime: string, name: string): PreviewKind {
  const m = (mime || '').toLowerCase();
  const ext = extOf(name);
  if (m.startsWith('image/')) return 'image';
  if (m === 'application/pdf') return 'pdf';
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('video/')) return 'video';
  if (DOCX_EXTS.has(ext)) return 'docx';
  if (DOC_EXTS.has(ext)) return 'docx'; // 也走 docx 分支，下面有 fallback
  if (ARCHIVE_EXTS.has(ext)) return 'archive';
  if (CSV_EXTS.has(ext)) return 'csv';
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
  if (state.kind === 'csv') {
    body.appendChild(renderCsvTable(text, extOf(state.name) === 'tsv' ? '\t' : ','));
    return;
  }
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  code.textContent = text;
  pre.appendChild(code);
  body.appendChild(pre);
}

/** 极简 CSV/TSV 解析 + 渲染。处理带引号字段、CRLF、转义引号。 */
function renderCsvTable(text: string, delimiter: string): HTMLElement {
  const rows = parseDelimited(text, delimiter);
  const wrap = document.createElement('div');
  wrap.className = 'drive-preview__csv';
  if (rows.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'drive-preview__placeholder';
    empty.textContent = '（空文件）';
    wrap.appendChild(empty);
    return wrap;
  }
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  const colCount = rows[0].length;
  for (let i = 0; i < colCount; i++) {
    const th = document.createElement('th');
    th.textContent = rows[0][i] ?? `列 ${i + 1}`;
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  for (let r = 1; r < rows.length; r++) {
    const tr = document.createElement('tr');
    for (let c = 0; c < colCount; c++) {
      const td = document.createElement('td');
      td.textContent = rows[r][c] ?? '';
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === delimiter) { row.push(field); field = ''; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); field = ''; row = []; continue; }
    if (ch === '\r') { continue; }
    field += ch;
  }
  // 收尾
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 0 && !(r.length === 1 && r[0] === ''));
}

async function renderDocxPreview(state: PreviewState, buffer: ArrayBuffer) {
  const body = refs.previewBody;
  body.innerHTML = '<p class="drive-preview__placeholder">正在解析 Word 文档…</p>';
  try {
    // .doc（老二进制格式）mammoth 不支持，提前识别一下
    if (extOf(state.name) === 'doc') {
      body.innerHTML = `<p class="drive-preview__placeholder">暂不支持 .doc（二进制）格式预览，请使用下载。</p>`;
      return;
    }
    const result = await mammothConvert({ arrayBuffer: buffer });
    const wrap = document.createElement('article');
    wrap.className = 'drive-preview__markdown drive-preview__docx';
    wrap.innerHTML = result.value || '<p class="drive-preview__placeholder">（文档为空）</p>';
    body.replaceChildren(wrap);
    if (result.messages.length > 0) {
      console.warn('[docx] mammoth messages:', result.messages);
    }
  } catch (err) {
    body.innerHTML = `<p class="drive-preview__placeholder">Word 文档解析失败：${escapeHtml(readError(err))}</p>`;
  }
}

async function renderArchivePreview(state: PreviewState, buffer: ArrayBuffer) {
  const body = refs.previewBody;
  body.innerHTML = '<p class="drive-preview__placeholder">正在解压压缩包…</p>';
  try {
    const zip = await JSZip.loadAsync(buffer);
    const entries: { name: string; size: number; date: Date; dir: boolean }[] = [];
    zip.forEach((relPath, file) => {
      // uncompressedSize 在公开类型上未暴露，只能走 _data 内部字段
      const internal = (file as unknown as { _data?: { uncompressedSize?: number } })._data;
      const size = internal?.uncompressedSize ?? 0;
      entries.push({
        name: relPath,
        size,
        date: file.date || new Date(0),
        dir: file.dir,
      });
    });
    // 文件夹优先，同组内按名字排
    entries.sort((a, b) => {
      if (a.dir !== b.dir) return a.dir ? -1 : 1;
      return a.name.localeCompare(b.name, 'zh-Hans-CN');
    });
    const totalUncompressed = entries.reduce((s, e) => s + e.size, 0);
    const totalEntries = entries.length;

    const wrap = document.createElement('div');
    wrap.className = 'drive-preview__archive';

    const summary = document.createElement('div');
    summary.className = 'drive-preview__archive-summary';
    summary.innerHTML = `
      <div><strong>${totalEntries}</strong> 个条目</div>
      <div>解压后大小：<strong>${formatSize(totalUncompressed)}</strong></div>
    `;
    wrap.appendChild(summary);

    const list = document.createElement('ul');
    list.className = 'drive-preview__archive-list';
    for (const e of entries.slice(0, 500)) {
      const li = document.createElement('li');
      li.className = 'drive-preview__archive-item';
      const icon = document.createElement('span');
      icon.className = 'drive-preview__archive-item-icon';
      icon.innerHTML = e.dir ? ICON_FOLDER : fileIcon(e.name);
      const name = document.createElement('span');
      name.className = 'drive-preview__archive-item-name';
      name.textContent = e.name;
      const size = document.createElement('span');
      size.className = 'drive-preview__archive-item-size';
      size.textContent = e.dir ? '—' : formatSize(e.size);
      li.append(icon, name, size);
      list.appendChild(li);
    }
    if (entries.length > 500) {
      const more = document.createElement('li');
      more.className = 'drive-preview__archive-more';
      more.textContent = `（还有 ${entries.length - 500} 项未显示，请下载后用本地工具浏览）`;
      list.appendChild(more);
    }
    wrap.appendChild(list);
    body.replaceChildren(wrap);
  } catch (err) {
    body.innerHTML = `<p class="drive-preview__placeholder">压缩包解析失败：${escapeHtml(readError(err))}<br><br>文件可能不是有效的 ZIP，或已损坏。</p>`;
  }
}

function showPreviewError(message: string, noteTone: 'info' | 'warn' = 'warn') {
  refs.previewBody.innerHTML = `<p class="drive-preview__placeholder">${escapeHtml(message)}</p>`;
  setPreviewNote('请改用下载', noteTone);
}

function checkSizeLimit(state: PreviewState): string | null {
  const size = state.size ?? 0;
  if (!size) return null;
  if (state.kind === 'archive' && size > MAX_ARCHIVE_PREVIEW_BYTES) {
    return `压缩包 ${formatSize(size)} 超过预览上限 ${formatSize(MAX_ARCHIVE_PREVIEW_BYTES)}，请下载后用本地工具浏览。`;
  }
  if ((state.kind === 'text' || state.kind === 'code' || state.kind === 'markdown' || state.kind === 'csv' || state.kind === 'docx') && size > MAX_TEXT_PREVIEW_BYTES) {
    return `文档 ${formatSize(size)} 超过文本预览上限 ${formatSize(MAX_TEXT_PREVIEW_BYTES)}，请下载查看完整内容。`;
  }
  if (size > MAX_PREVIEW_BYTES) {
    return `文件 ${formatSize(size)} 超过预览上限 ${formatSize(MAX_PREVIEW_BYTES)}，请下载后用本地工具打开。`;
  }
  return null;
}

async function openPreview(state: PreviewState) {
  previewState = state;
  refs.previewName.textContent = state.name;
  setPreviewNote(previewMetaLine(state));
  refs.previewDownload.href = `/api/download?path=${encodeURIComponent(state.key)}`;
  setGalleryNav(Boolean(state.gallery));
  refs.previewBody.innerHTML = '<p class="drive-preview__placeholder">载入中…</p>';
  if (!refs.preview.open) refs.preview.showModal();

  // 客户端大小限制（提前拦，省一次下载）
  const sizeError = checkSizeLimit(state);
  if (sizeError) {
    showPreviewError(sizeError);
    return;
  }

  const url = `/api/preview?path=${encodeURIComponent(state.key)}`;

  // 媒体类：直接走 URL，浏览器自己处理 Range
  if (state.kind === 'image' || state.kind === 'pdf' || state.kind === 'audio' || state.kind === 'video') {
    try {
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

  // 二进制类：拿 ArrayBuffer 本地解析。
  // 这里走 /api/download 而不是 /api/preview——后者会按 mime 拒绝非内联类型（zip/docx 都是 415）。
  // /api/download 是无脑 bytes 透传，对 fetch() 来说 Content-Disposition: attachment 不会触发下载弹窗。
  if (state.kind === 'docx' || state.kind === 'archive') {
    const downloadUrl = `/api/download?path=${encodeURIComponent(state.key)}`;
    try {
      const res = await fetch(downloadUrl);
      if (!res.ok) {
        showPreviewError(`预览失败：HTTP ${res.status}`);
        return;
      }
      const buffer = await res.arrayBuffer();
      if (state.kind === 'docx') {
        await renderDocxPreview(state, buffer);
      } else {
        await renderArchivePreview(state, buffer);
      }
    } catch (err) {
      showPreviewError(`请求失败：${escapeHtml(readError(err))}`);
    }
    return;
  }

  // 文本类：拿 text，本地渲染
  try {
    const res = await fetch(url);
    if (!res.ok) {
      showPreviewError(`预览失败：HTTP ${res.status}`);
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
      setPreviewNote(previewMetaLine(state) + ' · 文本预览（最多 2 MB）');
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
    const kind = fileKind(name);
    iconWrap.dataset.kind = kind === 'docx' || kind === 'doc' ? 'code' : kind;
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
      makeButtonAction(ICON_EYE, '预览', () =>
        openPreview({
          key: item.key,
          name,
          kind: classifyPreview('', name),
          mime: '',
          size: item.size,
          uploaded: item.uploaded,
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
  clearSelection();
  // 切目录时清掉搜索索引（搜索范围是当前 prefix，切了就要重算）
  searchIndex = null;
  searchIndexScope = '';
  searchIndexPromise = null;
  try {
    const data = await api<DriveListResponse>(`/api/list?prefix=${encodeURIComponent(prefix)}`);
    lastList = data;
    render(data);
  } catch (error) {
    refs.list!.innerHTML = `<p class="drive-loading">载入失败：${escapeHtml(readError(error))}</p>`;
  }
  renderCrumb();
  refs.up!.disabled = !prefix;
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
  prefix = key;
  load();
}

// ---------- 客户端流式打包 ----------

async function collectFiles(rootKey: string, onProgress?: (count: number) => void): Promise<{ key: string; relPath: string }[]> {
  const out: { key: string; relPath: string }[] = [];
  async function walk(p: string) {
    const data = await api<DriveListResponse>(`/api/list?prefix=${encodeURIComponent(p)}`);
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

  const inflight = files.map((f) => ({
    name: `${folderName}/${f.relPath}`,
    responsePromise: fetch(`/api/download?path=${encodeURIComponent(f.key)}`),
  }));

  async function* inputStream() {
    for (const item of inflight) {
      const res = await item.responsePromise;
      if (!res.ok) throw new Error(`下载 ${item.name} 失败：HTTP ${res.status}`);
      yield { name: item.name, input: res };
    }
  }

  try {
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

async function packSelected() {
  const keys = Array.from(selected);
  if (keys.length === 0) return;

  const folders = keys.filter((k) => k.endsWith('/'));
  const files = keys.filter((k) => !k.endsWith('/'));

  const t = toast(`正在打包 ${keys.length} 个选中项…`, '正在收集文件…');
  t.setProgress(null);

  type Item = { name: string; key: string };
  const items: Item[] = [];
  for (const k of files) {
    const rel = k.slice(prefix.length);
    if (!rel) continue;
    items.push({ name: rel, key: k });
  }
  for (const folderKey of folders) {
    const folderName = folderKey.replace(/\/$/, '').split('/').pop()!;
    const sub = await collectFiles(folderKey);
    for (const f of sub) {
      items.push({ name: `${folderName}/${f.relPath}`, key: f.key });
    }
  }

  if (items.length === 0) {
    t.done('error', '没有可打包的文件');
    return;
  }
  t.setDetail(`共 ${items.length} 个文件，开始打包…`);

  const inflight = items.map((it) => ({
    name: it.name,
    responsePromise: fetch(`/api/download?path=${encodeURIComponent(it.key)}`),
  }));

  async function* inputStream() {
    for (const item of inflight) {
      const res = await item.responsePromise;
      if (!res.ok) throw new Error(`下载 ${item.name} 失败：HTTP ${res.status}`);
      yield { name: item.name, input: res };
    }
  }

  try {
    const blob = await downloadZip(inputStream()).blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `selection-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    t.done('success', `已保存为 selection-*.zip · ${formatSize(blob.size)} · ${items.length} 个文件`);
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
      const data = await api<DriveListResponse>(`/api/list?prefix=${encodeURIComponent(p)}`);
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
      iconWrap.dataset.kind = kind === 'docx' || kind === 'doc' ? 'code' : kind;
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
  refs.preview?.addEventListener('keydown', (e) => {
    if (!previewState?.gallery) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); navigateGallery(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); navigateGallery(1); }
  });

  refs.selectToggle?.addEventListener('click', () => setSelectionMode(!selectionMode));
  refs.actionbarAll?.addEventListener('click', () => selectAllInCurrent());
  refs.actionbarPack?.addEventListener('click', () => void packSelected());
  refs.actionbarClear?.addEventListener('click', () => clearSelection());

  refs.searchBtn?.addEventListener('click', () => openSearch());
  refs.searchClose?.addEventListener('click', () => closeSearch());
  refs.searchInput?.addEventListener('input', () => void runSearch(refs.searchInput.value));
  refs.searchModal?.addEventListener('click', (e) => {
    if (e.target === refs.searchModal) closeSearch();
  });
  refs.searchModal?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
  });
}

// 初始 selection mode 状态
setSelectionMode(false);

bind();
load();
