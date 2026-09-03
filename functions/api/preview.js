// preview.js —— 文件预览（不下载）
//
// 与 download 的区别：不设 Content-Disposition: attachment，
// 让浏览器根据 Content-Type 决定内联渲染（图片 / PDF / 文本 / 音视频）。
// 仍然公开，不需要登录。
import { badRequest, cleanPath } from '../_lib.js';
import { get } from '../_storage.js';

// 预览大小上限：超过则放弃预览，提示用户下载。
// 文本/代码类预览额外再限制 256KB，避免一次性把整本小说灌进 DOM。
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
  let object;
  try {
    object = await get(env, key);
  } catch {
    return new Response('Storage error', { status: 502 });
  }
  if (!object.ok) return new Response('Not found', { status: object.status === 404 ? 404 : 502 });

  const headers = new Headers();
  const upstreamType = object.headers.get('content-type') || 'application/octet-stream';
  headers.set('content-type', upstreamType);

  // 给静态资源加一个 5 分钟的边缘缓存；同名更新时通过路径区分（Cloudflare 用完整 URL 作为 key）
  headers.set('cache-control', 'public, max-age=300');

  // 安全：让浏览器严格按 Content-Type 渲染，不做嗅探
  headers.set('x-content-type-options', 'nosniff');

  // 大文件直接拒绝预览
  const sizeHeader = Number(object.headers.get('content-length') || 0);
  if (sizeHeader > MAX_PREVIEW_BYTES) {
    return jsonTooLarge();
  }

  const kind = classify(upstreamType);
  if (kind === 'text' && sizeHeader > MAX_TEXT_PREVIEW_BYTES) {
    return jsonTooLarge(MAX_TEXT_PREVIEW_BYTES);
  }

  // 文本类用只读沙箱 iframe 渲染（避免 SVG / HTML 内联脚本执行）
  // 浏览器对 image / pdf / audio / video 已有自己的安全策略
  if (kind === 'image' || kind === 'pdf' || kind === 'audio' || kind === 'video' || kind === 'text') {
    return new Response(object.body, { headers });
  }

  return new Response('Preview not supported for this type. Use download instead.', {
    status: 415,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

function jsonTooLarge(limit) {
  return new Response(JSON.stringify({ error: 'File too large to preview', limit: limit || MAX_PREVIEW_BYTES }), {
    status: 413,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
