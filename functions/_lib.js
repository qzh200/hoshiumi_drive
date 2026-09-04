// _lib.js —— 通用工具：JSON 响应、路径清洗
//
// 旧版曾带 cookie / session / master key / requireAuth；只读重构后全部移除。
// 路径清洗保留：cleanPath 用于「去掉尾斜杠」的纯 key（如 list / download / preview），
// cleanKeyPath 用于「保留尾斜杠」的目录 key（如未来可能新增的目录端点）。
export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

export function badRequest(message) {
  return json({ error: message }, 400);
}

export function cleanPath(value) {
  if (typeof value !== 'string') return null;
  const path = value.replace(/^\/+|\/+$/g, '');
  if (!path || path.includes('\\') || path.split('/').some((part) => !part || part === '.' || part === '..' || part.includes('\0'))) return null;
  return path;
}

/**
 * 保留尾部斜杠的路径清洗（用于需要区分「目录」的操作，如 MKCOL）。
 * 当前只用 cleanPath；保留以备未来若新增服务端目录相关端点时复用。
 */
export function cleanKeyPath(value) {
  if (typeof value !== 'string' || value.includes('\\') || value.includes('\0')) return null;
  const trailing = value.endsWith('/') ? '/' : '';
  const parts = value.split('/').filter((p) => p.length > 0);
  if (!parts.length || parts.some((p) => p === '.' || p === '..')) return null;
  return parts.join('/') + trailing;
}

/**
 * 从请求 URL 的 pathname 中取出某 API 前缀之后的路径段。
 *
 * 为什么不用 params（[[path]] 路由参数）：
 *   wrangler 4 的 pages dev 把未解码的原始段塞进 params（中文路径会拿到
 *   "%E4%B8%80..." 而不是 "一"），直接 join 再 encodeURIComponent 会双重编码。
 *   这里统一从 URL 自取并百分号解码一次，本地 dev 与线上 Pages 行为一致。
 *
 * @param {Request} request 当前请求
 * @param {string}  apiPrefix 形如 '/api/preview/' 的路由前缀
 * @returns {string[]|null} 解码后的路径段数组；前缀不匹配或含非法段时返回 null
 */
export function urlPathSegments(request, apiPrefix) {
  const pathname = new URL(request.url).pathname;
  if (!pathname.startsWith(apiPrefix)) return null;
  const rest = pathname.slice(apiPrefix.length).replace(/\/+$/, '');
  if (!rest) return [];
  const parts = [];
  for (const raw of rest.split('/')) {
    if (raw === '') return null;
    let seg;
    try {
      seg = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (!seg || seg.includes('\\') || seg.includes('\0') || seg === '.' || seg === '..') return null;
    parts.push(seg);
  }
  return parts;
}

/** 请求的 URL 段是否以「目录尾斜杠」结束（用于区分 list 的目录请求等） */
export function urlHasTrailingSlash(request, apiPrefix) {
  const pathname = new URL(request.url).pathname;
  return pathname.length > apiPrefix.length && pathname.endsWith('/');
}
