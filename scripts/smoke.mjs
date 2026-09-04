// scripts/smoke.mjs —— 本地 wrangler dev 冒烟脚本（只读版）
//
// 跑法：node scripts/smoke.mjs（需要 dev server 已经在 :8788 起来）
// 覆盖：HTML / 列表（递归找文件）/ 单文件下载（带 Range）/ 预览 / 旧端点已不存在
// 说明：样例文件从存储里自动发现（找 txt、找 zip），不依赖任何特定目录结构。
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
  // path 在 URL 段里（encodeURI 保留 /）
  const rel = prefix.split('/').filter(Boolean).map(encodeURIComponent).join('/');
  const r = await fetch(`${base}/api/list/${rel ? rel + '/' : ''}`);
  if (!r.ok) return null;
  return r.json();
}

/** BFS 找某个扩展名的第一个文件（限深限数，防止卡死） */
async function findFileByExt(ext, maxDepth = 6, maxItems = 400) {
  const queue = [{ prefix: '', depth: 0 }];
  let seen = 0;
  while (queue.length) {
    const { prefix, depth } = queue.shift();
    const data = await listJson(prefix);
    if (!data) return null;
    for (const f of data.files || []) {
      const name = f.key.split('/').pop() || '';
      if (name.toLowerCase().endsWith(`.${ext}`)) return f;
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

  const root = await fetchAndCheck('GET /api/list/', base + '/api/list/');
  let rootData;
  try { rootData = JSON.parse(root.body); } catch { rootData = { files: [], folders: [] }; }
  console.log(
    `   root: ${rootData.files?.length ?? 0} files, ${rootData.folders?.length ?? 0} folders`,
  );

  const sample = (await findFileByExt('txt')) || (await findFileByExt('md'));
  if (!sample) {
    console.log('   (skip preview/download checks: no text file in tree)');
  } else {
    console.log(`   sample file: ${sample.key}`);

    const dl = await fetchAndCheck(`GET /api/download/${sample.key}`,
      `${base}/api/download/${encodeURI(sample.key)}`);
    const cd = dl.res.headers.get('content-disposition') || '';
    console.log(`   ${cd.toLowerCase().includes('attachment') ? '✅' : '❌'} attachment header: ${cd}`);

    const prev = await fetchAndCheck(`GET /api/preview/${sample.key}`,
      `${base}/api/preview/${encodeURI(sample.key)}`);
    const cdPrev = prev.res.headers.get('content-disposition') || '';
    console.log(`   ${!cdPrev.toLowerCase().includes('attachment') ? '✅' : '❌'} preview not attachment (content-type=${prev.res.headers.get('content-type')})`);

    await fetchAndCheck(`GET /api/download/${sample.key} Range: bytes=0-15`,
      `${base}/api/download/${encodeURI(sample.key)}`,
      { status: 206 },
      (res) => {
        console.log(`   content-range=${res.headers.get('content-range')}; accept-ranges=${res.headers.get('accept-ranges')}`);
      });
  }

  // 路径穿越/非法段拒绝（URL 会先归一化裸 ../，这里用编码段确保到达函数）
  await fetchAndCheck('GET /api/list/%2E%2E/x (rejected)',
    `${base}/api/list/${encodeURIComponent('..')}/x`, { status: 400 });

  // zip/压缩包直接走 preview 端点：统一端点必须回 raw bytes（不应 415 / attachment）
  const zipSample = await findFileByExt('zip');
  if (zipSample) {
    const zipPrev = await fetchAndCheck(`GET /api/preview/${zipSample.key} (zip raw bytes)`,
      `${base}/api/preview/${encodeURI(zipSample.key)}`);
    const cdZip = zipPrev.res.headers.get('content-disposition') || '';
    console.log(`   zip preview size: ${zipPrev.res.headers.get('content-length')} bytes; attachment=${cdZip.toLowerCase().includes('attachment') ? 'yes!' : 'no'}`);
  } else {
    console.log('   (no zip file found in tree — skipped zip preview check)');
  }

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
