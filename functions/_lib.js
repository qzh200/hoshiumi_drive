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
