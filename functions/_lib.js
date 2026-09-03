// _lib.js —— 通用工具：JSON 响应、路径清洗、cookie、会话表
//
// 会话 TTL 由 _config.js 根据 env + YAML 计算并传入；本文件不再硬编码。
import { getAuthConfig } from './_config.js';
const encoder = new TextEncoder();

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

export function badRequest(message) {
  return json({ error: message }, 400);
}

export function forbidden() {
  return json({ error: 'Authentication required' }, 401);
}

export function cleanPath(value) {
  if (typeof value !== 'string') return null;
  const path = value.replace(/^\/+|\/+$/g, '');
  if (!path || path.includes('\\') || path.split('/').some((part) => !part || part === '.' || part === '..' || part.includes('\0'))) return null;
  return path;
}

/**
 * 保留尾部斜杠的路径清洗（用于 MOVE / DELETE / MKCOL 等需要区分「目录」的操作）。
 * WebDAV 对 collection 的 Destination / 请求 URI 要求以 / 结尾，去掉尾斜杠会
 * 被部分服务器（如 ownCloud 系）拒绝。这里只校验非法片段，保留单个尾斜杠。
 */
export function cleanKeyPath(value) {
  if (typeof value !== 'string' || value.includes('\\') || value.includes('\0')) return null;
  const trailing = value.endsWith('/') ? '/' : '';
  const parts = value.split('/').filter((p) => p.length > 0);
  if (!parts.length || parts.some((p) => p === '.' || p === '..')) return null;
  return parts.join('/') + trailing;
}

function cookie(request, name) {
  return request.headers.get('Cookie')?.split(';').map((v) => v.trim()).find((v) => v.startsWith(`${name}=`))?.slice(name.length + 1);
}

export async function isAuthenticated(request, env) {
  const id = cookie(request, 'drive_session');
  if (!id || !/^[a-f0-9-]{36}$/.test(id)) return false;
  const ttl = getAuthConfig(env).sessionTtlMs;
  const session = await env.DB.prepare('SELECT id FROM sessions WHERE id = ? AND expires_at > ?').bind(id, Date.now()).first();
  if (!session) return false;
  return true;
}

export async function requireAuth(context) {
  return (await isAuthenticated(context.request, context.env)) ? null : forbidden();
}

export async function matchesMasterKey(value, expected) {
  if (typeof value !== 'string' || !expected) return false;
  const a = encoder.encode(value);
  const b = encoder.encode(expected);
  if (a.length !== b.length) return false;
  return crypto.subtle.timingSafeEqual(a, b);
}

export function sessionCookie(id, request, ttlMs) {
  const secure = new URL(request.url).protocol === 'https:' ? ' Secure;' : '';
  const maxAge = Math.max(1, Math.floor(ttlMs / 1000));
  return `drive_session=${id}; Path=/; HttpOnly;${secure} SameSite=Strict; Max-Age=${maxAge}`;
}

export { getAuthConfig };
