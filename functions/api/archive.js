// archive.js —— 文件夹打包下载（ZIP, Store 无压缩 + 手动 CRC32）
//
// WebDAV 递归 Depth:1 列出目录，读取全部文件字节后在 Worker 内拼成 zip 返回。
// 个人云盘量级足够；超过 MAX_ARCHIVE_BYTES 直接拒绝，防止内存打爆。
import { badRequest, cleanKeyPath } from '../_lib.js';
import * as storage from '../_storage.js';

const MAX_ARCHIVE_BYTES = 300 * 1024 * 1024; // 300MB 上限

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 目录递归收集；文件夹条目也入包（保留空目录） */
async function walk(env, rootKey, relDir, entries) {
  const { folders, files } = await storage.list(env, rootKey);
  for (const f of folders) {
    const rel = `${relDir}${f.name}/`;
    entries.push({ name: rel, folder: true });
    await walk(env, f.key, rel, entries);
  }
  for (const f of files) {
    entries.push({ name: `${relDir}${f.name}`, folder: false, key: f.key, size: f.size || 0 });
  }
}

export async function onRequestGet({ request, env }) {
  const key = cleanKeyPath(new URL(request.url).searchParams.get('path'));
  if (!key) return badRequest('Invalid path');
  if (!key.endsWith('/')) return badRequest('Archive requires a folder path');

  const folderName = key.split('/').filter(Boolean).pop() || 'download';

  const entries = [];
  try {
    await walk(env, key, '', entries);
  } catch {
    return new Response('Unable to read folder', { status: 502 });
  }
  if (!entries.length) return new Response('Folder is empty', { status: 404 });

  // 读取所有文件字节
  const dataByEntry = new Map();
  let totalBytes = 0;
  for (const entry of entries) {
    if (entry.folder) continue;
    try {
      const res = await storage.get(env, entry.key);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      dataByEntry.set(entry, buf);
      totalBytes += buf.length;
      if (totalBytes > MAX_ARCHIVE_BYTES) {
        return new Response('Folder too large to archive', { status: 413 });
      }
    } catch {
      // 单文件失败跳过
      dataByEntry.set(entry, null);
    }
  }

  const encoder = new TextEncoder();
  const date = new Date();
  const dosTime = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xffff;
  const dosDay = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;

  const localSizes = entries.map((entry) => {
    const nameLen = encoder.encode(entry.name).length;
    const data = entry.folder ? new Uint8Array(0) : (dataByEntry.get(entry) ?? new Uint8Array(0));
    const crc = entry.folder ? 0 : crc32(data);
    return { entry, nameLen, data, crc, headerLen: 30 + nameLen };
  });
  const sizeOf = (item) => item.headerLen + item.data.length;

  const centralLen = localSizes.reduce((sum, item) => sum + 46 + item.nameLen, 0);
  const totalLen = localSizes.reduce((sum, item) => sum + sizeOf(item), 0) + centralLen + 22;

  const buf = new Uint8Array(totalLen);
  const view = new DataView(buf.buffer);
  let cursor = 0;
  const writeU8 = (b) => { buf[cursor++] = b; };
  const writeBytes = (bytes) => {
    buf.set(bytes, cursor);
    cursor += bytes.length;
  };
  const writeU16 = (v) => { view.setUint16(cursor, v, true); cursor += 2; };
  const writeU32 = (v) => { view.setUint32(cursor, v, true); cursor += 4; };

  const localOffsets = [];

  // local file headers + data
  for (const item of localSizes) {
    localOffsets.push(cursor);
    const nameBytes = encoder.encode(item.entry.name);
    writeU32(0x04034b50);
    writeU16(20); // version needed
    writeU16(0); // flags
    writeU16(0); // method: stored
    writeU16(dosTime);
    writeU16(dosDay);
    writeU32(item.crc);
    writeU32(item.data.length);
    writeU32(item.data.length);
    writeU16(nameBytes.length);
    writeU16(0); // extra
    writeBytes(nameBytes);
    writeBytes(item.data);
  }

  // central directory
  localSizes.forEach((item, i) => {
    const nameBytes = encoder.encode(item.entry.name);
    writeU32(0x02014b50);
    writeU16(20); // version made by
    writeU16(20); // version needed
    writeU16(0); // flags
    writeU16(0); // method
    writeU16(dosTime);
    writeU16(dosDay);
    writeU32(item.crc);
    writeU32(item.data.length);
    writeU32(item.data.length);
    writeU16(nameBytes.length);
    writeU16(0); // extra
    writeU16(0); // comment
    writeU16(0); // disk
    writeU16(0); // internal attrs
    writeU32(item.entry.folder ? 0x10 : 0); // external attrs
    writeU32(localOffsets[i]);
    writeBytes(nameBytes);
  });

  // EOCD
  writeU32(0x06054b50);
  writeU16(0); // disk
  writeU16(0); // cd disk
  writeU16(localSizes.length);
  writeU16(localSizes.length);
  writeU32(centralLen);
  writeU32(localOffsets[0] ?? 0);
  writeU16(0); // comment len

  const zipName = `${folderName}.zip`;
  return new Response(buf, {
    status: 200,
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(zipName)}`,
      'cache-control': 'no-store',
    },
  });
}
