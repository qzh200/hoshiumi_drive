// scripts/sync-streamsaver.mjs —— 把 streamsaver 依赖的两个静态资源同步到 public/streamsaver/
//
// StreamSaver 不是纯 JS 库：它需要同源托管一个 Service Worker（sw.js）和一个
// “man in the middle” 页面（mitm.html），由 mitm 页面负责注册 SW 并把页面里的
// MessageChannel 转发给 SW，SW 再伪装成服务端响应，触发浏览器原生下载。
//
// 这两个文件直接来自 node_modules/streamsaver，为了不手抄、版本不漂移，在 build 前
// 自动同步一份到 public/ 下（Astro build 会原样拷进 dist/）。dist/ 已存在时（本地
// dev 直接用旧 dist），也顺手镜像一份进去，保证 dev 可用。
//
// 用法：pnpm streamsaver:sync（prebuild / predev 已挂上）
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');

const FILES = ['sw.js', 'mitm.html'];

function resolveStreamSaverRoot() {
  try {
    return dirname(require.resolve('streamsaver/package.json'));
  } catch {
    return null;
  }
}

function syncInto(targetDir) {
  mkdirSync(targetDir, { recursive: true });
  for (const file of FILES) {
    const src = resolve(pkgRoot, file);
    const dest = resolve(targetDir, file);
    copyFileSync(src, dest);
    console.log(`[sync-streamsaver] ${file} -> public/streamsaver/${file}`);
  }
}

const pkgRoot = resolveStreamSaverRoot();
if (!pkgRoot) {
  console.warn('[sync-streamsaver] 找不到 streamsaver（node_modules 未安装？），跳过同步');
  process.exit(0);
}

const publicDir = resolve(projectRoot, 'public/streamsaver');
syncInto(publicDir);

// 本地 dev（pnpm dev）直接用已存在的 dist 起服务：若 dist 已有，镜像一份，避免旧 dist 缺 SW 资源
const distDir = resolve(projectRoot, 'dist');
if (existsSync(distDir)) {
  syncInto(resolve(distDir, 'streamsaver'));
}
