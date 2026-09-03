import { badRequest, cleanPath } from "../_lib.js";
import { get } from "../_storage.js";
export async function onRequestGet({ request, env }) {
  const key = cleanPath(new URL(request.url).searchParams.get("path"));
  if (!key) return badRequest("Invalid path");
  const object = await get(env, key);
  if (!object.ok) return new Response("Not found", { status: object.status === 404 ? 404 : 502 });
  const headers = new Headers();
  headers.set("content-type", object.headers.get("content-type") || "application/octet-stream");
  headers.set("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(key.split("/").pop())}`);
  return new Response(object.body, { headers });
}
