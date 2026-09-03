# WebDAV configuration

This project uses the WebDAV driver only. There are no share-link routes or share tokens.

`wrangler.jsonc` contains the non-secret driver settings:

```jsonc
"vars": {
  "STORAGE_DRIVER": "webdav",
  "WEBDAV_ENDPOINT": "https://pan.moe/dav"
}
```

Create `.dev.vars` from `.dev.vars.example` for local development. Do not commit it.

For Cloudflare Pages, set these three values as encrypted secrets:

```powershell
pnpm exec wrangler pages secret put DRIVE_MASTER_KEY --project-name=hoshiumi-drive
pnpm exec wrangler pages secret put WEBDAV_USERNAME --project-name=hoshiumi-drive
pnpm exec wrangler pages secret put WEBDAV_PASSWORD --project-name=hoshiumi-drive
```

Use the supplied MoePan username and password when prompted for the two WebDAV secrets. Use a separate, long random value for `DRIVE_MASTER_KEY`; it is the key that grants write access in the drive UI.

Then create the D1 database, copy its `database_id` into `wrangler.jsonc`, and apply the migration:

```powershell
pnpm install
pnpm exec wrangler d1 create hoshiumi-drive
pnpm run db:migrate:remote
pnpm run deploy
```

Anonymous visitors can list folders and download files. The login session is an HttpOnly, Secure, SameSite=Strict cookie with a seven-day lifetime. File creation, upload, rename, and deletion are checked again by the Pages Functions, not merely hidden in the browser.
