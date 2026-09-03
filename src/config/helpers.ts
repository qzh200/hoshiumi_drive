import type { SiteConfig } from './schema.ts';

/**
 * 编译主题：把 theme.* / card.* 字段转成 CSS 变量串，
 * Layout.astro 会把它写进 <style> 头部。
 */
export function buildThemeStyle(cfg: SiteConfig): string {
  const { theme } = cfg;
  const { card } = theme;
  const light = theme.light;
  const dark = theme.dark;

  return [
    ':root{',
    `--color-bg:${light.background};`,
    `--color-primary:${light.primary};`,
    `--color-secondary:${light.secondary};`,
    `--color-accent:${light.accent};`,
    `--gradient-start:${light.gradientStart};`,
    `--gradient-end:${light.gradientEnd};`,
    `--card-radius:${card.radius};`,
    `--card-blur:${card.blur};`,
    `--card-border-opacity:${card.borderOpacity};`,
    `--card-bg-opacity:${card.bgOpacity};`,
    '}',
    ":root[data-theme='dark']{",
    `--color-bg:${dark.background};`,
    `--color-primary:${dark.primary};`,
    `--color-secondary:${dark.secondary};`,
    `--color-accent:${dark.accent};`,
    `--gradient-start:${dark.gradientStart};`,
    `--gradient-end:${dark.gradientEnd};`,
    '}',
  ].join('');
}

/** 构造 OG / canonical 用的 URL */
export function absoluteUrl(cfg: SiteConfig, path: string): string {
  const base = cfg.site.url;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

export function ogImageUrl(cfg: SiteConfig): string {
  return absoluteUrl(cfg, cfg.seo.openGraph.image || cfg.site.defaultOgImage);
}

/** 把 footer.copyright 里的 {year} 展开 */
export function renderCopyright(cfg: SiteConfig, startYear: number, now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  return cfg.footer.copyright.replace('{year}', year > startYear ? `${startYear}–${year}` : `${year}`);
}
