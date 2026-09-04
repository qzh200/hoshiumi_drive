// GET /api/list/<directory path>/ - 列出某个目录的直接子项（path 在 URL 段里）
// 根目录：GET /api/list/（不带尾斜杠也按根目录处理）
import { badRequest, json, urlPathSegments } from '../../_lib.js';
import * as storage from '../../_storage.js';

export async function onRequestGet({ request, env }) {
  const segments = urlPathSegments(request, '/api/list/');
  if (segments === null) return badRequest('Invalid path');
  const prefix = segments.length ? `${segments.join('/')}/` : '';
  try {
    return json({ prefix, ...(await storage.list(env, prefix)) });
  } catch (error) {
    console.error('[list] WebDAV list failed:', error);
    return json({ error: 'Unable to read storage' }, 502);
  }
}
