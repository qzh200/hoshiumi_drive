// _config.js —— 后端运行时配置加载（只读版）
//
// 加载顺序（先低优先级 → 高优先级，后者覆盖前者）：
//   1. functions/_config.generated.json  ← 由 config/storage.yaml 编译生成
//   2. wrangler.jsonc 的 vars
//   3. .dev.vars（本地开发）/ wrangler secret（生产）
//
// 也就是说：YAML 提供默认值，env 永远能覆盖它。
//
// 敏感字段（WEBDAV_USERNAME / WEBDAV_PASSWORD）只能从 env 拿；如果 env 缺失，
// 会在第一次访问时直接抛错，而不是悄悄退回到 YAML 里的空串。
//
// 旧版的 getAuthConfig / getMasterKey 随登录功能一起删了。
import generated from './_config.generated.json';

function readNumber(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function getStorageConfig(env) {
  const generatedStorage = generated?.storage ?? {};
  const generatedWebDav = generatedStorage.webdav ?? {};

  // 端点：env 优先；否则用 YAML 默认
  const endpoint = (env.WEBDAV_ENDPOINT || generatedWebDav.endpoint || '').toString().replace(/\/+$/, '');

  // 凭据：env 优先；只有当 env 完全没有，且 YAML 显式填了非空值时才退回 yaml
  const username = (env.WEBDAV_USERNAME || generatedWebDav.username || '').toString();
  const password = (env.WEBDAV_PASSWORD || generatedWebDav.password || '').toString();

  if (!endpoint) throw new Error('WebDAV endpoint is not configured (set WEBDAV_ENDPOINT env or storage.webdav.endpoint in storage.yaml)');
  if (!username) throw new Error('WebDAV username is not configured (set WEBDAV_USERNAME env)');
  if (!password) throw new Error('WebDAV password is not configured (set WEBDAV_PASSWORD env)');

  // 超时
  const envMax = env.WEBDAV_REQUEST_TIMEOUT_MS ?? env.WEBDAV_TIMEOUT_MS;
  const requestTimeoutMs = readNumber(envMax, readNumber(generatedStorage.requestTimeoutMs, 30000));

  return {
    driver: env.STORAGE_DRIVER || generatedStorage.driver || 'webdav',
    webdav: { endpoint, username, password },
    requestTimeoutMs,
  };
}

export { getStorageConfig };
