// _middleware.js —— Pages Functions 全局中间件
//
// 唯一职责：保证 sessions 表存在（CREATE IF NOT EXISTS，幂等）。
// 这样本地 dev / 远程 deploy 都不需要先单独跑 `wrangler d1 execute`。
//
// 仅针对需要 sessions 的路径做一次表检查；其他静态资源由 Pages 自动处理，
// 不会进 Worker，所以这里也就不会跑（省 D1 调用）。
const CREATE_TABLE =
  'CREATE TABLE IF NOT EXISTS sessions (' +
  '  id TEXT PRIMARY KEY,' +
  '  expires_at INTEGER NOT NULL,' +
  '  created_at INTEGER NOT NULL' +
  ')';
const CREATE_INDEX =
  'CREATE INDEX IF NOT EXISTS sessions_expires_at ON sessions(expires_at)';

const SESSION_PATH_RE = /^\/api\/auth\/(login|logout|session)\b/;

export async function onRequest(context) {
  if (SESSION_PATH_RE.test(new URL(context.request.url).pathname)) {
    try {
      await context.env.DB.prepare(CREATE_TABLE).run();
      await context.env.DB.prepare(CREATE_INDEX).run();
    } catch (error) {
      // "table already exists" 这种是 race condition，可忽略
      if (!/already exists/i.test(String(error?.message ?? ''))) {
        console.error('[middleware] ensure schema failed:', error);
      }
    }
  }
  return context.next();
}
