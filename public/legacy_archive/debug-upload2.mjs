const base = 'http://127.0.0.1:8788';
const webdav = 'https://pan.moe/dav/';
const auth = 'Basic ' + btoa('2563070658@qq.com:LqW7HbQihK58gNZjlmpLuzhhnDq7FCDZ');
let cookie = '';
async function login() {
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'NmyBWykw2jsQVZmG5vs6' }) });
  cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}
async function main() {
  await login();
  // 1. 直接 WebDAV PUT 子目录（不走我们后端）
  let r = await fetch(webdav + '_mvt3/raw.txt', { method: 'PUT', headers: { Authorization: auth }, body: 'hello' });
  console.log('webdav PUT _mvt3/raw.txt:', r.status);
  // 2. 我们后端上传到根
  let form = new FormData();
  form.append('path', 'root-check.txt');
  form.append('file', new Blob(['x'], { type: 'text/plain' }), 'root-check.txt');
  r = await fetch(base + '/api/files', { method: 'POST', headers: { Cookie: cookie }, body: form });
  console.log('api upload root-check.txt:', r.status);
  // 3. 我们后端上传到子目录 _mvt3
  form = new FormData();
  form.append('path', '_mvt3/a.txt');
  form.append('file', new Blob(['alpha'], { type: 'text/plain' }), 'a.txt');
  r = await fetch(base + '/api/files', { method: 'POST', headers: { Cookie: cookie }, body: form });
  console.log('api upload _mvt3/a.txt:', r.status);
  // 4. list 子目录
  r = await fetch(base + '/api/files?prefix=' + encodeURIComponent('_mvt3/'), { headers: { Cookie: cookie } });
  console.log('list _mvt3/', r.status, (await r.text()).slice(0, 300));
  // 清理
  const del = await fetch(base + '/api/files?path=' + encodeURIComponent('_mvt3/'), { method: 'DELETE', headers: { Cookie: cookie } });
  console.log('cleanup _mvt3:', del.status);
  const del2 = await fetch(base + '/api/files?path=' + encodeURIComponent('root-check.txt'), { method: 'DELETE', headers: { Cookie: cookie } });
  console.log('cleanup root-check.txt:', del2.status);
}
main().catch((e) => { console.error(e); process.exit(1); });
