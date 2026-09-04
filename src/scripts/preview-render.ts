/**
 * preview-render.ts —— 预览内容渲染器（只负责把内容画进给定 body）
 *
 * 依赖的成熟组件：
 *   - Markdown → marked
 *   - 代码高亮 → highlight.js（语言注册集中在本模块）
 *   - .docx    → mammoth
 *   - 表格     → SheetJS xlsx（按需动态 import）
 */
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
import 'highlight.js/styles/atom-one-dark.css';
import type { PreviewState } from './types';
import { languageFor, extOf } from './filetype';
import { escapeHtml, parseDelimited, readError } from './utils';

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

const PLACEHOLDER = 'drive-preview__placeholder';

/** 媒体（图片/PDF/音视频）：把元素画进 body；加载失败给明确提示 */
export function renderMediaPreview(body: HTMLElement, state: PreviewState, url: string) {
  body.innerHTML = '';
  const failNote = () => {
    const ext = extOf(state.name);
    body.innerHTML = `<p class="${PLACEHOLDER}">无法加载 .${ext}（浏览器不支持解码或文件已损坏），请用右上角「下载」后在本机打开。</p>`;
  };
  if (state.kind === 'image') {
    const img = document.createElement('img');
    img.alt = state.name;
    img.src = url;
    img.addEventListener('error', failNote);
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
    audio.addEventListener('error', failNote);
    body.appendChild(audio);
    return;
  }
  if (state.kind === 'video') {
    const video = document.createElement('video');
    video.controls = true;
    video.preload = 'metadata';
    video.src = url;
    video.addEventListener('error', failNote);
    body.appendChild(video);
    return;
  }
}

/** 文本类：Markdown(marked) / 代码(highlight.js) / CSV 表格 / 纯文本 */
export async function renderTextPreview(body: HTMLElement, state: PreviewState, text: string) {
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

/** 极简 CSV/TSV 渲染（解析在 utils.parseDelimited） */
export function renderCsvTable(text: string, delimiter: string): HTMLElement {
  const rows = parseDelimited(text, delimiter);
  const wrap = document.createElement('div');
  wrap.className = 'drive-preview__csv';
  if (rows.length === 0) {
    const empty = document.createElement('p');
    empty.className = PLACEHOLDER;
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

/** .docx 用 mammoth 转 HTML 渲染（老版 .doc 直接提示下载） */
export async function renderDocxPreview(body: HTMLElement, state: PreviewState, buffer: ArrayBuffer) {
  body.innerHTML = `<p class="${PLACEHOLDER}">正在解析 Word 文档…</p>`;
  try {
    if (extOf(state.name) === 'doc') {
      body.innerHTML = `<p class="${PLACEHOLDER}">暂不支持 .doc（老二进制）格式预览，请使用下载后用 WPS / Office 打开。</p>`;
      return;
    }
    const result = await mammothConvert({ arrayBuffer: buffer });
    const wrap = document.createElement('article');
    wrap.className = 'drive-preview__markdown drive-preview__docx';
    wrap.innerHTML = result.value || `<p class="${PLACEHOLDER}">（文档为空）</p>`;
    body.replaceChildren(wrap);
    if (result.messages.length > 0) {
      console.warn('[docx] mammoth messages:', result.messages);
    }
  } catch (err) {
    body.innerHTML = `<p class="${PLACEHOLDER}">Word 文档解析失败：${escapeHtml(readError(err))}</p>`;
  }
}

/** 把 sheet 数据渲染成表格（复用 CSV 表格样式，首行当表头） */
export function buildSheetTable(rows: string[][]): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'drive-preview__csv';
  if (rows.length === 0) {
    const empty = document.createElement('p');
    empty.className = PLACEHOLDER;
    empty.textContent = '（空工作表）';
    wrap.appendChild(empty);
    return wrap;
  }
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headerTr = document.createElement('tr');
  const colCount = Math.max(...rows.map((r) => r.length));
  for (let i = 0; i < colCount; i++) {
    const th = document.createElement('th');
    th.textContent = rows[0][i] ?? '';
    headerTr.appendChild(th);
  }
  thead.appendChild(headerTr);
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

/**
 * 表格（.xlsx/.xlsm/.xls/.ods）：交给成熟库 SheetJS 解析成表格。
 * 动态 import —— 只有真正点开表格时才下载该 chunk，避免拖慢首屏。
 */
const MAX_SHEET_ROWS_PREVIEW = 300; // SheetJS 的 sheetRows：每张表只读前 N 行
const MAX_SHEET_COLS_PREVIEW = 60;
const MAX_SHEET_NAMES_PREVIEW = 5;

export async function renderSpreadsheetPreview(body: HTMLElement, buffer: ArrayBuffer) {
  body.innerHTML = `<p class="${PLACEHOLDER}">正在解析表格…</p>`;
  try {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(new Uint8Array(buffer), {
      type: 'array',
      sheetRows: MAX_SHEET_ROWS_PREVIEW,
      cellDates: false,
    });
    const names = (wb.SheetNames || []).slice(0, MAX_SHEET_NAMES_PREVIEW);
    if (names.length === 0) throw new Error('未解析到任何工作表');
    const root = document.createElement('div');
    if ((wb.SheetNames || []).length > MAX_SHEET_NAMES_PREVIEW) {
      const warn = document.createElement('p');
      warn.className = 'drive-preview__office-warn';
      warn.textContent = `⚠ 工作簿有 ${wb.SheetNames.length} 个工作表，仅显示前 ${MAX_SHEET_NAMES_PREVIEW} 个`;
      root.appendChild(warn);
    }
    for (const name of names) {
      const ws = wb.Sheets[name];
      if (!ws) continue;
      const rawRows = XLSX.utils.sheet_to_json(ws, {
        header: 1,
        defval: '',
        raw: false, // 取「格式化文本」，日期/数字已经是人类可读的样子
        blankrows: false,
      }) as unknown[][];
      let tooWide = false;
      const rows: string[][] = [];
      for (const rr of rawRows) {
        if (rr.length > MAX_SHEET_COLS_PREVIEW) tooWide = true;
        const row = rr
          .slice(0, MAX_SHEET_COLS_PREVIEW)
          .map((cell) => (cell === null || cell === undefined ? '' : String(cell)));
        while (row.length > 0 && row[row.length - 1] === '') row.pop();
        rows.push(row);
      }
      const caption = document.createElement('div');
      caption.className = 'drive-preview__sheet-caption';
      caption.textContent = `📊 ${name}`;
      root.appendChild(caption);
      if (tooWide) {
        const note = document.createElement('p');
        note.className = 'drive-preview__office-warn';
        note.textContent = `⚠ 列数较多，仅显示前 ${MAX_SHEET_COLS_PREVIEW} 列`;
        root.appendChild(note);
      }
      root.appendChild(buildSheetTable(rows));
    }
    body.replaceChildren(root);
  } catch (err) {
    body.innerHTML = `<p class="${PLACEHOLDER}">表格解析失败：${escapeHtml(readError(err))}</p>`;
  }
}
