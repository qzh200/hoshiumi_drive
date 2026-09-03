// preview.js —— 文件预览（不下载，Range 透传）
//
// 与 download 的区别：
//   - 不设 Content-Disposition: attachment，让浏览器按 Content-Type 内联渲染
//     （图片 / PDF / 音视频 / 文本）
//   - 同时透传 Range：视频/音频的 <video>/<audio> 拖进度条才能正常工作
//   - 仍对同一文件 5 分钟边缘缓存（同名更新通过路径区分）
//
// 不需要任何认证。
import { badRequest, cleanPath, json } from '../_lib.js';
import { get } from '../_storage.js';

// 预览大小上限：超过则放弃预览，提示用户下载。
// 文本/代码类额外再限制 256KB，避免一次性把整本小说灌进 DOM。
const MAX_PREVIEW_BYTES = 50 * 1024 * 1024;
const MAX_TEXT_PREVIEW_BYTES = 256 * 1024;

// 浏览器内联预览能接受的 mime 集合
const INLINE_IMAGE = /^image\//;
const INLINE_AUDIO = /^audio\//;
const INLINE_VIDEO = /^video\//;
const INLINE_TEXT = /^(text\/|application\/(json|xml|javascript|x-yaml|ld\+json|markdown|x-sh)|image\/svg\+xml)/;
const INLINE_PDF = /^application\/pdf$/;

export function classify(mime) {
  if (!mime) return 'unknown';
  if (INLINE_IMAGE.test(mime) || mime === 'image/svg+xml') return 'image';
  if (INLINE_PDF.test(mime)) return 'pdf';
  if (INLINE_AUDIO.test(mime)) return 'audio';
  if (INLINE_VIDEO.test(mime)) return 'video';
  if (INLINE_TEXT.test(mime)) return 'text';
  return 'binary';
}

export async function onRequestGet({ request, env }) {
  const key = cleanPath(new URL(request.url).searchParams.get('path'));
  if (!key) return badRequest('Invalid path');

  const rangeHeader = request.headers.get('Range');
  let object;
  try {
    object = await get(env, key, { rangeHeader });
  } catch (error) {
    console.error('[preview] WebDAV get failed:', error);
    return new Response('Storage error', { status: 502 });
  }
  if (!object.ok) {
    return new Response(object.status === 404 ? 'Not found' : 'Upstream error', {
      status: object.status === 404 ? 404 : 502,
    });
  }

  const headers = new Headers(object.headers);
  const upstreamType = headers.get('content-type') || 'application/octet-stream';
  headers.set('content-type', upstreamType);
  if (!headers.get('accept-ranges')) headers.set('accept-ranges', 'bytes');

  // 边缘缓存：同一路径 5 分钟；URL 含 path 参数所以不同文件自然分开
  if (!rangeHeader) headers.set('cache-control', 'public, max-age=300');

  // 安全：让浏览器严格按 Content-Type 渲染，不做嗅探
  headers.set('x-content-type-options', 'nosniff');

  // 大文件直接拒绝预览
  const sizeHeader = Number(headers.get('content-length') || 0);
  if (sizeHeader > MAX_PREVIEW_BYTES) {
    return jsonTooLarge();
  }

  const kind = classify(upstreamType);
  if (kind === 'text' && sizeHeader > MAX_TEXT_PREVIEW_BYTES) {
    return jsonTooLarge(MAX_TEXT_PREVIEW_BYTES);
  }

  // 浏览器对 image / pdf / audio / video 已有自己的安全策略；
  // 文本类用只读沙箱 iframe 渲染（避免 SVG / HTML 内联脚本执行）—— 由前端做
  if (kind === 'image' || kind === 'pdf' || kind === 'audio' || kind === 'video' || kind === 'text') {
    return new Response(object.body, { status: object.status, headers });
  }

  return new Response('Preview not supported for this type. Use download instead.', {
    status: 415,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

function jsonTooLarge(limit) {
  return json({ error: 'File too large to preview', limit: limit || MAX_PREVIEW_BYTES }, 413);
}
