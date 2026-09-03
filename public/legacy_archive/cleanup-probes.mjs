// 清理调试残留：删除可能遗留的 _mvt3、root-check.txt、root-probe.txt、raw.txt
const base = 'http://127.0.0.1:8788';
const r0 = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'NmyBWykw2jsQVZmG5vs6' }) });
const cookie = r0.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
for (const p of ['_mvt3/', 'root-check.txt', 'root-probe.txt']) {
  const r = await fetch(base + '/api/files?path=' + encodeURIComponent(p), { method: 'DELETE', headers: { Cookie: cookie } });
  console.log('del', p, r.status);
}
