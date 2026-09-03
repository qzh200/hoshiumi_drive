import { z } from 'zod';

/**
 * 前端 site.yaml 的 zod schema
 *
 * 设计原则：
 *  - 校验尽量给中文提示，让非前端用户也能直接看懂。
 *  - 任何颜色都接受 hex（#rrggbb / #rgb），自动归一为 #rrggbb。
 *  - 不做语义化默认值（错就是错）；默认值由 schema 的 .default() 兜底。
 */

const HexColor = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const v = value.trim();
    let body = v.startsWith('#') ? v.slice(1) : v;
    if (/^[0-9a-fA-F]{3}$/.test(body)) body = body.split('').map((c) => c + c).join('');
    if (!/^[0-9a-fA-F]{6}$/.test(body)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '颜色必须是 hex（如 #7f9df2 或 #abc）' });
      return z.NEVER;
    }
    return `#${body.toLowerCase()}`;
  });

const NonEmptyString = z.string().trim().min(1);

const Theme = z.object({
  background: HexColor,
  primary: HexColor,
  secondary: HexColor,
  accent: HexColor,
  gradientStart: HexColor,
  gradientEnd: HexColor,
});

const Card = z.object({
  radius: z
    .string()
    .trim()
    .regex(/^\d+(\.\d+)?(px|rem|em)$/, 'card.radius 必须是带单位的数值（如 18px / 1.2rem）'),
  blur: z
    .string()
    .trim()
    .regex(/^\d+(\.\d+)?(px|rem|em)$/, 'card.blur 必须是带单位的数值'),
  borderOpacity: z.number().min(0).max(1),
  bgOpacity: z.number().min(0).max(1),
});

export const SiteConfigSchema = z.object({
  site: z.object({
    title: NonEmptyString,
    alternate: NonEmptyString,
    subtitle: NonEmptyString,
    description: NonEmptyString,
    url: z.string().trim().url().transform((v) => v.replace(/\/+$/, '')),
    language: NonEmptyString,
    timezone: NonEmptyString,
    favicon: z.string().trim().startsWith('/'),
    defaultOgImage: z.string().trim().startsWith('/'),
    keywords: z.array(NonEmptyString).default([]),
  }),
  header: z.object({
    eyebrow: NonEmptyString,
    title: NonEmptyString,
    subtitle: NonEmptyString,
  }),
  theme: z.object({
    default: z.enum(['light', 'dark', 'system']),
    allowSwitch: z.boolean(),
    light: Theme,
    dark: Theme,
    card: Card,
  }),
  background: z.object({
    type: z.enum(['aurora', 'minimal']).default('aurora'),
    stars: z.object({ enabled: z.boolean(), count: z.number().int().min(0).max(200) }),
    glow: z.boolean(),
    noise: z.boolean(),
    gradient: z.boolean(),
  }),
  animation: z.object({
    enabled: z.boolean(),
    entrance: z.boolean(),
    cardHover: z.boolean(),
    backgroundDrift: z.boolean(),
    respectReducedMotion: z.boolean(),
  }),
  footer: z.object({
    enabled: z.boolean(),
    title: NonEmptyString,
    description: NonEmptyString,
    copyright: NonEmptyString,
  }),
  seo: z.object({
    title: NonEmptyString,
    description: NonEmptyString,
    canonical: z.string().trim().url(),
    openGraph: z.object({ enabled: z.boolean(), image: z.string().trim().startsWith('/') }),
    twitter: z.object({ enabled: z.boolean(), card: z.string().trim() }),
  }),
});

export type SiteConfig = z.infer<typeof SiteConfigSchema>;
