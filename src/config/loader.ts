import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { SiteConfigSchema, type SiteConfig } from './schema.ts';

let cached: SiteConfig | null = null;

export function getSiteConfig(): SiteConfig {
  if (cached) return cached;
  // 用 process.cwd() 而不是 import.meta.url：
  //   Astro 在 prerender 阶段会把 loader 打 bundle，import.meta.url 会指向
  //   dist/.prerender/chunks/ 里的某个 chunk，相对路径就漂了。
  //   process.cwd() 在构建期与运行期（dev server）都等于项目根，最稳。
  const yamlPath = resolve(process.cwd(), 'config', 'site.yaml');
  if (!existsSync(yamlPath)) {
    throw new Error(`[config] 找不到 ${yamlPath}`);
  }
  const raw = readFileSync(yamlPath, 'utf8');
  const parsed = parseYaml(raw);
  const result = SiteConfigSchema.safeParse(parsed);
  if (!result.success) {
    console.error('[config] site.yaml 校验失败：');
    for (const issue of result.error.issues) {
      console.error(`  - ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    }
    throw new Error('[config] 请修正上述错误后重新构建。');
  }
  cached = result.data;
  return cached;
}
