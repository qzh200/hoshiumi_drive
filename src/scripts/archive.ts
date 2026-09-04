/**
 * archive.ts —— 压缩包内浏览：列表与面包屑的纯构建（DOM 交互通过回调交给调用方）
 */
import type { ArchiveEntry, ArchiveState } from './types';
import { ICON_FOLDER, fileIcon } from './icons';

/** 列出 archiveState.innerPath 这一层的直接子项（一个层级） */
export function listArchiveEntries(arc: ArchiveState): ArchiveEntry[] {
  const out: ArchiveEntry[] = [];
  arc.zip.forEach((relPath, file) => {
    if (!relPath.startsWith(arc.innerPath)) return;
    const rel = relPath.slice(arc.innerPath.length);
    const parts = rel.split('/').filter((p) => p.length > 0);
    if (parts.length === 0) return; // 自身
    if (parts.length > 1) return; // 更深
    const internal = (file as unknown as { _data?: { uncompressedSize?: number } })._data;
    out.push({
      name: parts[0],
      fullPath: relPath,
      isDir: file.dir,
      size: file.dir ? 0 : (internal?.uncompressedSize ?? 0),
      date: file.date || new Date(0),
    });
  });
  out.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh-Hans-CN');
  });
  return out;
}

/** 构建顶部面包屑：📦 zipName / [seg1] / [seg2]；点击段由 onNavigate(path) 处理 */
export function buildArchiveCrumb(arc: ArchiveState, onNavigate: (innerPath: string) => void): HTMLElement {
  const crumb = document.createElement('div');
  crumb.className = 'drive-preview__archive-crumb';

  const root = document.createElement('button');
  root.type = 'button';
  root.className = 'drive-preview__archive-crumb-seg';
  root.textContent = `📦 ${arc.zipName}`;
  root.title = `返回 ${arc.zipName} 根目录`;
  root.addEventListener('click', () => onNavigate(''));
  crumb.appendChild(root);

  const parts = arc.innerPath.split('/').filter(Boolean);
  let acc = '';
  for (const part of parts) {
    const sep = document.createElement('span');
    sep.className = 'drive-preview__archive-crumb-sep';
    sep.textContent = '/';
    crumb.appendChild(sep);
    acc = `${acc}${part}/`;
    const seg = document.createElement('button');
    seg.type = 'button';
    seg.className = 'drive-preview__archive-crumb-seg';
    seg.textContent = part;
    seg.title = `进入 ${acc}`;
    const target = acc;
    seg.addEventListener('click', () => onNavigate(target));
    crumb.appendChild(seg);
  }
  return crumb;
}

/** ZIP 条目小图标（目录/文件） */
export function archiveItemIcon(entry: ArchiveEntry): string {
  return entry.isDir ? ICON_FOLDER : fileIcon(entry.name);
}
