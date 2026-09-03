// folder.js —— 新建文件夹
import { badRequest, cleanPath, json, requireAuth } from '../_lib.js';
import { mkdir } from '../_storage.js';

export async function onRequestPost(context) {
  const denied = await requireAuth(context);
  if (denied) return denied;
  let body;
  try {
    body = await context.request.json();
  } catch {
    return badRequest('Invalid request');
  }
  const path = cleanPath(body.path);
  if (!path) return badRequest('Invalid folder name');
  try {
    const response = await mkdir(context.env, path);
    // 405 通常表示父目录里已存在同名目录；这里仍视为幂等成功
    if (!response.ok && response.status !== 405) return json({ error: 'Unable to create folder' }, 502);
    return json({ ok: true }, 201);
  } catch {
    return json({ error: 'Unable to create folder' }, 502);
  }
}
