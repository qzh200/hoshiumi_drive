# Hoshiumi Drive

一个轻量的个人云盘，挂在 Cloudflare Pages + WebDAV 上。仿博客
（[astro-koharu](https://blog.hoshiumi.xyz)）的视觉语言：渐变极光底 + 玻璃质感
卡片 + 圆角主题色。配置驱动：颜色、品牌、页脚、SEO 等都在 `config/site.yaml`
里改；后端的 WebDAV / 密钥 / 上传限制等在 `config/storage.yaml` 里改。

## 本地运行

```powershell
pnpm install
Copy-Item .dev.vars.example .dev.vars
# 编辑 .dev.vars，填入 DRIVE_MASTER_KEY、WEBDAV_USERNAME、WEBDAV_PASSWORD
pnpm dev
```

打开 http://127.0.0.1:8788/ 就能用。

> `pnpm dev` 会自动跑 `config:build`（把 `config/storage.yaml` 编译成
> `functions/_config.generated.json`），如果还没 build 就先 build 一次。
>
> 第一次启动时，`functions/_middleware.js` 会自动在本地 D1 里建 `sessions` 表
> （幂等），不需要先跑 `wrangler d1 execute`。
>
> 改了 `config/*.yaml` 或 `src/**/*` 后：`pnpm build` → 重新 `pnpm dev` 即可。

## 部署

```powershell
# 1. 在 Cloudflare Dashboard 建 D1（数据库名 hoshiumi-drive），把 ID 填到 wrangler.jsonc
# 2. 写远程 secret（一次性）
pnpm exec wrangler pages secret put DRIVE_MASTER_KEY
pnpm exec wrangler pages secret put WEBDAV_USERNAME
pnpm exec wrangler pages secret put WEBDAV_PASSWORD
# 3. 部署
pnpm deploy
```

`pnpm deploy` = `pnpm build` + `wrangler pages deploy dist`。Astro 产物里已经
包含 `dist/functions/`（由 `scripts/postbuild.mjs` 复制），Cloudflare 会同时
服务静态文件和 Pages Functions。

## 配置

| 文件                       | 谁读                          | 内容                                       |
| -------------------------- | ----------------------------- | ------------------------------------------ |
| `config/site.yaml`         | Astro 构建期（前端主题、SEO） | 颜色、品牌、页脚、SEO、背景、动画          |
| `config/storage.yaml`      | Functions 运行时（后端）      | WebDAV 端点、会话 TTL、上传限制、超时      |
| `.dev.vars`（git ignore）  | 本地 dev / wrangler           | `DRIVE_MASTER_KEY`、`WEBDAV_USERNAME`、`WEBDAV_PASSWORD` |
| `wrangler.jsonc`           | wrangler / Cloudflare         | Pages 部署目录、D1 binding、observability  |

`config/storage.yaml` 字段在 `src/config/storage-schema.ts` 里 zod 校验。
非敏感项（WebDAV endpoint、会话 TTL、文件大小上限）可以写进 yaml；
真正敏感的凭据（master key、WebDAV 密码）只能在 env 里，env 永远覆盖 yaml。

## API

| Method | Path                       | Auth | 说明                              |
| ------ | -------------------------- | ---- | --------------------------------- |
| GET    | `/api/files?prefix=`       | 否   | 列文件/文件夹（前后端同构）       |
| POST   | `/api/files`               | 是   | 上传（multipart，字段 `path`+`file`） |
| PATCH  | `/api/files`               | 是   | 重命名（body: `{from,to}`）       |
| DELETE | `/api/files?path=`         | 是   | 删除                              |
| POST   | `/api/folder`              | 是   | 新建文件夹（body: `{path}`）      |
| GET    | `/api/download?path=`      | 否   | 强制下载                          |
| GET    | `/api/preview?path=`       | 否   | 内联预览（图片/PDF/音视频/文本）  |
| GET    | `/api/auth/session`        | 否   | 查询当前会话                      |
| POST   | `/api/auth/login`          | 否   | body: `{key}` 登录                |
| POST   | `/api/auth/logout`         | 否   | 登出                              |

## 目录结构

```
hoshiumi_drive/
├── config/
│   ├── site.yaml            # 前端主题/品牌
│   └── storage.yaml         # 后端非敏感配置
├── src/
│   ├── config/              # zod schema + loader
│   ├── components/          # Background / ThemeToggle / Footer / DriveApp
│   ├── layouts/Layout.astro
│   ├── pages/index.astro
│   ├── scripts/app.ts       # 前端逻辑（list/upload/rename/delete + 预览）
│   └── styles/global.css    # 主题 token + 玻璃卡片 + 预览 dialog
├── functions/
│   ├── _config.js           # 后端运行时配置加载（env 优先 + YAML 默认）
│   ├── _lib.js              # 工具：JSON、路径、cookie、会话
│   ├── _middleware.js       # 自动 CREATE sessions 表
│   ├── _storage.js          # WebDAV 驱动
│   ├── api/
│   │   ├── files.js         # list/upload/rename/delete
│   │   ├── folder.js
│   │   ├── download.js
│   │   ├── preview.js
│   │   └── auth/{login,logout,session}.js
├── public/
│   └── fonts/               # cn-font-split 子集（寒蝉全圆体 + 源柔ゴシック）
├── scripts/
│   ├── build-storage-config.mjs   # yaml → functions/_config.generated.json
│   ├── postbuild.mjs              # 复制 functions/ 到 dist/functions/
│   └── smoke.mjs                  # 本地冒烟脚本（需要 dev 已起）
├── wrangler.jsonc
├── astro.config.mjs
└── package.json
```

## 字体

`public/fonts/` 下放了博客（astro-koharu）用到的两份 cn-font-split 子集：

- 寒蝉全圆体（ChillRoundF）：圆润标题字
- 源柔ゴシック P（GenJyuuGothic-P）：日文 / 等宽风格正文

每个 family 都有 Regular / Bold，已按 unicode-range 分片，浏览器只下载用到的
字符子集。`src/styles/global.css` 顶部通过 `@font-face` 引入。

## 冒烟测试

`pnpm dev` 启动后，在另一个终端跑：

```powershell
node scripts/smoke.mjs
```

覆盖：HTML / 错误密码 / 正确密码登录 / session 校验 / 列文件 / 上传 / 重命名 /
删除 / 登出 / 未登录访问受保护端点 / 预览接口（验证无 `attachment` 头）。

## 备注

- 主密钥一旦泄露请立刻换：本地改 `.dev.vars`、生产 `wrangler pages secret put DRIVE_MASTER_KEY` 覆盖。
- D1 数据库 ID 写死在 `wrangler.jsonc` 里，新建项目时记得替换。
- Astro 是 `output: 'static'`：所有页面在 build 期渲染成纯 HTML。Functions 处理
  动态 API。
