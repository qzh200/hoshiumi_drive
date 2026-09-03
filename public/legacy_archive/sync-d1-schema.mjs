// scripts/sync-d1-schema.mjs —— 把 schema 应用到 dev 用的本地 D1 文件
//
// 背景：wrangler d1 execute --local 与 wrangler pages dev 内部用不同 hash
// 算 sqlite 文件路径，前者会找到"自己"那个并写入，后者启动后又建了一个新文件，
// 互相看不见。本脚本找到 dev 用的文件（空表或缺 sessions）并把 schema 应用上去。
//
// 用法：node scripts/sync-d1-schema.mjs
import Database from 'better-sqlite3';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'F:\\博客文件\\hoshiumi_drive\\.wrangler\\state\\v3\\d1\\miniflare-D1DatabaseObject';
const sql = readFileSync('F:\\博客文件\\hoshiumi_drive\\migrations\\0001_init.sql', 'utf8');

const candidates = readdirSync(dir)
  .filter((n) => n.endsWith('.sqlite') && !n.startsWith('metadata') && !n.startsWith('_pre'))
  .map((n) => ({ name: n, path: join(dir, n) }))
  .filter((f) => statSync(f.path).isFile());

function hasSessions(path) {
  try {
    const db = new Database(path, { readonly: true });
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'").get();
    db.close();
    return !!row;
  } catch {
    return false;
  }
}

const need = candidates.filter((c) => !hasSessions(c.path));
if (!need.length) {
  console.log('[sync-d1-schema] all sqlite files already have sessions table; nothing to do');
  process.exit(0);
}
for (const c of need) {
  const db = new Database(c.path);
  db.exec(sql);
  console.log(`[sync-d1-schema] applied schema to ${c.name}`);
  db.close();
}

