const encoder = new TextEncoder();
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });
}

export function badRequest(message) { return json({ error: message }, 400); }
export function forbidden() { return json({ error: "Authentication required" }, 401); }

export function cleanPath(value) {
  if (typeof value !== "string") return null;
  const path = value.replace(/^\/+|\/+$/g, "");
  if (!path || path.includes("\\") || path.split("/").some((part) => !part || part === "." || part === ".." || part.includes("\0"))) return null;
  return path;
}

function cookie(request, name) {
  return request.headers.get("Cookie")?.split(";").map((v) => v.trim()).find((v) => v.startsWith(`${name}=`))?.slice(name.length + 1);
}

export async function isAuthenticated(request, env) {
  const id = cookie(request, "drive_session");
  if (!id || !/^[a-f0-9-]{36}$/.test(id)) return false;
  const session = await env.DB.prepare("SELECT id FROM sessions WHERE id = ? AND expires_at > ?").bind(id, Date.now()).first();
  return !!session;
}

export async function requireAuth(context) {
  return (await isAuthenticated(context.request, context.env)) ? null : forbidden();
}

export async function matchesMasterKey(value, expected) {
  if (typeof value !== "string" || !expected) return false;
  const a = encoder.encode(value);
  const b = encoder.encode(expected);
  if (a.length !== b.length) return false;
  return crypto.subtle.timingSafeEqual(a, b);
}

export function sessionCookie(id, request, maxAge = SESSION_TTL_MS / 1000) {
  const secure = new URL(request.url).protocol === "https:" ? " Secure;" : "";
  return `drive_session=${id}; Path=/; HttpOnly;${secure} SameSite=Strict; Max-Age=${maxAge}`;
}

export { SESSION_TTL_MS };
