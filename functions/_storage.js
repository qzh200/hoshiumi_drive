// _storage.js —— 存储驱动（WebDAV，只读）
//
// 只保留 list / get 两个动作；put / remove / move / mkdir 已随写操作一起删除。
// get() 支持 Range 透传：调用方传入原始请求的 Range 头，我们转发到 WebDAV，
// 再把状态码（200 / 206）、Accept-Ranges、Content-Range 等关键头原样回给浏览器。
// 这样视频/音频预览能 seek、超大文件能断点续传。
import { getStorageConfig } from './_config.js';

function urlFor(webdav, path = '') {
  return new URL(path.split('/').map(encodeURIComponent).join('/'), `${webdav.endpoint}/`).toString();
}

function authFor(webdav) {
  return `Basic ${btoa(`${webdav.username}:${webdav.password}`)}`;
}

function decodeHref(webdav, href) {
  try {
    const pathname = decodeURIComponent(new URL(href, 'https://drive.invalid').pathname);
    const basePath = new URL(`${webdav.endpoint}/`).pathname.replace(/\/$/, '');
    return pathname.slice(pathname.startsWith(basePath) ? basePath.length : 0).replace(/^\/+|\/+$/g, '');
  } catch {
    return '';
  }
}

function xmlValue(xml, tag) {
  return xml.match(new RegExp(`<[^>]*${tag}[^>]*>([\\s\\S]*?)<\\/[^>]*${tag}>`, 'i'))?.[1]?.trim();
}

/**
 * 提取 <resourcetype>...</resourcetype> 块的内容，进一步判断里面是否含 <...collection/>。
 * 不能用 `/<[^>]*collection\s*\/?\s*>/i` 这种形式直接扫整个 response 块：WebDAV 的真实
 * XML 是 `<D:collection xmlns:D="DAV:"/>`，里面的属性让 `>` 之前的内容把 collection
 * 跟下一个 `>` 隔开，简单的 `<...collection...>` 匹配不上。
 */
function isCollection(item) {
  const m = item.match(/<[^>]*resourcetype[^>]*>([\s\S]*?)<\s*\/\s*[^>]*resourcetype\s*>/i);
  if (!m) return false;
  return /<\s*[^>]*collection/i.test(m[1]);
}

function withTimeout(init, timeoutMs) {
  if (!timeoutMs) return init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { init: { ...init, signal: controller.signal }, cancel: () => clearTimeout(timer) };
}

/**
 * 透传到上游的关键响应头（其余由调用方按需覆盖）。
 * 不透传的有：set-cookie、transfer-encoding、connection 等连接性头。
 */
const PASSTHROUGH_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'last-modified',
  'etag',
  'cache-control',
];

function buildPassthroughHeaders(upstream) {
  const out = new Headers();
  for (const name of PASSTHROUGH_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }
  return out;
}

export async function list(env, prefix = '') {
  const cfg = getStorageConfig(env);
  if (cfg.driver !== 'webdav') throw new Error(`Unsupported storage driver: ${cfg.driver}`);
  const { init, cancel } = withTimeout(
    { method: 'PROPFIND', headers: { Depth: '1', 'Content-Type': 'application/xml', Authorization: authFor(cfg.webdav) } },
    cfg.requestTimeoutMs,
  );
  const response = await fetch(urlFor(cfg.webdav, prefix), init);
  cancel();
  if (!response.ok && response.status !== 207) throw new Error(`WebDAV list failed (${response.status})`);
  const document = await response.text();
  const responses = document.match(/<[^>]*response[ >][\s\S]*?<\/[^>]*response>/gi) || [];
  const folders = [];
  const files = [];
  for (const item of responses) {
    const key = decodeHref(cfg.webdav, xmlValue(item, 'href') || '');
    if (!key || key === prefix.replace(/\/$/, '')) continue;
    const name = key.split('/').pop();
    const folder = isCollection(item);
    const size = Number(xmlValue(item, 'getcontentlength') || 0);
    const uploaded = xmlValue(item, 'getlastmodified');
    (folder ? folders : files).push({ key: folder ? `${key}/` : key, name, folder, size, uploaded });
  }
  return { folders, files };
}

/**
 * GET 单文件。支持 Range 透传：传入原始请求的 Range 头（bytes=...）即可。
 * 返回值是个 { ok, status, headers, body } 包装，调用方按需构造 Response。
 */
export async function get(env, path, { rangeHeader } = {}) {
  const cfg = getStorageConfig(env);
  if (cfg.driver !== 'webdav') throw new Error(`Unsupported storage driver: ${cfg.driver}`);
  const headers = { Authorization: authFor(cfg.webdav) };
  if (rangeHeader) headers.Range = rangeHeader;
  const { init, cancel } = withTimeout({ method: 'GET', headers }, cfg.requestTimeoutMs);
  const response = await fetch(urlFor(cfg.webdav, path), init);
  cancel();
  return {
    ok: response.ok || response.status === 206,
    status: response.status,
    headers: buildPassthroughHeaders(response),
    body: response.body,
  };
}
