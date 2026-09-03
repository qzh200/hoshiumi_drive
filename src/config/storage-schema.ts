import { z } from 'zod';

/**
 * 后端非敏感配置 schema（只读版）
 *
 * 设计原则：
 *   - 这里是「公开可提交」的配置；任何出现在这里的内容都会随仓库分发。
 *   - 真正敏感的字段（WebDAV 密码）保留在 .dev.vars / wrangler secret 里。
 *   - YAML 中留空的字段意味着「从 env 拿」或「不限制」。
 *
 * 重构后去掉了 auth 段（无登录）和 upload.maxFileSize（无上传）。
 */

const NonNegativeIntOrNull = z
  .union([z.string(), z.number()])
  .transform((value) => {
    if (typeof value === 'number') return value > 0 ? value : null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    const num = Number(trimmed);
    return Number.isFinite(num) && num > 0 ? num : null;
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
  requestTimeoutMs: NonNegativeIntOrNull.nullable().default(30000),
});

export const StorageConfigSchema = z.object({
  storage: StorageSchema,
});

export type StorageConfig = z.infer<typeof StorageConfigSchema>;
export type WebDavConfig = z.infer<typeof WebDavSchema>;
