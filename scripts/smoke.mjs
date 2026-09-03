// scripts/smoke.mjs —— 本地 wrangler dev 冒烟脚本（只读版）
//
// 跑法：node scripts/smoke.mjs（需要 dev server 已经在 :8788 起来）
// 覆盖：HTML / 列表（递归找文件）/ 单文件下载（带 Range）/ 预览 / 旧端点已不存在
const base = 'http://127.0.0.1:8788';

async function fetchAndCheck(label, url, opts = {}, extraCheck) {
  const res = await fetch(url, opts);
  const expectStatus = opts.status ?? (opts.expectOk === false ? null : 200);
  const ok = expectStatus == null
    ? (opts.expectOk === false ? !res.ok : res.ok)
    : res.status === expectStatus;
  const tag = ok ? '✅' : '❌';
  const text = await res.text();
  let snippet = text.slice(0, 120);
  try {
    if ((res.headers.get('content-type') ?? '').includes('json')) {
      snippet = JSON.stringify(JSON.parse(text));
    }
  } catch {
    /* keep raw text */
  }
  console.log(`${tag} ${label} [${res.status}] ${snippet}`);
  if (extraCheck) {
    try {
      extraCheck(res, JSON.parse(text));
    } catch {
      /* ignore parse errors here, body already shown */
    }
  }
  return { res, body: text };
}

async function listJson(prefix) {
  const r = await fetch(`${base}/api/list?prefix=${encodeURIComponent(prefix)}`);
  if (!r.ok) return null;
  return r.json();
}

/** BFS 找第一个文件（按字典序），限深 + 限数防止卡死 */
async function findFirstFile(maxDepth = 4, maxItems = 200) {
  const queue = [{ prefix: '', depth: 0 }];
  let seen = 0;
  while (queue.length) {
    const { prefix, depth } = queue.shift();
    const data = await listJson(prefix);
    if (!data) return null;
    for (const f of data.files || []) {
      if (!f.key.endsWith('/')) return f;
    }
    if (depth < maxDepth) {
      for (const f of data.folders || []) {
        queue.push({ prefix: f.key, depth: depth + 1 });
        if (++seen > maxItems) return null;
      }
    }
  }
  return null;
}

async function main() {
  await fetchAndCheck('GET /', base + '/');

  const root = await fetchAndCheck('GET /api/list?prefix=', base + '/api/list?prefix=');
  let rootData;
  try { rootData = JSON.parse(root.body); } catch { rootData = { files: [], folders: [] }; }
  console.log(
    `   root: ${rootData.files?.length ?? 0} files, ${rootData.folders?.length ?? 0} folders`,
  );

  const sample = await findFirstFile();
  if (!sample) {
    console.log('   (skip preview/download checks: no files in tree)');
  } else {
    console.log(`   sample file: ${sample.key}`);

    const dl = await fetchAndCheck(`GET /api/download?path=${sample.key}`,
      `${base}/api/download?path=${encodeURIComponent(sample.key)}`);
    const cd = dl.res.headers.get('content-disposition') || '';
    console.log(`   ${cd.toLowerCase().includes('attachment') ? '✅' : '❌'} attachment header: ${cd}`);

    const prev = await fetchAndCheck(`GET /api/preview?path=${sample.key}`,
      `${base}/api/preview?path=${encodeURIComponent(sample.key)}`);
    const cdPrev = prev.res.headers.get('content-disposition') || '';
    console.log(`   ${!cdPrev.toLowerCase().includes('attachment') ? '✅' : '❌'} preview not attachment (content-type=${prev.res.headers.get('content-type')})`);

    await fetchAndCheck(`GET /api/download Range: bytes=0-15`,
      `${base}/api/download?path=${encodeURIComponent(sample.key)}`,
      { status: 206 },
      (res) => {
        console.log(`   content-range=${res.headers.get('content-range')}; accept-ranges=${res.headers.get('accept-ranges')}`);
      });
  }

  await fetchAndCheck('GET /api/list?prefix=../etc/passwd (rejected)',
    `${base}/api/list?prefix=../etc/passwd`, { status: 400 });

  // 旧端点：Cloudflare Pages 没有匹配 function 时会走 SPA fallback 返回 HTML，
  // 这本身已经是「不存在」的信号；只要不是 JSON 业务响应就算「已移除」
  for (const path of ['/api/auth/session', '/api/folder', '/api/archive', '/api/files']) {
    const r = await fetch(base + path);
    const ct = r.headers.get('content-type') || '';
    const tag = !ct.includes('json') ? '✅' : '❌';
    console.log(`${tag} GET ${path} (no JSON business response) [${r.status}] content-type=${ct}`);
  }
}

main().catch((e) => {
  console.error('💥 smoke failed:', e);
  process.exit(1);
});
