# Hoshiumi Drive

一个**只读**的个人 WebDAV 浏览站，挂在 Cloudflare Pages + Functions 上。仿博客
（[astro-koharu](https://blog.hoshiumi.xyz)）的视觉语言：渐变极光底 + 玻璃质感
卡片 + 圆角主题色。

## 设计原则（v0.3 之后的形态）

后端只做**只读代理 + 必要的元数据**——所有写操作（上传/重命名/删除/新建文件夹）和
身份认证都从仓库里**彻底删掉**。前端接管所有交互、富体验和打包。

| 维度 | 后端（Cloudflare Functions） | 前端（Astro + TS） |
| --- | --- | --- |
| 列表 | `GET /api/list?prefix=...` | 渲染 + 行交互 |
| 单文件下载 | `GET /api/download?path=...`（Range 透传） | `<a download>` |
| 内联预览 | `GET /api/preview?path=...`（Range 透传） | 媒体 / 代码高亮 / Markdown 渲染 / 图片灯箱 |
| 文件夹打包 | （**无**服务端 zip） | `client-zip` 流式打包，浏览器落盘 |
| 多选 | — | checkbox + 浮动操作栏 + 一键打包选中 |
| 全文搜索 | — | 客户端递归索引（首次使用时构建，缓存在内存） |
| 身份认证 | — | 无（URL 本身是访问控制） |
| 写操作 | — | 无 |

## 本地运行

```powershell
pnpm install
Copy-Item .dev.vars.example .dev.vars
# 编辑 .dev.vars，填入 WEBDAV_USERNAME / WEBDAV_PASSWORD
pnpm dev
```

打开 http://127.0.0.1:8788/ 就能用。

> `pnpm dev` 会自动跑 `config:build`（把 `config/storage.yaml` 编译成
> `functions/_config.generated.json`），如果还没 build 就先 build 一次。
>
> 改了 `config/*.yaml` 或 `src/**/*` 后：`pnpm build` → 重新 `pnpm dev` 即可。

## 部署

```powershell
# 1. 在 Cloudflare Dashboard 建好项目（如果还没有）；用 wrangler.jsonc 里的 pages_build_output_dir = ./dist
# 2. 写远程 secret（一次性）
pnpm exec wrangler pages secret put WEBDAV_USERNAME
pnpm exec wrangler pages secret put WEBDAV_PASSWORD
# 3. 部署
pnpm deploy
```

`pnpm deploy` = `pnpm build` + `wrangler pages deploy dist`。Cloudflare Pages 会
自动编译仓库根的 `functions/`，同时服务 `dist/` 里的静态资源。

> 之前版本的 `DRIVE_MASTER_KEY`（主密钥）已废弃——重构后整个项目无认证。如果旧的
> secret 还留在 Dashboard 上，可以安全删除。

## 配置

| 文件                       | 谁读                          | 内容                                       |
| -------------------------- | ----------------------------- | ------------------------------------------ |
| `config/site.yaml`         | Astro 构建期（前端主题、SEO） | 颜色、品牌、页脚、SEO、背景、动画          |
| `config/storage.yaml`      | Functions 运行时（后端）      | WebDAV 端点、请求超时（不再有 auth / upload） |
| `.dev.vars`（git ignore）  | 本地 dev / wrangler           | `WEBDAV_USERNAME`、`WEBDAV_PASSWORD` |
| `wrangler.jsonc`           | wrangler / Cloudflare         | Pages 部署目录（**不再有 D1 binding**） |

`config/storage.yaml` 字段在 `src/config/storage-schema.ts` 里 zod 校验。
非敏感项（WebDAV endpoint、超时）可以写进 yaml；真正敏感的凭据（WebDAV 密码）只能
在 env 里，env 永远覆盖 yaml。

## API

| Method | Path                       | Auth | 说明                              |
| ------ | -------------------------- | ---- | --------------------------------- |
| GET    | `/api/list?prefix=`        | 否   | 列文件/文件夹                      |
| GET    | `/api/download?path=`      | 否   | 强制下载（支持 Range 透传）        |
| GET    | `/api/preview?path=`       | 否   | 内联预览（图片/PDF/音视频/文本/代码/Markdown，支持 Range 透传） |

所有端点都不需要任何认证。任何写在仓库根 `functions/api/` 下的 JS 都会被 Cloudflare
Pages 自动编译；目前**只剩 3 个端点**。

## 目录结构

```
hoshiumi_drive/
├── config/
│   ├── site.yaml            # 前端主题/品牌
│   └── storage.yaml         # 后端非敏感配置（不含 auth、不含 upload）
├── src/
│   ├── config/              # zod schema + loader
│   ├── components/          # Background / ThemeToggle / Footer / DriveApp
│   ├── layouts/Layout.astro
│   ├── pages/index.astro
│   ├── scripts/app.ts       # 列表 + 多选 + 预览 + 搜索 + 客户端打包
│   └── styles/global.css    # 主题 token + 玻璃卡片 + preview/search/actionbar
├── functions/
│   ├── _config.js           # 后端运行时配置加载（env 优先 + YAML 默认）
│   ├── _lib.js              # JSON 响应、路径清洗
│   ├── _storage.js          # WebDAV 驱动（list + get 含 Range 透传）
│   └── api/
│       ├── list.js          # 列目录
│       ├── download.js      # 单文件下载（Range 透传）
│       └── preview.js       # 内联预览（Range 透传 + 大小限制）
├── public/
│   └── fonts/               # cn-font-split 子集（寒蝉全圆体 + 源柔ゴシック）
├── scripts/
│   ├── build-storage-config.mjs   # yaml → functions/_config.generated.json
│   ├── postbuild.mjs              # 写入 dist/_headers
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

## 功能详解

### 多选 + 打包选中

- 每行最左侧有 checkbox，点击不影响主区域。
- 选中 ≥1 项时，屏幕底部中央出现一个玻璃药丸（操作栏），显示「已选 N 项」。
- 操作栏：
  - **全选当前目录**：把当前 `prefix` 下的所有可见项加入选择。
  - **打包选中**：调用 `packSelected()`，递归走完选中的文件夹，把文件按相对路径
    打进 zip，浏览器落盘。文件命名形如 `selection-2026-09-04T07-09-15.zip`。
  - **清除**：清空选择。
- 切目录时自动清空选择（多选是当前目录的上下文）。

### 搜索

- 工具栏右侧的「搜索」按钮打开搜索 dialog。
- 首次输入触发全量索引构建：递归从根目录走完所有子目录，缓存在
  `Map<key, IndexEntry>` 里。个人量级下 < 1s 完成，构建完不再重复走。
- 输入有 200ms debounce，匹配按文件名子串（不区分大小写），结果按「文件夹优先 →
  名字 zh-Hans-CN locale 排序」展示，最多 200 条。
- 命中片段用 `<mark>` 高亮。
- 点结果：
  - 文件夹：直接进入
  - 文件：导航到父目录 + 250ms 后自动打开预览

### 预览增强

- **图片**：同目录多张时进入灯箱模式，预览头显示 `←` / `→`，键盘 ←/→ 切换，
  状态条显示 `当前位置 / 总数`。
- **代码**：按扩展名映射到 highlight.js 语言，引入 atom-one-dark 主题。未知语言
  走 `highlightAuto`。
- **Markdown**：用 marked 渲染，自带样式（标题、代码、引用、表格、列表等）。
- **元数据**：预览底部显示 `大小 · 修改时间`。
- **Range 透传**：视频/音频可拖进度条（前提是上游 WebDAV 支持 Range；部分服务
  器如 `pan.moe` 不支持，会直接返回 200 + 全文）。

### 客户端流式打包

- 入口：`packFolder(folderKey, folderName)` 和 `packSelected()`，都用同一个流式
  模式：
  1. 递归 `collectFiles` 收集所有 `{ key, relPath }`
  2. 同时启动所有 `fetch(/api/download?path=...)`（不 await），把 Promise 放进数组
  3. 用 `async function*` 把 Response 按序喂给 `downloadZip()`
  4. `.blob()` 拿到 zip 内存对象，用 `URL.createObjectURL` 触发浏览器下载
- 进度反馈用 toast：进行中（indeterminate progress）→ 成功/失败。
- **取舍**：全在浏览器内存里跑，超大文件夹（GB 级）会 OOM。当前选择接受这个
  上限，因为 WebDAV 单文件夹 GB 级也少。

## 冒烟测试

`pnpm dev` 启动后，在另一个终端跑：

```powershell
node scripts/smoke.mjs
```

覆盖：HTML / 列表（BFS 找文件样本） / 下载（带 attachment 头 + UTF-8 文件名） /
预览（无 attachment） / 非法 prefix 被拒 / 旧端点（`/api/auth/*`、`/api/folder`、
`/api/archive`、`/api/files`）已被彻底删掉——它们现在返回 Pages 的 SPA fallback
（HTML），不再有 JSON 业务响应。

## 备注

- WebDAV 凭据变更：`wrangler pages secret put WEBDAV_PASSWORD` 覆盖即可；本地
  改 `.dev.vars` 即可。
- Astro 是 `output: 'static'`：所有页面在 build 期渲染成纯 HTML。Functions 处理
  动态 API。
- Range 透传：上游 WebDAV 必须支持 partial content（`206 Partial Content`）。
  不支持的服务会回退到全文 + 200。
- 客户端搜索索引的生命周期是「当前页面会话」——刷新后重建。体量小，不是问题。
