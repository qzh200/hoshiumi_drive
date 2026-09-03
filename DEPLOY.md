# 部署

1. 创建 D1 数据库：

   ```powershell
   pnpm exec wrangler d1 create hoshiumi-drive
   ```

2. 将返回的 `database_id` 填入 `wrangler.jsonc`。

3. 写入生产密钥。命令会交互式读取值，不会把密码写入 shell 历史或项目文件：

   ```powershell
   pnpm exec wrangler pages secret put DRIVE_MASTER_KEY --project-name=hoshiumi-drive
   pnpm exec wrangler pages secret put WEBDAV_USERNAME --project-name=hoshiumi-drive
   pnpm exec wrangler pages secret put WEBDAV_PASSWORD --project-name=hoshiumi-drive
   ```

4. 应用 D1 migration 并部署：

   ```powershell
   pnpm install
   pnpm run db:migrate:remote
   pnpm run deploy
   ```

`wrangler.jsonc` 已包含 WebDAV 驱动和 `https://pan.moe/dav`。该地址不是 secret；主密钥和 WebDAV 凭据必须仅通过 Pages secrets 设置。
