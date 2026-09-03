import { badRequest, cleanPath, json, requireAuth } from "../_lib.js";
import * as storage from "../_storage.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const prefix = url.searchParams.get("prefix") || "";
  if (prefix && (!cleanPath(prefix) || !prefix.endsWith("/"))) return badRequest("Invalid prefix");
  try { return json({ prefix, ...(await storage.list(env, prefix)) }); } catch { return json({ error: "Unable to read storage" }, 502); }
}

export async function onRequestPost(context) {
  const denied = await requireAuth(context); if (denied) return denied;
  let form; try { form = await context.request.formData(); } catch { return badRequest("Invalid upload"); }
  const key = cleanPath(form.get("path")); const file = form.get("file");
  if (!key || !(file instanceof File)) return badRequest("A path and file are required");
  const stored = await storage.put(context.env, key, file.stream(), file.type || "application/octet-stream");
  if (!stored.ok) return json({ error: "Upload failed" }, 502);
  return json({ ok: true }, 201);
}

export async function onRequestPatch(context) {
  const denied = await requireAuth(context); if (denied) return denied;
  let body; try { body = await context.request.json(); } catch { return badRequest("Invalid request"); }
  const from = cleanPath(body.from); const to = cleanPath(body.to);
  if (!from || !to) return badRequest("Invalid path");
  const moved = await storage.move(context.env, from, to);
  if (!moved.ok) return json({ error: "Rename failed" }, 502);
  return json({ ok: true });
}

export async function onRequestDelete(context) {
  const denied = await requireAuth(context); if (denied) return denied;
  const key = cleanPath(new URL(context.request.url).searchParams.get("path"));
  if (!key) return badRequest("Invalid path");
  const removed = await storage.remove(context.env, key);
  if (!removed.ok && removed.status !== 404) return json({ error: "Delete failed" }, 502);
  return json({ ok: true });
}
