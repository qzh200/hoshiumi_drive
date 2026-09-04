// GET /api/download/<file path> - stream a file as an attachment（path 在 URL 段里）
import { badRequest, urlPathSegments } from '../../_lib.js';
import { get } from '../../_storage.js';

export async function onRequestGet({ request, env }) {
  const segments = urlPathSegments(request, '/api/download/');
  if (segments === null || segments.length === 0) return badRequest('Invalid path');
  const key = segments.join('/');
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
  if (!headers.get('content-type')) headers.set('content-type', 'application/octet-stream');
  if (!headers.get('accept-ranges')) headers.set('accept-ranges', 'bytes');
  headers.set('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(key.split('/').pop())}`);
  headers.set('x-content-type-options', 'nosniff');
  return new Response(object.body, { status: object.status, headers });
}
