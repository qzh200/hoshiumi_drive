# Hoshiumi 云盘

一个**只读**的个人 WebDAV 浏览站，挂在 Cloudflare Pages + Functions 上。
视觉风格与博客（[astro-koharu](https://blog.hoshiumi.xyz)）保持一致：极光渐变底 + 玻璃质感卡片 + 圆角主题色。

> 在线地址：<https://drive.hoshiumi.xyz>

## 一个核心决定：只读

从 v0.3 起，这个项目**砍掉了所有写操作和身份认证**。没有上传、没有重命名、没有删除、没有登录。
后端只做"读"和"必要的元数据拼装"；前端接管所有交互、富体验和打包。

为什么这么做：

- **更少攻击面**。没有鉴权逻辑可破，没有写入可被滥用。
- **更简单**。一份 YAML 管所有非敏感配置，env 只放 WebDAV 密码。
- **URL 即访问控制**。想分享就发链接，不想要就把链接改长。

剩下的事情交给前端做：列表、多选、打包、搜索、预览、流式下载。

## 后端 vs 前端 的分工

| 维度         | 后端（Cloudflare Functions）                  | 前端（Astro + TS）                                    |
| ------------ | -------------------------------------------- | ----------------------------------------------------- |
| 列表         | `GET /api/list/<directory>/`                 | 渲染 + 行交互                                          |
| 下载         | `GET /api/download/<file>`（Range 透传）     | `<a download>`                                         |
| 内联预览     | `GET /api/preview/<file>`（Range 透传）      | 媒体 / 代码 / Markdown / 图片灯箱                      |
| 文件夹打包   | （**无**）                                   | `client-zip` 流式打包 → StreamSaver 浏览器原生下载      |
| 多选 / 搜索  | —                                            | checkbox + 浮动操作栏；客户端递归索引                  |
| 身份认证     | —                                            | 无                                                     |
| 写操作       | —                                            | 无                                                     |

## API

只有 3 个端点，都不需要任何鉴权，路径直接放在 URL 段里（百分号编码）：

| 方法 | 路径                     | 说明                                                       |
| ---- | ------------------------ | ---------------------------------------------------------- |
| GET  | `/api/list/<directory>/` | 列文件 / 文件夹                                            |
| GET  | `/api/download/<file>`   | 强制下载（`Content-Disposition: attachment`，支持 Range）  |
| GET  | `/api/preview/<file>`    | 内联预览（媒体 / 文本 / 代码 / Markdown / Office / 压缩包，支持 Range） |

旧版本的 `/api/auth/*` / `/api/folder` / `/api/archive` / `/api/files` 已经彻底删掉，
现在它们只会返回 Pages 的 SPA fallback（HTML），不再有 JSON 业务响应。

## 本地运行

```powershell
pnpm install
Copy-Item .dev.vars.example .dev.vars
# 编辑 .dev.vars，填入 WEBDAV_USERNAME / WEBDAV_PASSWORD
pnpm dev
```

打开 <http://127.0.0.1:8788/> 即可。

> `pnpm dev` 会自动跑 `config:build`（把 `config/storage.yaml` 编译成
> `functions/_config.generated.json`）和 `streamsaver:sync`（把 StreamSaver 的
> `sw.js` / `mitm.html` 同步到 `public/streamsaver/`）。
>
> 改了 `config/*.yaml` 或 `src/**/*` 后：先 `pnpm build`，再 `pnpm dev`。

## 部署

```powershell
# 1. Cloudflare Dashboard 建好项目（如果还没有）
# 2. 写远程 secret（一次性）
pnpm exec wrangler pages secret put WEBDAV_USERNAME
pnpm exec wrangler pages secret put WEBDAV_PASSWORD
# 3. 部署
pnpm deploy
```

`pnpm deploy` = `pnpm build` + `wrangler pages deploy dist`。Pages 自动编译仓库根的
`functions/`，并服务 `dist/` 里的静态资源。

> 之前版本的 `DRIVE_MASTER_KEY` 已经废弃。重构后整个项目无认证，Dashboard 上残留的旧
> secret 可以安全删除。

## 配置

| 文件                      | 谁读                         | 内容                                       |
| ------------------------- | ---------------------------- | ------------------------------------------ |
| `config/site.yaml`        | Astro 构建期（前端主题、SEO）| 颜色、品牌、页脚、SEO、背景、动画          |
| `config/storage.yaml`     | Functions 运行时（后端）     | WebDAV 端点、请求超时（**没有** auth/upload） |
| `.dev.vars`（git ignore） | 本地 dev / wrangler          | `WEBDAV_USERNAME`、`WEBDAV_PASSWORD`       |
| `wrangler.jsonc`          | wrangler / Cloudflare        | Pages 部署目录（**没有** D1 binding）      |

`config/storage.yaml` 字段在 `src/config/storage-schema.ts` 里用 zod 校验。env 永远覆盖
yaml —— WebDAV 密码只能放 env。

## 前端几个值得聊的功能

### 多选 + 打包选中

每行最左一个 checkbox；选中 ≥ 1 项时屏幕底部出现一个玻璃药丸（操作栏），显示「已选 N 项」，
提供「全选当前目录 / 打包选中 / 清除」三个动作。切目录时自动清空选择（多选是当前目录的
上下文）。

打包用 **StreamSaver 流式下载**：递归 `collectFiles`（只发 PROPFIND，不占大内存）→
限并发预取（`ZIP_FETCH_CONCURRENCY=3`）→ `async function*` 按原顺序把 Response 喂给
`downloadZip()` → 把 zip 的 `Response.body` `pipeTo` 到 StreamSaver。**内存只占当前
chunk，50 GB 文件夹也不会 OOM**。

不支持 Service Worker / 非 https 的浏览器自动回退到 `.blob()` + `<a download>`。

工具栏可以切「SW 下载 / Blob 下载」，选择存 `localStorage`（`drive.downloadMode`），
刷新后仍然生效。

### 搜索

工具栏右侧的搜索按钮打开 dialog。**首次输入触发全量索引构建**：递归从根目录走完所有
子目录，缓存在 `Map<key, IndexEntry>` 里，个人量级下 < 1s 完成。

后续输入 200ms debounce，匹配按文件名子串（不区分大小写），结果按「文件夹优先 →
`zh-Hans-CN` locale 排序」展示，最多 200 条，命中片段用 `<mark>` 高亮。

点结果：文件夹直接进入；文件跳到父目录 + 250ms 后自动打开预览。

索引生命周期 = 当前页面会话，刷新即重建。体量小，不是问题。

### 预览

- **图片**：同目录多张进入灯箱模式，键盘 ←/→ 切换
- **代码**：按扩展名映射到 highlight.js + atom-one-dark 主题；未知语言走 `highlightAuto`
- **Markdown**：marked 渲染，自带样式（标题 / 代码 / 引用 / 表格 / 列表）
- **元数据**：底部显示 `大小 · 修改时间`
- **Range 透传**：视频 / 音频可拖进度条（前提是上游 WebDAV 支持 Range；不支持的服务如
  `pan.moe` 会回退到全文 + 200）

按类型分档上限（不再一刀切 200MB）：

| 类型           | 上限              |
| -------------- | ----------------- |
| 视频 / 音频    | 不设总大小上限（流式） |
| PDF            | 1 GB（pdfium Range 分块） |
| 图片           | 100 MB            |
| 压缩包         | 200 MB            |
| Office         | 30 MB             |
| 文本 / 代码    | 2 MB（前端）/ 4 MB（后端） |

## 字体

`public/fonts/` 放了博客（astro-koharu）用到的两份 cn-font-split 子集：

- **寒蝉全圆体**（ChillRoundF）：圆润标题
- **源柔ゴシック P**（GenJyuuGothic-P）：日文 / 等宽正文

每个 family 都有 Regular / Bold，按 `unicode-range` 分片，浏览器只下载用到的子集。

## 项目结构

```
hoshiumi_drive/
├── config/
│   ├── site.yaml            # 前端主题 / 品牌
│   └── storage.yaml         # 后端非敏感配置（不含 auth / upload）
├── src/
│   ├── config/              # zod schema + loader
│   ├── components/          # Background / ThemeToggle / Footer / DriveApp
│   ├── layouts/Layout.astro
│   ├── pages/index.astro
│   ├── scripts/app.ts       # 列表 + 多选 + 预览 + 搜索 + 客户端打包（StreamSaver）
│   └── styles/global.css    # 主题 token + 玻璃卡片 + preview/search/actionbar
├── functions/
│   ├── _config.js           # 后端运行时配置加载（env 优先 + YAML 默认）
│   ├── _lib.js              # JSON 响应、路径清洗
│   ├── _storage.js          # WebDAV 驱动（list + get 含 Range 透传）
│   └── api/
│       ├── list.js
│       ├── download.js
│       └── preview.js
├── public/
│   ├── fonts/               # cn-font-split 子集
│   └── streamsaver/         # sw.js + mitm.html（build 前自动同步）
├── scripts/
│   ├── build-storage-config.mjs   # yaml → functions/_config.generated.json
│   ├── sync-streamsaver.mjs       # node_modules/streamsaver → public/streamsaver
│   ├── postbuild.mjs              # 写入 dist/_headers（含 streamsaver no-cache）
│   └── smoke.mjs                  # 本地冒烟脚本
├── wrangler.jsonc
└── astro.config.mjs
```

## 冒烟测试

`pnpm dev` 启动后，另一个终端跑：

```powershell
node scripts/smoke.mjs
```

覆盖：HTML / 列表（BFS 找样本） / 下载（带 attachment 头 + UTF-8 文件名） / 预览
（无 attachment） / 非法 prefix 被拒 / 旧端点确认已删（返回 HTML 而非 JSON）。

## 一些备注

- **WebDAV 凭据变更**：`wrangler pages secret put WEBDAV_PASSWORD` 覆盖即可；本地
  改 `.dev.vars` 即可。
- **Astro 是 `output: 'static'`**：所有页面在 build 期渲染成纯 HTML，Functions 处理
  动态 API。
- **Range 透传**：上游 WebDAV 必须支持 `206 Partial Content`，不支持的会回退到
  全文 + 200。
- **StreamSaver 不是纯 JS 库**：需要同源托管 `sw.js` 和 `mitm.html` 两个文件。
  `scripts/sync-streamsaver.mjs` 在 `prebuild` / `predev` 时从 `node_modules` 同步到
  `public/`，并镜像到 `dist/`；`scripts/postbuild.mjs` 给它们写 `Cache-Control: no-cache`，
  避免 SW 更新被静态缓存卡住。
