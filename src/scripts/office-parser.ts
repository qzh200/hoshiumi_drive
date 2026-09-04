/**
 * office-parser.ts —— 浏览器/Node 双端可用的「演示/纯文本文档」内容提取
 *
 * 职责边界（按「优先复用成熟组件」的原则收窄）：
 *   - .docx            → 交给成熟库 mammoth（app.ts 内）
 *   - .xlsx/.xlsm/.xls/.ods → 交给成熟库 SheetJS `xlsx`（app.ts 内）
 *   - .pptx/.odp/.odt  → 本文件兜底（浏览器端没有成熟的文字提取库，
 *     仅做「解 zip + 提 XML 文本节点」的最小工作，已对多份真实/合成文件验证）
 *
 * 说明：
 *   - 纯函数、返回可序列化数据；渲染由调用方用 textContent 构建 DOM，天然防注入。
 *   - 语法保持「可擦除 TS」（无 enum/namespace/参数属性），Node 22 可直接
 *     `node --experimental-strip-types` 加载。
 *
 * 输出：
 *   - kind 'word'   → paragraphs: string[]
 *   - kind 'slides' → slides: { slideName, lines }[]
 *   - warnings: string[]（截断/降级说明）
 */
import JSZip from 'jszip';

export type OfficePreviewKind = 'word' | 'slides';

export interface OfficeSlide {
  slideName: string;
  lines: string[];
}

export interface ParsedOfficeFile {
  kind: OfficePreviewKind;
  slides?: OfficeSlide[];
  paragraphs?: string[];
  warnings: string[];
}

// 展示上限（防止超大文件把页面卡死 / 灌爆 DOM）
const MAX_SLIDES = 120;
const MAX_SLIDE_LINES = 400;
const MAX_PARAGRAPHS = 4000;
const MAX_CHARS = 600_000;

// ---------- 通用小工具 ----------

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h: string) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => safeChar(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function safeChar(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

/** 把含命名空间标签的 XML 片段变成纯文本（结构换行符需事先替换好） */
function stripTags(xml: string): string {
  return xml.replace(/<[^>]*>/g, '');
}

function attrOf(tag: string, name: string): string {
  const re = new RegExp(`${name.replace(/[:]/g, '\\:')}\\s*=\\s*"([^"]*)"`, 'i');
  const m = tag.match(re);
  return m ? m[1] : '';
}

/** 处理 ODF 文本结构标签（tab/换行/连续空格），返回纯文本 */
function odfInlineText(innerXml: string): string {
  let s = innerXml.replace(/<text:tab\b[^>]*\/>/gi, '\t');
  s = s.replace(/<text:line-break\b[^>]*\/>/gi, '\n');
  s = s.replace(/<text:s\b([^>]*)\/>/gi, (_m, attrs: string) => {
    const n = Number(attrOf(attrs, 'text:c') || 1);
    return ' '.repeat(Number.isFinite(n) && n > 0 && n < 64 ? n : 1);
  });
  return decodeEntities(stripTags(s)).trim();
}

/** 忽略命名空间前缀的标签：`row` → `(?:[\w.-]+:)?row`，兼容 <row> 与 <x:row> */
function anyTag(name: string): string {
  return `(?:[\\w.-]+:)?${name}`;
}

/** 统计文本预算并截断 */
function clip(text: string, budget: { left: number }): string {
  if (text.length <= budget.left) {
    budget.left -= text.length;
    return text;
  }
  const part = text.slice(0, budget.left);
  budget.left = 0;
  return part;
}

async function readFileText(zip: JSZip, path: string): Promise<string | null> {
  const file = zip.file(path);
  if (!file) return null;
  const text = await file.async('string');
  return text ?? null;
}

function extOf(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx > 0 ? name.slice(idx + 1).toLowerCase() : '';
}

// ---------- PPTX（OOXML 演示文稿） ----------

async function parsePptx(zip: JSZip, warnings: string[]): Promise<ParsedOfficeFile> {
  const slideFiles = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/i.test(p))
    .sort((a, b) => {
      const na = Number((/slide(\d+)/i.exec(a) || [])[1]);
      const nb = Number((/slide(\d+)/i.exec(b) || [])[1]);
      return na - nb;
    });
  if (slideFiles.length === 0) throw new Error('PPTX 里找不到幻灯片（ppt/slides/slide*.xml）');
  const budget = { left: MAX_CHARS };
  const limited = slideFiles.slice(0, MAX_SLIDES);
  if (slideFiles.length > MAX_SLIDES) warnings.push(`演示文稿有 ${slideFiles.length} 页，仅预览前 ${MAX_SLIDES} 页`);
  const slides: OfficeSlide[] = [];
  for (const [i, path] of limited.entries()) {
    const xml = (await readFileText(zip, path)) || '';
    const lines: string[] = [];
    const pRe = new RegExp(`<${anyTag('p')}\\b[^>]*>([\\s\\S]*?)<\\/${anyTag('p')}>`, 'gi');
    let pm: RegExpExecArray | null;
    while ((pm = pRe.exec(xml)) && lines.length < MAX_SLIDE_LINES) {
      let line = '';
      const tRe = new RegExp(`<${anyTag('t')}\\b[^>]*>([\\s\\S]*?)<\\/${anyTag('t')}>`, 'gi');
      let tmm: RegExpExecArray | null;
      while ((tmm = tRe.exec(pm[1]))) line += tmm[1];
      line = decodeEntities(line).trim();
      if (line) lines.push(clip(line, budget));
    }
    slides.push({ slideName: `幻灯片 ${i + 1}`, lines });
    if (budget.left <= 0) {
      warnings.push('内容过长，已截断');
      break;
    }
  }
  return { kind: 'slides', slides, warnings };
}

// ---------- ODP / ODT（ODF 演示文稿 / 文本文档） ----------

async function parseOdp(zip: JSZip, warnings: string[]): Promise<ParsedOfficeFile> {
  const xml = await readFileText(zip, 'content.xml');
  if (!xml) throw new Error('ODP 缺少 content.xml');
  const budget = { left: MAX_CHARS };
  const slides: OfficeSlide[] = [];
  const pageRe = /<draw:page\b([^>]*)>([\s\S]*?)<\/draw:page>/gi;
  let pm: RegExpExecArray | null;
  let pageCount = 0;
  while ((pm = pageRe.exec(xml)) && pageCount < MAX_SLIDES) {
    pageCount++;
    const name = attrOf(pm[1], 'draw:name') || `幻灯片 ${pageCount}`;
    const lines: string[] = [];
    const textRe = /<text:(?:p|h)\b[^>]*>([\s\S]*?)<\/text:(?:p|h)>/gi;
    let tmm: RegExpExecArray | null;
    while ((tmm = textRe.exec(pm[2])) && lines.length < MAX_SLIDE_LINES) {
      const text = odfInlineText(tmm[1]);
      if (text) lines.push(clip(text, budget));
    }
    slides.push({ slideName: name, lines });
    if (budget.left <= 0) {
      warnings.push('内容过长，已截断');
      break;
    }
  }
  if (pageCount > MAX_SLIDES) warnings.push(`演示文稿页数较多，仅预览前 ${MAX_SLIDES} 页`);
  if (slides.length === 0) throw new Error('ODP 内容解析为空');
  return { kind: 'slides', slides, warnings };
}

async function parseOdt(zip: JSZip, warnings: string[]): Promise<ParsedOfficeFile> {
  const xml = await readFileText(zip, 'content.xml');
  if (!xml) throw new Error('ODT 缺少 content.xml');
  const budget = { left: MAX_CHARS };
  const paragraphs: string[] = [];
  // 按文档顺序提取标题(h)与正文段落(p)，标题按层级加 # 前缀（渲染端再转成标题）
  const blockRe = /<text:(h|p)\b([^>]*)>([\s\S]*?)<\/text:\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(xml)) && paragraphs.length < MAX_PARAGRAPHS) {
    const kind = m[1].toLowerCase();
    const attrs = m[2] ?? '';
    let text = odfInlineText(m[3] ?? '');
    if (kind === 'h') {
      const level = Number(attrOf(attrs, 'text:outline-level') || 1);
      text = `${'#'.repeat(Math.max(1, Math.min(6, level)))} ${text}`;
    }
    if (text) paragraphs.push(clip(text, budget));
    if (budget.left <= 0) {
      warnings.push('内容过长，已截断');
      break;
    }
  }
  if (paragraphs.length === 0) throw new Error('ODT 正文为空或无法读取');
  return { kind: 'word', paragraphs, warnings };
}

// ---------- 入口 ----------

const LEGACY_MSG = '旧版二进制格式暂不支持在线预览，请使用右上角「下载」后用 WPS / Office 打开。';

/**
 * 解析 Office 演示/文本文件内容（pptx/odp/odt）。
 * @param fileName 文件名（用扩展名分派）
 * @param buffer   文件原始字节
 * @throws 格式非法 / 老版二进制（doc/ppt/xls 等）时抛带说明的 Error
 */
export async function parseOfficeFile(fileName: string, buffer: ArrayBuffer): Promise<ParsedOfficeFile> {
  const ext = extOf(fileName);
  const warnings: string[] = [];

  if (ext === 'doc' || ext === 'ppt' || ext === 'xls') {
    throw new Error(LEGACY_MSG);
  }
  if (!['pptx', 'odp', 'odt'].includes(ext)) {
    throw new Error(`暂不支持预览 .${ext || '(无后缀)'} 类型，请使用下载。`);
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`文件解析失败（可能已损坏或不是标准 ${ext.toUpperCase()}）：${detail}`);
  }

  if (ext === 'pptx') return parsePptx(zip, warnings);
  if (ext === 'odp') return parseOdp(zip, warnings);
  return parseOdt(zip, warnings);
}
