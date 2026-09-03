/**
 * postbuild：把 Cloudflare Pages Functions 与生成的后端配置复制到 dist/。
 *
 * 用法：在 astro build 之后自动触发（package.json 的 postbuild 调用）。
 *
 * 复制策略：
 *   1. functions/_config.generated.json  → dist/functions/_config.generated.json
 *   2. functions/ 整目录                  → dist/functions/
 *      （Pages Functions 通过目录约定自动加载；Astro 不会触碰这个目录）
 *   3. 写一个简单的 _headers，给静态资源设置合理缓存与安全头
 *
 * 实现说明：Node 的 fs.cpSync 在 Windows 上递归大目录时偶尔会触发
 * STATUS_STACK_BUFFER_OVERRUN（0xC0000409）。我们改成 spawn powershell
 * 调 Copy-Item -Recurse，更稳；脚本里所有动作幂等。
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, writeFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');
const functionsDir = resolve(projectRoot, 'functions');
const distDir = resolve(projectRoot, 'dist');
const targetFunctionsDir = resolve(distDir, 'functions');

if (!existsSync(distDir)) {
  console.error(`[postbuild] 找不到 ${distDir}，请先执行 astro build`);
  process.exit(1);
}

mkdirSync(targetFunctionsDir, { recursive: true });

// 用 PowerShell Copy-Item 递归拷贝（避免 Node cpSync 在 Windows 大目录下的栈溢出）
function copyRecursive(src, dst) {
  const r = spawnSync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `if (Test-Path '${dst}') { Remove-Item -LiteralPath '${dst}' -Recurse -Force }; Copy-Item -LiteralPath '${src}' -Destination '${dst}' -Recurse -Force`,
  ], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(`[postbuild] 复制失败: ${src} -> ${dst}\n${r.stderr || r.stdout}`);
    process.exit(1);
  }
}

copyRecursive(functionsDir, targetFunctionsDir);

// 简单 _headers
const headersPath = resolve(distDir, '_headers');
if (!existsSync(headersPath)) {
  writeFileSync(
    headersPath,
    [
      '/*',
      '  X-Content-Type-Options: nosniff',
      '  Referrer-Policy: strict-origin-when-cross-origin',
      '',
      '/fonts/*',
      '  Cache-Control: public, max-age=31536000, immutable',
      '',
    ].join('\n'),
    'utf8',
  );
}

const size = statSync(targetFunctionsDir).size;
console.log(`[postbuild] Functions 已复制到 ${targetFunctionsDir} (${(size / 1024).toFixed(1)} KB)`);
