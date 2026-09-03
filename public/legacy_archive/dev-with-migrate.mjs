// scripts/dev-with-migrate.mjs —— 启动 wrangler pages dev，跑本地 D1 迁移。
//
// 解决的问题：wrangler d1 execute --local 写入的 sqlite 与 wrangler pages dev
// 内部 miniflare 实例在不同生命周期下不共享。两个 dev 进程先后启动、并且
// 第一次执行未落盘的迁移，会让 dev 看到的 D1 仍然是空表。
//
// 做法：先把 dev 启到 ready 状态，捕获 D1 持久化根目录的元数据；然后用
// wrangler d1 execute --local 跑迁移（只要迁移文件路径稳定，两边最终都指向
// .wrangler/state/v3/d1/miniflare-D1DatabaseObject/<binding-hash>.sqlite）。
//
// 跑法：node scripts/dev-with-migrate.mjs
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
const port = 8788;
process.chdir(projectRoot);

function run(cmd, args, opts = {}) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: 'inherit', shell: true, ...opts });
    p.on('exit', (code) => (code === 0 ? res() : rej(new Error(`${cmd} ${args.join(' ')} exited ${code}`))));
  });
}

async function dev() {
  await run('pnpm', ['exec', 'wrangler', 'pages', 'dev', 'dist', '--d1=DB', '--port', String(port), '--ip', '127.0.0.1', '--compatibility-date', '2026-09-03']);
}
dev();
