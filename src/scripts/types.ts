/**
 * types.ts —— 全局数据类型（无运行时逻辑）
 */
import type JSZip from 'jszip';

export interface DriveItem {
  key: string;
  name: string;
  folder: boolean;
  size?: number;
  uploaded?: string;
}

export interface DriveListResponse {
  prefix: string;
  folders: DriveItem[];
  files: DriveItem[];
}

export interface IndexEntry {
  key: string;
  name: string;
  folder: boolean;
  parent: string;
  size?: number;
  uploaded?: string;
  /** 索引构建时所在的「根 prefix」，用于面包屑 */
  scopePrefix: string;
}

export type PreviewKind =
  | 'image'
  | 'pdf'
  | 'audio'
  | 'video'
  | 'code'
  | 'markdown'
  | 'docx'
  | 'sheet'
  | 'csv'
  | 'archive'
  | 'text'
  | 'binary'
  | 'unknown';

export interface PreviewState {
  key: string;
  name: string;
  kind: PreviewKind;
  mime: string;
  size?: number;
  uploaded?: string;
  gallery?: { keys: string[]; names: string[]; index: number };
  /** 已有源 URL（通常是 zip 内文件的 blob URL），就用它；否则从 /api/preview/... 拉 */
  sourceUrl?: string;
  /** 预览底部状态条的额外前缀，比如 "ZIP 内文件" */
  sourceLabel?: string;
}

export interface ArchiveEntry {
  name: string;
  fullPath: string;
  isDir: boolean;
  size: number;
  date: Date;
}

export interface ArchiveState {
  zip: JSZip;
  zipKey: string;
  zipName: string;
  /** 当前在 zip 内的路径，以 / 结尾；'' 表示根 */
  innerPath: string;
}
