const re = /<[^>]*collection\s*\/?\s*>/i;
const xml = '<D:resourcetype><D:collection xmlns:D="DAV:"/></D:resourcetype>';
console.log('match:', re.test(xml));
const block = '<D:resourcetype><D:collection xmlns:D="DAV:"/></D:resourcetype>';
console.log('block:', block);
const m = block.match(re);
console.log('matched:', m?.[0]);
