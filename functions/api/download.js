// download.js —— 文件下载（流式转发，Range 透传）
//
// 行为：
//   - 默认强制下载（Content-Disposition: attachment）
//   - 透传 Range：浏览器拖进度条 / 断点续传都能用
//   - 与 preview 的区别：这里强制 attachment，preview 让浏览器内联渲染
//
// 不需要任何认证。
import { badRequest, cleanPath } from '../_lib.js';
import { get } from '../_storage.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const key = cleanPath(url.searchParams.get('path'));
  if (!key) return badRequest('Invalid path');

  const rangeHeader = request.headers.get('Range');
  let object;
  try {
    object = await get(env, key, { rangeHeader });
  } catch (error) {
    console.error('[download] WebDAV get failed:', error);
    return new Response('Storage error', { status: 502 });
  }
  if (!object.ok) {
    return new Response(object.status === 404 ? 'Not found' : 'Upstream error', {
      status: object.status === 404 ? 404 : 502,
    });
  }

  const headers = new Headers(object.headers);
  // 没拿到 content-type 时兜底
  if (!headers.get('content-type')) headers.set('content-type', 'application/octet-stream');
  // 浏览器需要明确知道支持 range
  if (!headers.get('accept-ranges')) headers.set('accept-ranges', 'bytes');
  // 强制下载
  headers.set(
    'content-disposition',
    `attachment; filename*=UTF-8''${encodeURIComponent(key.split('/').pop())}`,
  );
  // 文件元数据（修改时间）方便客户端展示；不强制
  return new Response(object.body, { status: object.status, headers });
}
