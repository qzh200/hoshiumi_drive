import { json, matchesMasterKey, sessionCookie, getAuthConfig } from "../../_lib.js";

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid request" }, 400); }
  if (!(await matchesMasterKey(body.key, env.DRIVE_MASTER_KEY))) return json({ error: "Invalid key" }, 401);
  const id = crypto.randomUUID();
  const now = Date.now();
  const { sessionTtlMs } = getAuthConfig(env);
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now).run();
  await env.DB.prepare("INSERT INTO sessions (id, expires_at, created_at) VALUES (?, ?, ?)").bind(id, now + sessionTtlMs, now).run();
  return json({ authenticated: true }, 200, { "Set-Cookie": sessionCookie(id, request, sessionTtlMs) });
}
