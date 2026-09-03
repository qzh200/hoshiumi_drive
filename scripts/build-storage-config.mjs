/**
 * 构建脚本：把 config/storage.yaml 编译成 functions/_config.generated.json。
 *
 * 运行时机：
 *   - astro dev / astro build 之前（predev / prebuild 自动触发）
 *   - 也可手动：`pnpm config:build`
 *
 * 输出位置：functions/_config.generated.json
 *   - Functions 用 `import config from './_config.generated.json'` 读取
 *   - 任何 env 同名字段都优先于这里（见 functions/_config.js）
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { StorageConfigSchema } from '../src/config/storage-schema.ts';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');
const yamlPath = resolve(projectRoot, 'config', 'storage.yaml');
const outPath = resolve(projectRoot, 'functions', '_config.generated.json');

const raw = readFileSync(yamlPath, 'utf8');
let parsed;
try {
  parsed = parseYaml(raw);
} catch (error) {
  console.error(`[config] 解析 ${yamlPath} 失败:`, error.message);
  process.exit(1);
}

const result = StorageConfigSchema.safeParse(parsed);
if (!result.success) {
  console.error('[config] 校验失败：');
  for (const issue of result.error.issues) {
    console.error(`  - ${issue.path.join('.') || '(root)'}: ${issue.message}`);
  }
  process.exit(1);
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(result.data, null, 2)}\n`, 'utf8');
console.log(`[config] 已生成 ${outPath}`);
