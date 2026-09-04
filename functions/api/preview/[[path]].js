// preview/[[path]].js —— 文件预览（统一端点）
//
// URL 形态：GET /api/preview/<path-to-file>（path 在 URL 段里，可直接分享/收藏）
//
// 设计原则（与旧版的关键区别）：
//   - **不看后缀、不看 mime，一律回 raw bytes**（Content-Type 尽量给对）。
//     因此压缩包 / office / 任意二进制都不会再有 415「未知文件后缀不可预览」——
//     由客户端按扩展名决定渲染方式（媒体→标签；文本→高亮/Markdown/CSV；
//     docx/xlsx/pptx/zip→拉 ArrayBuffer 本地解析）。
//   - 与 /api/download 的区别：**不设 Content-Disposition: attachment**，
//     浏览器对已知类型（图片/PDF/音视频/文本）会内联渲染；下载走 download 端点。
//   - Content-Type：优先按「扩展名映射」给出（许多 WebDAV 服务把所有文件都标成
//     application/octet-stream，不按名兜底的话 <img>/<video> 在 nosniff 下不渲染）；
//     扩展名不认识时透传上游，再兜底 octet-stream。
//   - Range 透传：视频/音频拖进度条、<video> 定位都能用。
//   - 边缘缓存：5 分钟（仅无 Range 请求；带 Range 的不缓存）。
//   - 大小防御：按「是否会整段进内存」分档（视频/音频流式不设上限；图片/PDF 放宽；
//     压缩包/office/文本贴近实际上限），避免直接开分享链接时灌爆浏览器。
import { badRequest, json, urlHasTrailingSlash, urlPathSegments } from '../../_lib.js';
import { get } from '../../_storage.js';

// —— 预览大小上限（按类型区分是否会「整段进内存」，与客户端 app.ts 保持一致）——
const MAX_TEXT_PREVIEW_BYTES = 4 * 1024 * 1024; // 纯文本直接打开的上限（客户端还有更小的一层）
const MAX_ARCHIVE_BYTES = 200 * 1024 * 1024;   // 压缩包（JSZip 在浏览器内解压大包很贵）
const MAX_OFFICE_BYTES = 30 * 1024 * 1024;     // office（docx/xlsx/pptx/odf）
const MAX_IMAGE_BYTES = 100 * 1024 * 1024;     // 图片（<img> 整张解码）
const MAX_PDF_BYTES = 1024 * 1024 * 1024;      // PDF（pdfium Range 分块加载，放宽很多）
const MAX_DEFAULT_BYTES = 200 * 1024 * 1024;   // 未知/二进制兜底（前端不会真拉来渲染）

// 扩展名 → Content-Type。媒体/文本/office/压缩包都覆盖：
// 不认识的后缀才交给上游 content-type（或 octet-stream）。
const MIME_BY_EXT = {
  // 图片
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif', ico: 'image/x-icon',
  svg: 'image/svg+xml', heic: 'image/heic',
  // 音频
  mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg',
  oga: 'audio/ogg', m4a: 'audio/mp4', opus: 'audio/ogg', aac: 'audio/aac',
  // 视频
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/mp4',
  mkv: 'video/x-matroska', avi: 'video/x-msvideo', ogv: 'video/ogg',
  // 文本 / 代码 / 数据
  txt: 'text/plain', text: 'text/plain', log: 'text/plain', md: 'text/markdown',
  markdown: 'text/markdown', rst: 'text/plain', ini: 'text/plain', conf: 'text/plain',
  env: 'text/plain', csv: 'text/csv', tsv: 'text/tab-separated-values',
  json: 'application/json', jsonc: 'application/json', json5: 'application/json',
  js: 'text/javascript', mjs: 'text/javascript', cjs: 'text/javascript',
  ts: 'text/typescript', tsx: 'text/typescript', jsx: 'text/javascript',
  css: 'text/css', scss: 'text/css', less: 'text/css',
  html: 'text/html', htm: 'text/html', xml: 'application/xml', vue: 'text/html',
  svelte: 'text/html', yaml: 'application/x-yaml', yml: 'application/x-yaml',
  py: 'text/x-python', rb: 'text/x-ruby', rs: 'text/x-rust', go: 'text/x-go',
  java: 'text/x-java-source', kt: 'text/x-kotlin', swift: 'text/x-swift',
  c: 'text/x-c', h: 'text/x-c', cc: 'text/x-c', cpp: 'text/x-c', hpp: 'text/x-c',
  php: 'text/x-php', sh: 'text/x-sh', bash: 'text/x-sh', zsh: 'text/x-sh',
  ps1: 'text/x-powershell', sql: 'text/x-sql', lua: 'text/x-lua', r: 'text/x-r',
  dart: 'text/x-dart', toml: 'application/toml',
  // PDF / 字体 / office
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
  // 压缩包 / 容器
  zip: 'application/zip', jar: 'application/java-archive', apk: 'application/vnd.android.package-archive',
  epub: 'application/epub+zip', rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed',
  gz: 'application/gzip', tgz: 'application/gzip', tar: 'application/x-tar', bz2: 'application/x-bzip2',
  // 其他常见
  wasm: 'application/wasm', torrent: 'application/x-bittorrent', iso: 'application/x-iso9660-image',
};

// 文本类扩展（服务端只对「直接打开分享链接」的文本做大小上限；正常前端有自己的 2MB 上限）
const TEXT_EXTS = new Set([
  'txt', 'text', 'log', 'md', 'markdown', 'rst', 'ini', 'conf', 'env', 'csv', 'tsv',
  'json', 'jsonc', 'json5', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'css', 'scss', 'less',
  'html', 'htm', 'xml', 'vue', 'svelte', 'yaml', 'yml', 'py', 'rb', 'rs', 'go', 'java',
  'kt', 'swift', 'c', 'h', 'cc', 'cpp', 'hpp', 'php', 'sh', 'bash', 'zsh', 'ps1', 'sql',
  'lua', 'r', 'dart', 'toml',
]);
// 流式媒体（浏览器用 Range，只占当前 chunk，不设总大小上限）
const STREAMING_EXTS = new Set([
  'mp4', 'webm', 'mov', 'm4v', 'ogv', 'mkv', 'avi', // 视频
  'mp3', 'wav', 'flac', 'ogg', 'oga', 'm4a', 'opus', 'aac', // 音频
]);
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'ico', 'svg']);
const ARCHIVE_EXTS = new Set(['zip', 'jar', 'apk', 'war']);
const OFFICE_EXTS = new Set([
  'docx', 'doc', 'odt', 'xlsx', 'xlsm', 'xls', 'ods', 'pptx', 'ppt', 'odp',
]);

/** 按扩展名决定「预览允许的最大文件大小」；null 表示不设上限（流式媒体）。 */
function previewSizeLimit(ext) {
  if (STREAMING_EXTS.has(ext)) return null; // 视频/音频：Range 流式，不设总大小上限
  if (IMAGE_EXTS.has(ext)) return MAX_IMAGE_BYTES;
  if (ext === 'pdf') return MAX_PDF_BYTES;
  if (ARCHIVE_EXTS.has(ext)) return MAX_ARCHIVE_BYTES;
  if (OFFICE_EXTS.has(ext)) return MAX_OFFICE_BYTES;
  if (TEXT_EXTS.has(ext)) return MAX_TEXT_PREVIEW_BYTES;
  return MAX_DEFAULT_BYTES;
}

function extOf(path) {
  const name = path.split('/').pop() || '';
  const idx = name.lastIndexOf('.');
  return idx > 0 ? name.slice(idx + 1).toLowerCase() : '';
}

export async function onRequestGet({ request, env }) {
  const segments = urlPathSegments(request, '/api/preview/');
  if (segments === null) return badRequest('Invalid path');
  if (urlHasTrailingSlash(request, '/api/preview/')) {
    return badRequest('Preview requires a file path (not a directory)');
  }
  if (segments.length === 0) return badRequest('Path required');
  const raw = segments.join('/');

  const rangeHeader = request.headers.get('Range');
  let object;
  try {
    object = await get(env, raw, { rangeHeader });
  } catch (error) {
    console.error('[preview] WebDAV get failed:', error);
    return new Response('Storage error', { status: 502 });
  }
  if (!object.ok) {
    return new Response(object.status === 404 ? 'Not found' : 'Upstream error', {
      status: object.status === 404 ? 404 : 502,
    });
  }

  const headers = new Headers(object.headers);
  const upstreamType = headers.get('content-type') || '';
  const extMime = MIME_BY_EXT[extOf(raw)];
  const type =
    extMime ||
    (upstreamType && upstreamType !== 'application/octet-stream' ? upstreamType : 'application/octet-stream');
  headers.set('content-type', type);

  if (!headers.get('accept-ranges')) headers.set('accept-ranges', 'bytes');
  if (!rangeHeader) headers.set('cache-control', 'public, max-age=300');
  headers.set('x-content-type-options', 'nosniff');

  // 大文件防御（流式透传，本身不占内存；只是按「是否会整段进内存」拒绝明显过大的预览）。
  // 视频/音频不做总大小上限（浏览器 Range 流式）；图片/PDF 放宽；压缩包/office/文本保持贴近实际的上限。
  const size = Number(headers.get('content-length') || 0);
  const limit = previewSizeLimit(extOf(raw));
  if (limit !== null && size > limit) {
    return json({ error: 'File too large to preview', limit }, 413);
  }

  return new Response(object.body, { status: object.status, headers });
}
