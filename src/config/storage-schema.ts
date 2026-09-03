import { z } from 'zod';

/**
 * 后端非敏感配置 schema
 *
 * 设计原则：
 *  - 这里是「公开可提交」的配置；任何出现在这里的内容都会随仓库分发。
 *  - 真正敏感的字段（master key、password）保留在 .dev.vars / wrangler secret 里。
 *  - YAML 中留空的字段意味着「从 env 拿」或「不限制」。
 */

// 把 YAML 字符串或数字归一为「正整数或 null」的预处理：
//   "100"  -> 100
//   ""     -> null
//   0      -> null
//   30     -> 30
const NonNegativeIntOrNull = z
  .union([z.string(), z.number()])
  .transform((value) => {
    if (typeof value === 'number') return value > 0 ? value : null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    const num = Number(trimmed);
    return Number.isFinite(num) && num > 0 ? num : null;
  });

// 同上，但允许 0 表示「不限制」以兼容「填 0 显式关闭」的使用习惯。
const NonNegativeIntAllowZeroOrNull = z
  .union([z.string(), z.number()])
  .transform((value) => {
    if (typeof value === 'number') return value >= 0 ? value : null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    const num = Number(trimmed);
    return Number.isFinite(num) && num >= 0 ? num : null;
  });

const WebDavSchema = z.object({
  endpoint: z
    .string()
    .trim()
    .refine((v) => /^https?:\/\//.test(v), 'storage.webdav.endpoint 必须是以 http(s):// 开头的 URL')
    .transform((v) => v.replace(/\/+$/, '')),
  username: z.string().default(''),
  password: z.string().default(''),
});

const StorageSchema = z.object({
  driver: z.literal('webdav').default('webdav'),
  webdav: WebDavSchema.default({ endpoint: '', username: '', password: '' }),
  upload: z
    .object({
      maxFileSize: NonNegativeIntAllowZeroOrNull.nullable().default(null),
    })
    .default({ maxFileSize: null }),
  requestTimeoutMs: NonNegativeIntOrNull.nullable().default(30000),
});

const AuthSchema = z.object({
  keyLabel: z.string().trim().min(1).default('主密钥'),
  sessionTtlDays: NonNegativeIntOrNull.default(7),
});

export const StorageConfigSchema = z.object({
  storage: StorageSchema,
  auth: AuthSchema,
});

export type StorageConfig = z.infer<typeof StorageConfigSchema>;
export type WebDavConfig = z.infer<typeof WebDavSchema>;
