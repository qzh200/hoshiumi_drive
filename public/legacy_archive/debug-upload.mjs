const base = 'http://127.0.0.1:8788';
let cookie = '';
async function login() {
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'NmyBWykw2jsQVZmG5vs6' }) });
  cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}
async function main() {
  await login();
  const mk = await fetch(base + '/api/folder', { method: 'POST', headers: { 'content-type': 'application/json', Cookie: cookie }, body: JSON.stringify({ path: '_mvt3' }) });
  console.log('mkdir _mvt3:', mk.status, await mk.text());
  const form = new FormData();
  form.append('path', '_mvt3/a.txt');
  form.append('file', new Blob(['alpha'], { type: 'text/plain' }), 'a.txt');
  const up = await fetch(base + '/api/files', { method: 'POST', headers: { Cookie: cookie }, body: form });
  console.log('upload raw:', up.status, (await up.text()).slice(0, 500));
}
main();
