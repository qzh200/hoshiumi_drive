/**
 * utils.ts —— 无 DOM 依赖的纯工具函数
 */
import type { DriveItem, PreviewState } from './types';

export function escapeHtml(value: string): string {
  const el = document.createElement('span');
  el.textContent = value;
  return el.innerHTML;
}

export function readError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function formatSize(size?: number): string {
  if (!size) return '—';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatDate(input?: string): string {
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

export function fileMetaLine(item: DriveItem): string {
  if (item.folder) return '文件夹';
  const size = formatSize(item.size);
  const date = formatDate(item.uploaded);
  return date ? `${size} · ${date}` : size;
}

export function previewMetaLine(state: PreviewState): string {
  const parts: string[] = [];
  if (state.size) parts.push(formatSize(state.size));
  if (state.uploaded) parts.push(formatDate(state.uploaded));
  if (state.sourceLabel) parts.push(state.sourceLabel);
  if (state.gallery) {
    const { index, keys } = state.gallery;
    parts.push(`${index + 1} / ${keys.length}`);
  }
  return parts.join(' · ');
}

/** 极简 CSV/TSV 解析（供预览表格用）。处理带引号字段、CRLF、转义引号。 */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === delimiter) {
      row.push(field);
      field = '';
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      field = '';
      row = [];
      continue;
    }
    if (ch === '\r') {
      continue;
    }
    field += ch;
  }
  // 收尾
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 0 && !(r.length === 1 && r[0] === ''));
}
