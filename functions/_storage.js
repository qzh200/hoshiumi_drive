// _storage.js —— 存储驱动（WebDAV）
//
// 配置来自 _config.js：每次调用 list/get/put/... 时从 env 拿最新 endpoint / 凭据。
// 之所以「每次」都重新拿而不是缓存，是因为 Pages Functions 可能在不同 isolate
// 上执行，跨请求的全局变量也不可靠。
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

function withTimeout(init, timeoutMs) {
  if (!timeoutMs) return init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { init: { ...init, signal: controller.signal }, cancel: () => clearTimeout(timer) };
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
    const folder = /<[^>]*collection\s*\/?\s*>/i.test(item);
    const size = Number(xmlValue(item, 'getcontentlength') || 0);
    const uploaded = xmlValue(item, 'getlastmodified');
    (folder ? folders : files).push({ key: folder ? `${key}/` : key, name, folder, size, uploaded });
  }
  return { folders, files };
}

export async function get(env, path) {
  const cfg = getStorageConfig(env);
  if (cfg.driver !== 'webdav') throw new Error(`Unsupported storage driver: ${cfg.driver}`);
  const { init, cancel } = withTimeout({ method: 'GET', headers: { Authorization: authFor(cfg.webdav) } }, cfg.requestTimeoutMs);
  const response = await fetch(urlFor(cfg.webdav, path), init);
  cancel();
  return response;
}

export async function put(env, path, body, contentType) {
  const cfg = getStorageConfig(env);
  if (cfg.driver !== 'webdav') throw new Error(`Unsupported storage driver: ${cfg.driver}`);
  const { init, cancel } = withTimeout(
    { method: 'PUT', body, headers: { 'Content-Type': contentType, Authorization: authFor(cfg.webdav) } },
    cfg.requestTimeoutMs,
  );
  const response = await fetch(urlFor(cfg.webdav, path), init);
  cancel();
  return response;
}

export async function remove(env, path) {
  const cfg = getStorageConfig(env);
  if (cfg.driver !== 'webdav') throw new Error(`Unsupported storage driver: ${cfg.driver}`);
  const { init, cancel } = withTimeout({ method: 'DELETE', headers: { Authorization: authFor(cfg.webdav) } }, cfg.requestTimeoutMs);
  const response = await fetch(urlFor(cfg.webdav, path), init);
  cancel();
  return response;
}

export async function move(env, from, to) {
  const cfg = getStorageConfig(env);
  if (cfg.driver !== 'webdav') throw new Error(`Unsupported storage driver: ${cfg.driver}`);
  const { init, cancel } = withTimeout(
    {
      method: 'MOVE',
      headers: { Destination: urlFor(cfg.webdav, to), Overwrite: 'F', Authorization: authFor(cfg.webdav) },
    },
    cfg.requestTimeoutMs,
  );
  const response = await fetch(urlFor(cfg.webdav, from), init);
  cancel();
  return response;
}

export async function mkdir(env, path) {
  const cfg = getStorageConfig(env);
  if (cfg.driver !== 'webdav') throw new Error(`Unsupported storage driver: ${cfg.driver}`);
  const { init, cancel } = withTimeout({ method: 'MKCOL', headers: { Authorization: authFor(cfg.webdav) } }, cfg.requestTimeoutMs);
  const response = await fetch(urlFor(cfg.webdav, path), init);
  cancel();
  return response;
}
