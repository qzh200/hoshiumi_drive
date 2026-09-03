// scripts/smoke.mjs —— 本地 wrangler dev 冒烟脚本（只读版）
//
// 跑法：node scripts/smoke.mjs（需要 dev server 已经在 :8788 起来）
// 覆盖：HTML / 列表 / 单文件下载（带 Range）/ 预览 / 旧端点已删除（404）
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

async function main() {
  // 1. 静态页
  await fetchAndCheck('GET /', base + '/');

  // 2. 列根目录
  const list = await fetchAndCheck('GET /api/list?prefix=', base + '/api/list?prefix=');
  let data;
  try { data = JSON.parse(list.body); } catch { data = { files: [], folders: [] }; }
  const sample = data.files?.[0] ?? data.folders?.[0];
  console.log(
    `   items: ${data.files?.length ?? 0} files, ${data.folders?.length ?? 0} folders` +
      (sample ? `; sample=${sample.key}` : ''),
  );

  if (!sample) {
    console.log('   (skip preview/download checks: empty root)');
  } else {
    // 3. 下载
    const dl = await fetchAndCheck(`GET /api/download?path=${sample.key}`,
      `${base}/api/download?path=${encodeURIComponent(sample.key)}`);
    const cd = dl.res.headers.get('content-disposition') || '';
    console.log(`   ${cd.toLowerCase().includes('attachment') ? '✅' : '❌'} attachment header: ${cd}`);

    // 4. 预览
    const prev = await fetchAndCheck(`GET /api/preview?path=${sample.key}`,
      `${base}/api/preview?path=${encodeURIComponent(sample.key)}`);
    const cdPrev = prev.res.headers.get('content-disposition') || '';
    console.log(`   ${!cdPrev.toLowerCase().includes('attachment') ? '✅' : '❌'} preview not attachment (content-type=${prev.res.headers.get('content-type')})`);

    // 5. Range 透传
    const rangeRes = await fetchAndCheck(`GET /api/download Range: bytes=0-15`,
      `${base}/api/download?path=${encodeURIComponent(sample.key)}`,
      { status: 206 },
      (res) => {
        console.log(`   content-range=${res.headers.get('content-range')}; accept-ranges=${res.headers.get('accept-ranges')}`);
      });
  }

  // 6. 错误路径
  await fetchAndCheck('GET /api/list?prefix=../etc/passwd (rejected)',
    `${base}/api/list?prefix=../etc/passwd`, { status: 400 });

  // 7. 旧端点全部 404
  for (const path of ['/api/auth/session', '/api/folder', '/api/archive', '/api/files']) {
    await fetchAndCheck(`GET ${path} (should be 404)`, base + path, { expectOk: false, status: 404 });
  }
}

main().catch((e) => {
  console.error('💥 smoke failed:', e);
  process.exit(1);
});
