/**
 * postbuild：部署收尾
 *
 * 注意：本脚本在 Cloudflare Pages 的 Linux 构建机上运行，也在本地 Windows 跑，
 * 因此【不能】依赖任何平台特定命令（powershell / sh）。用纯 Node 实现。
 *
 * 职责：
 *   - 生成 / 维护 dist/_headers（静态资源缓存与安全头）。
 *
 * 不做的事：
 *   - 不再把 functions/ 复制进 dist/functions。Cloudflare Pages（Git 集成）
 *     会直接编译仓库根目录的 functions/；wrangler pages deploy / pages dev
 *     也会自动使用仓库根的 functions/（可通过 --functions 覆盖）。多复制一份
 *     反而可能触发「重复 Functions 目录」的告警。
 */
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');
const distDir = resolve(projectRoot, 'dist');

if (!existsSync(distDir)) {
  console.error(`[postbuild] 找不到 ${distDir}，请先执行 astro build`);
  process.exit(1);
}

const HEADERS_CONTENT = [
  '/*',
  '  X-Content-Type-Options: nosniff',
  '  Referrer-Policy: strict-origin-when-cross-origin',
  '',
  '/fonts/*',
  '  Cache-Control: public, max-age=31536000, immutable',
  '',
].join('\n');

const headersPath = resolve(distDir, '_headers');
if (!existsSync(headersPath) || readFileSync(headersPath, 'utf8') !== HEADERS_CONTENT) {
  writeFileSync(headersPath, HEADERS_CONTENT, 'utf8');
}

// 兼容直接使用 dist 作为部署目录的工具（如旧脚本）
mkdirSync(distDir, { recursive: true });
console.log('[postbuild] 已写入 dist/_headers');
