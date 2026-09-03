import { json, sessionCookie } from "../../_lib.js";

export async function onRequestPost({ request, env }) {
  const id = request.headers.get("Cookie")?.match(/(?:^|;\s*)drive_session=([a-f0-9-]{36})/)?.[1];
  if (id) await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
  return json({ authenticated: false }, 200, { "Set-Cookie": sessionCookie("", request, 0) });
}
