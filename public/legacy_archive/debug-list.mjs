const r = await fetch('http://127.0.0.1:8788/api/files?prefix=');
const t = await r.text();
console.log('status', r.status);
// 500 dumper 页把错误信息渲染进 HTML，找其中的提示片段
const m = t.match(/<pre[^>]*>([\s\S]*?)<\/pre>/);
console.log('pre:', m ? m[1].slice(0, 2000) : '(none)');
const idx = t.indexOf('at ');
console.log('tail excerpt:\n', t.slice(-1500));
