// scripts/smoke.mjs —— 本地 wrangler dev 冒烟脚本
//
// 跑法：node scripts/smoke.mjs（需要 dev server 已经在 :8788 起来）
// 覆盖：HTML / 错误密码 / 正确密码登录 / 受 cookie 保护 / 上传 / 重命名 / 删除 / 登出
const base = 'http://127.0.0.1:8788';
const masterKey = 'NmyBWykw2jsQVZmG5vs6';

let cookies = '';
function setCookiesFrom(res) {
  const set = res.headers.getSetCookie?.() ?? res.headers.raw?.()['set-cookie'] ?? [];
  if (Array.isArray(set) && set.length) {
    cookies = set
      .map((c) => c.split(';')[0])
      .filter((c) => c.startsWith('drive_session='))
      .join('; ');
  }
}
function authHeaders() {
  return cookies ? { Cookie: cookies } : {};
}

async function check(label, res, opts = {}) {
  const ok = opts.status ? res.status === opts.status : res.ok;
  const tag = ok ? '✅' : '❌';
  let body = '';
  try {
    const ct = res.headers.get('content-type') ?? '';
    body = ct.includes('json') ? JSON.stringify(await res.json()) : (await res.text()).slice(0, 80);
  } catch (e) {
    body = `<err: ${e.message}>`;
  }
  console.log(`${tag} ${label} [${res.status}] ${body}`);
  return res;
}

async function main() {
  // 1. 静态页
  const home = await fetch(base + '/');
  await check('GET /', home, { status: 200 });

  // 2. session 未登录
  const sess0 = await fetch(base + '/api/auth/session');
  await check('GET /api/auth/session (unauth)', sess0);
  setCookiesFrom(sess0);

  // 3. 错误密码
  const bad = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: 'wrong' }),
  });
  await check('POST /api/auth/login (wrong)', bad, { status: 401 });

  // 4. 正确密码
  const ok = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: masterKey }),
  });
  await check('POST /api/auth/login (good)', ok, { status: 200 });
  setCookiesFrom(ok);

  // 5. session 已登录
  const sess1 = await fetch(base + '/api/auth/session', { headers: authHeaders() });
  await check('GET /api/auth/session (auth)', sess1);

  // 6. 列表
  const list = await fetch(base + '/api/files?prefix=', { headers: authHeaders() });
  const data = await list.json();
  await check('GET /api/files?prefix= (auth)', list);
  const hasTestTxt = data.files.some((f) => f.name === 'test.txt');
  console.log(`   files: ${data.files.map((f) => f.name).join(', ') || '(none)'}; test.txt present=${hasTestTxt}`);

  // 7. 上传
  const form = new FormData();
  form.append('path', 'smoke-test.txt');
  form.append('file', new Blob(['hello from smoke ' + new Date().toISOString()], { type: 'text/plain' }), 'smoke-test.txt');
  const up = await fetch(base + '/api/files', { method: 'POST', headers: authHeaders(), body: form });
  await check('POST /api/files (upload)', up, { status: 201 });

  // 8. 列表确认上传成功
  const list2 = await fetch(base + '/api/files?prefix=', { headers: authHeaders() });
  const data2 = await list2.json();
  const found = data2.files.some((f) => f.name === 'smoke-test.txt');
  console.log(`   after upload: smoke-test.txt present=${found}`);

  // 9. 重命名
  const ren = await fetch(base + '/api/files', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ from: 'smoke-test.txt', to: 'smoke-test-renamed.txt' }),
  });
  await check('PATCH /api/files (rename)', ren);

  // 10. 删除
  const del = await fetch(base + '/api/files?path=smoke-test-renamed.txt', { method: 'DELETE', headers: authHeaders() });
  await check('DELETE /api/files?path=smoke-test-renamed.txt', del);

  // 11. 登出
  const out = await fetch(base + '/api/auth/logout', { method: 'POST', headers: authHeaders() });
  await check('POST /api/auth/logout', out, { status: 200 });
  cookies = '';

  // 12. 确认未登录
  const sess2 = await fetch(base + '/api/auth/session');
  const sess2json = await sess2.json();
  await check('GET /api/auth/session (after logout)', sess2);
  if (sess2json.authenticated === false) console.log('   ✅ logged out confirmed');
  else console.log('   ❌ still authenticated!');

  // 13. 受保护端点未登录应 401
  const noAuthUpload = await fetch(base + '/api/files?path=foo', { method: 'DELETE' });
  await check('DELETE /api/files without cookie', noAuthUpload, { status: 401 });

  // 14. 预览：登录态下访问一个已知文件，验证 Content-Type / 没 attachment
  // 先抓列表里第一个文件
  const listForPreview = await fetch(base + '/api/files?prefix=', { headers: authHeaders() });
  const listForPreviewJson = await listForPreview.json();
  if (listForPreviewJson.files.length) {
    const target = listForPreviewJson.files[0];
    const prev = await fetch(base + '/api/preview?path=' + encodeURIComponent(target.key), { headers: authHeaders() });
    const cd = prev.headers.get('content-disposition') || '';
    const ct = prev.headers.get('content-type') || '';
    await check(`GET /api/preview?path=${target.key}`, prev);
    if (cd.toLowerCase().includes('attachment')) console.log(`   ❌ preview set Content-Disposition: ${cd}`);
    else console.log(`   ✅ no attachment header; content-type=${ct}`);
  } else {
    console.log('   (skip preview check: no files in root)');
  }
}

main().catch((e) => {
  console.error('💥 smoke failed:', e);
  process.exit(1);
});
