// scripts/dev-up.mjs —— 启动 wrangler pages dev，自动同步 D1 schema
//
// 解决 wrangler 4.x 的一个怪现状：
//   `wrangler d1 execute --local` 与 `wrangler pages dev` 内部用不同 hash
//   算 sqlite 文件路径，前者写到 "自己的" 那个，后者又开了一个新的。
//   直接按 README 顺序跑（先 migrate 再 dev）会报 "no such table: sessions"。
//
// 这里做法：先启动 dev、等到 ready、跑一次 sync 把 schema 同步过去、
// 之后再让用户操作；用户可以 Ctrl-C 杀掉本进程，dev 也会一起退出。
//
// 依赖：node + better-sqlite3（devDependencies 已有）
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');
process.chdir(projectRoot);

function runCapture(cmd, args) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { cwd: projectRoot, stdio: ['ignore', 'pipe', 'pipe'], shell: true });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d.toString()));
    p.stderr.on('data', (d) => (err += d.toString()));
    p.on('exit', (code) => (code === 0 ? res({ out, err }) : rej(new Error(`${cmd} ${args.join(' ')} exited ${code}: ${err}`))));
  });
}

function spawnDev() {
  return spawn(
    'pnpm',
    [
      'exec',
      'wrangler',
      'pages',
      'dev',
      'dist',
      '--d1=DB',
      '--port',
      '8788',
      '--ip',
      '127.0.0.1',
      '--compatibility-date',
      '2026-09-03',
    ],
    { cwd: projectRoot, stdio: 'inherit', shell: true },
  );
}

console.log('[dev-up] 1/3 wrangler d1 execute（建 sessions 表）');
try {
  await runCapture('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'DB', '--local', '--file=migrations/0001_init.sql']);
} catch (e) {
  console.error('[dev-up] migrate 失败：', e.message);
  process.exit(1);
}

console.log('[dev-up] 2/3 启动 wrangler pages dev（让它先建自己的 sqlite 文件）');
let dev = spawnDev();
// 给 dev 5 秒启动 + 建 sqlite
await new Promise((r) => setTimeout(r, 5000));

console.log('[dev-up] 3/3 同步 schema 到 dev 用的 sqlite');
try {
  await runCapture('node', ['./scripts/sync-d1-schema.mjs']);
} catch (e) {
  console.warn('[dev-up] sync 失败（可能 dev 还没建文件，可重试）：', e.message);
}

console.log('[dev-up] 完成。dev 仍在跑；Ctrl-C 退出。');

// 把用户输入转发给 dev，让 Ctrl-C 正常终止
process.stdin.pipe(dev.stdin);
process.on('SIGINT', () => {
  dev.kill('SIGINT');
  setTimeout(() => process.exit(0), 200);
});
process.on('SIGTERM', () => {
  dev.kill('SIGTERM');
  process.exit(0);
});

dev.on('exit', (code) => {
  console.log(`[dev-up] dev exited (${code})`);
  process.exit(code ?? 0);
});
