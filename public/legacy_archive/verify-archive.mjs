// 一次性验证脚本（在本地 dev 上）：
// 1. 新建临时目录 _mvt
// 2. 上传两个小文件
// 3. 目录重命名 _mvt -> _mvt2（验证带斜杠 MOVE）
// 4. 打包下载 _mvt2 (zip) 并检查头 PK
// 5. 清理：删除目录
const base = 'http://127.0.0.1:8788';
let cookie = '';
async function login() {
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'NmyBWykw2jsQVZmG5vs6' }) });
  const set = r.headers.getSetCookie();
  cookie = set.map((c) => c.split(';')[0]).join('; ');
}
async function jfetch(url, init = {}) {
  const res = await fetch(base + url, { ...init, headers: { Cookie: cookie, ...(init.headers || {}) } });
  const ct = res.headers.get('content-type') || '';
  const body = ct.includes('json') ? await res.json() : await res.text();
  return { status: res.status, body };
}
async function mkdir(name) {
  const r = await jfetch('/api/folder', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: name }) });
  console.log(`mkdir ${name}:`, r.status);
}
async function upload(name, content) {
  const form = new FormData();
  form.append('path', name);
  form.append('file', new Blob([content], { type: 'text/plain' }), name.split('/').pop());
  const r = await fetch(base + '/api/files', { method: 'POST', headers: { Cookie: cookie }, body: form });
  console.log(`upload ${name}:`, r.status);
}
async function main() {
  await login();
  console.log('--- 1 建临时目录 ---');
  await mkdir('_mvt');
  console.log('--- 2 上传 ---');
  await upload('_mvt/a.txt', 'alpha');
  await upload('_mvt/b.txt', 'beta');
  console.log('--- 3 重命名目录 ---');
  const mv = await jfetch('/api/files', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from: '_mvt/', to: '_mvt2/' }) });
  console.log('rename _mvt/->_mvt2/:', mv.status, mv.body);
  console.log('--- 4 打包 ---');
  const zip = await fetch(base + '/api/archive?path=' + encodeURIComponent('_mvt2/'), { headers: { Cookie: cookie } });
  const buf = Buffer.from(await zip.arrayBuffer());
  console.log('archive status:', zip.status, 'size:', buf.length, 'head:', buf.subarray(0, 4).toString('hex'));
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
  console.log('is ZIP (PK):', isZip);
  // 解包验证一下包含 a.txt/b.txt
  const names = [];
  let i = 0;
  const nameOf = (offset) => {
    if (buf.readUInt32LE(offset) !== 0x04034b50) return null;
    const nlen = buf.readUInt16LE(offset + 26);
    return buf.subarray(offset + 30, offset + 30 + nlen).toString('utf8');
  };
  while (i < buf.length - 4 && buf.readUInt32LE(i) === 0x04034b50) {
    const n = nameOf(i);
    if (n) names.push(n);
    const nlen = buf.readUInt16LE(i + 26);
    const clen = buf.readUInt32LE(i + 18);
    i += 30 + nlen + clen;
  }
  console.log('entries:', names.join(', '));
  console.log('--- 5 清理 ---');
  const del = await jfetch('/api/files?path=' + encodeURIComponent('_mvt2/'), { method: 'DELETE' });
  console.log('delete _mvt2/:', del.status, del.body);
}
main().catch((e) => { console.error(e); process.exit(1); });
