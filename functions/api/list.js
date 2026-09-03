// files.js —— 列表 / 上传 / 重命名 / 删除
import { badRequest, cleanKeyPath, cleanPath, json, requireAuth } from '../_lib.js';
import { getStorageConfig } from '../_config.js';
import * as storage from '../_storage.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const prefix = url.searchParams.get('prefix') || '';
  if (prefix && (!cleanPath(prefix) || !prefix.endsWith('/'))) return badRequest('Invalid prefix');
  try {
    return json({ prefix, ...(await storage.list(env, prefix)) });
  } catch {
    return json({ error: 'Unable to read storage' }, 502);
  }
}

export async function onRequestPost(context) {
  const denied = await requireAuth(context);
  if (denied) return denied;
  let form;
  try {
    form = await context.request.formData();
  } catch {
    return badRequest('Invalid upload');
  }
  const key = cleanPath(form.get('path'));
  const file = form.get('file');
  if (!key || !(file instanceof File)) return badRequest('A path and file are required');

  // 大小限制（早期失败，省一次上传流量）
  const cfg = getStorageConfig(context.env);
  if (cfg.maxFileSize > 0 && file.size > cfg.maxFileSize) {
    return json({ error: `File exceeds max size (${cfg.maxFileSize} bytes)` }, 413);
  }

  try {
    const stored = await storage.put(context.env, key, file.stream(), file.type || 'application/octet-stream');
    if (!stored.ok) return json({ error: 'Upload failed' }, 502);
    return json({ ok: true }, 201);
  } catch {
    return json({ error: 'Upload failed' }, 502);
  }
}

export async function onRequestPatch(context) {
  const denied = await requireAuth(context);
  if (denied) return denied;
  let body;
  try {
    body = await context.request.json();
  } catch {
    return badRequest('Invalid request');
  }
  const from = cleanKeyPath(body.from);
  const to = cleanKeyPath(body.to);
  if (!from || !to) return badRequest('Invalid path');
  try {
    const moved = await storage.move(context.env, from, to);
    if (!moved.ok) return json({ error: 'Rename failed' }, 502);
    return json({ ok: true });
  } catch {
    return json({ error: 'Rename failed' }, 502);
  }
}

export async function onRequestDelete(context) {
  const denied = await requireAuth(context);
  if (denied) return denied;
  const key = cleanKeyPath(new URL(context.request.url).searchParams.get('path'));
  if (!key) return badRequest('Invalid path');
  try {
    const removed = await storage.remove(context.env, key);
    if (!removed.ok && removed.status !== 404) return json({ error: 'Delete failed' }, 502);
    return json({ ok: true });
  } catch {
    return json({ error: 'Delete failed' }, 502);
  }
}
