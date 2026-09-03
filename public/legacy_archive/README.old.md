# Hoshiumi Drive

一个基于 Cloudflare Pages Functions、D1 session 和 WebDAV 的私有网盘。

- 不提供分享链接、分享 token 或分享密码功能。
- 未登录用户可浏览目录并下载文件。
- 以 `DRIVE_MASTER_KEY` 登录后，可上传、新建目录、重命名和删除。
- 所有写操作在 Pages Function 服务端再次检查 session；前端隐藏按钮不是权限控制。

## 存储配置

驱动已固定为 WebDAV，地址为 `https://pan.moe/dav`。用户名及密码不应出现在仓库中，请作为 Cloudflare Pages secrets 设置。

完整部署步骤见 [CONFIGURATION.md](./CONFIGURATION.md)。

## 本地运行

```powershell
pnpm install
Copy-Item .dev.vars.example .dev.vars
# 编辑 .dev.vars，填入 DRIVE_MASTER_KEY、WEBDAV_USERNAME、WEBDAV_PASSWORD
pnpm run db:migrate:local
pnpm run dev
```

本地开发需要可访问的 WebDAV 服务。生产 HTTPS 环境使用 `Secure` cookie；Wrangler 本地 HTTP 地址会自动使用不带该属性的开发 cookie。
