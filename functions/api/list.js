// list.js —— 列目录（只读代理）
//
// 单 GET：返回 prefix 下的直接子项（folders + files），不再支持 POST/PATCH/DELETE。
// 递归列表在前端做（见 src/scripts/app.ts），后端不参与。
import { badRequest, cleanPath, json } from '../_lib.js';
import * as storage from '../_storage.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const prefix = url.searchParams.get('prefix') || '';
  if (prefix && (!cleanPath(prefix) || !prefix.endsWith('/'))) return badRequest('Invalid prefix');
  try {
    return json({ prefix, ...(await storage.list(env, prefix)) });
  } catch (error) {
    console.error('[list] WebDAV list failed:', error);
    return json({ error: 'Unable to read storage' }, 502);
  }
}
