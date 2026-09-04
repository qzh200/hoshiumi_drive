/**
 * filetype.ts —— 扩展名集合 / 文件类型判定 / 预览分类（纯逻辑，无 DOM）
 */
import type { PreviewKind } from './types';

// 浏览器可直接解码渲染的媒体格式（其余如 mkv/avi/heic 无法内联，归 BINARY 提示下载）
export const CODE_EXTS = new Set([
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx',
  'css', 'scss', 'less',
  'html', 'htm', 'xml', 'vue', 'svelte',
  'py', 'rb', 'rs', 'go', 'java', 'kt', 'swift',
  'c', 'cc', 'cpp', 'h', 'hpp', 'm', 'mm',
  'php', 'sh', 'bash', 'zsh', 'ps1', 'sql', 'lua', 'r', 'dart', 'toml', 'yaml', 'yml',
  'json', 'jsonc', 'json5',
  'properties', 'tex', 'bat', 'cmd', 'cs', 'pl', 'vbs', 'dockerfile', 'cfg',
]);
export const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'ico', 'svg']);
export const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv']);
export const AUDIO_EXTS = new Set(['mp3', 'wav', 'flac', 'ogg', 'oga', 'm4a', 'opus', 'aac']);
export const ARCHIVE_EXTS = new Set(['zip', 'jar', 'apk', 'war']);
// 已知的「不支持在线预览」的类型：给明确的下载提示，而不是乱码或走复杂解析。
// 演示（ppt/pptx/odp）、文档开放格式(odt)、数据库（db/sqlite*）、电子书（epub/mobi/azw*）等一律归此类。
export const BINARY_EXTS = new Set([
  'rar', '7z', 'zipx', 'zst', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'deb', 'dmg', 'iso', 'img',
  'exe', 'dll', 'so', 'dylib', 'bin', 'dat', 'pyc', 'pyo', 'class', 'o', 'a', 'lib', 'obj',
  'com', 'wasm', 'db', 'sqlite', 'sqlite3', 'mdb', 'accdb', 'tif', 'tiff', 'woff', 'woff2',
  'ttf', 'otf', 'eot',
  // 演示
  'ppt', 'pptx', 'odp',
  // 文字处理开放格式
  'odt',
  // 电子书
  'epub', 'mobi', 'azw', 'azw3', 'fb2', 'djvu',
  // 浏览器解不了的媒体/图片容器
  'mkv', 'avi', 'heic', 'ts', 'flv', 'wmv', 'rmvb', 'vob', '3gp', 'amr', 'mid', 'midi',
]);
export const SHEET_EXTS = new Set(['xlsx', 'xlsm', 'ods', 'xls']);
export const TEXT_EXTS = new Set(['txt', 'md', 'markdown', 'log', 'csv', 'tsv', 'ini', 'conf', 'env', 'rst', 'rtf', 'm3u8', 'example']);
export const DOCX_EXTS = new Set(['docx']);
export const DOC_EXTS = new Set(['doc']);
export const CSV_EXTS = new Set(['csv', 'tsv']);

export type SimpleFileKind = 'image' | 'video' | 'audio' | 'pdf' | 'docx' | 'doc' | 'sheet' | 'archive' | 'code' | 'text' | 'file';

/** 取小写扩展名（无点号） */
export function extOf(name: string): string {
  return (name.split('.').pop() ?? '').toLowerCase();
}

/** 行内图标/图库用的粗粒度类型 */
export function fileKind(name: string): SimpleFileKind {
  const ext = extOf(name);
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (ext === 'pdf') return 'pdf';
  if (SHEET_EXTS.has(ext)) return 'sheet';
  if (DOCX_EXTS.has(ext)) return 'docx';
  if (DOC_EXTS.has(ext)) return 'doc';
  if (ARCHIVE_EXTS.has(ext)) return 'archive';
  if (CODE_EXTS.has(ext)) return 'code';
  if (TEXT_EXTS.has(ext)) return 'text';
  return 'file';
}

/**
 * 预览类型判定。行点击时只有文件名、没有 mime，
 * 因此媒体必须同时支持「mime 识别」和「扩展名识别」。
 */
export function classifyPreview(mime: string, name: string): PreviewKind {
  const m = (mime || '').toLowerCase();
  const ext = extOf(name);
  if (m.startsWith('image/') || IMAGE_EXTS.has(ext)) return 'image';
  if (m === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (m.startsWith('audio/') || AUDIO_EXTS.has(ext)) return 'audio';
  if (m.startsWith('video/') || VIDEO_EXTS.has(ext)) return 'video';
  if (SHEET_EXTS.has(ext)) return 'sheet';
  if (DOCX_EXTS.has(ext)) return 'docx';
  if (DOC_EXTS.has(ext)) return 'docx'; // 也走 docx 分支，下面有 fallback
  if (ARCHIVE_EXTS.has(ext)) return 'archive';
  if (BINARY_EXTS.has(ext)) return 'binary'; // 已知无法内联的二进制：给下载提示而非乱码
  if (CSV_EXTS.has(ext)) return 'csv';
  if (['md', 'markdown'].includes(ext) || m === 'text/markdown' || m === 'text/x-markdown') return 'markdown';
  if (CODE_EXTS.has(ext)) return 'code';
  if (TEXT_EXTS.has(ext)) return 'text';
  if (m.startsWith('text/') || m === 'application/json' || m === 'application/xml' || m === 'application/javascript' || m === 'application/x-yaml' || m === 'application/ld+json') return 'text';
  return 'unknown';
}

/** 代码高亮语言名（与 highlight.js 注册的语言对齐） */
export function languageFor(name: string): string | null {
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

/** 按扩展名猜 mime（zip 内文件没服务端 metadata） */
export function guessMime(name: string): string {
  const ext = extOf(name);
  const map: Record<string, string> = {
    txt: 'text/plain', md: 'text/markdown', mdown: 'text/markdown', markdown: 'text/markdown',
    json: 'application/json', xml: 'application/xml', yaml: 'application/x-yaml', yml: 'application/x-yaml',
    csv: 'text/csv', tsv: 'text/tab-separated-values',
    js: 'text/javascript', mjs: 'text/javascript', cjs: 'text/javascript', jsx: 'text/javascript',
    ts: 'text/typescript', tsx: 'text/typescript',
    css: 'text/css', scss: 'text/css', less: 'text/css',
    html: 'text/html', htm: 'text/html', vue: 'text/html', svelte: 'text/html',
    svg: 'image/svg+xml',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac', m4a: 'audio/mp4',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc: 'application/msword',
    odt: 'application/vnd.oasis.opendocument.text',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
    xls: 'application/vnd.ms-excel',
    ods: 'application/vnd.oasis.opendocument.spreadsheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ppt: 'application/vnd.ms-powerpoint',
    odp: 'application/vnd.oasis.opendocument.presentation',
    zip: 'application/zip',
  };
  return map[ext] ?? 'application/octet-stream';
}
