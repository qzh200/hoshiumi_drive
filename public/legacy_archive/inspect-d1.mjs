// 一次性工具：扫所有 sqlite 文件，列里面的表
import Database from 'better-sqlite3';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'F:\\博客文件\\hoshiumi_drive\\.wrangler\\state\\v3\\d1\\miniflare-D1DatabaseObject';
for (const name of readdirSync(dir)) {
  if (!name.endsWith('.sqlite')) continue;
  const full = join(dir, name);
  try {
    const db = new Database(full, { readonly: true });
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    console.log(`${name}: ${tables.map((t) => t.name).join(', ') || '(empty)'}`);
    db.close();
  } catch (e) {
    console.log(`${name}: ERR ${e.message}`);
  }
}
