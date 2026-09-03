function root(env) {
  const endpoint = env.WEBDAV_ENDPOINT;
  if (env.STORAGE_DRIVER !== "webdav" || !endpoint || !env.WEBDAV_USERNAME || !env.WEBDAV_PASSWORD) throw new Error("WebDAV storage is not configured");
  return endpoint.replace(/\/+$/, "") + "/";
}

function url(env, path = "") { return new URL(path.split("/").map(encodeURIComponent).join("/"), root(env)).toString(); }
function auth(env) { return `Basic ${btoa(`${env.WEBDAV_USERNAME}:${env.WEBDAV_PASSWORD}`)}`; }

async function call(env, path, init = {}) {
  const response = await fetch(url(env, path), { ...init, headers: { Authorization: auth(env), ...init.headers } });
  return response;
}

function decodeHref(env, href) {
  try {
    const pathname = decodeURIComponent(new URL(href, "https://drive.invalid").pathname);
    const basePath = new URL(root(env)).pathname.replace(/\/$/, "");
    return pathname.slice(pathname.startsWith(basePath) ? basePath.length : 0).replace(/^\/+|\/+$/g, "");
  } catch { return ""; }
}

function xmlValue(xml, tag) { return xml.match(new RegExp(`<[^>]*${tag}[^>]*>([\\s\\S]*?)<\\/[^>]*${tag}>`, "i"))?.[1]?.trim(); }

export async function list(env, prefix = "") {
  const response = await call(env, prefix, { method: "PROPFIND", headers: { Depth: "1", "Content-Type": "application/xml" } });
  if (!response.ok && response.status !== 207) throw new Error(`WebDAV list failed (${response.status})`);
  const document = await response.text();
  const responses = document.match(/<[^>]*response[ >][\s\S]*?<\/[^>]*response>/gi) || [];
  const folders = []; const files = [];
  for (const item of responses) {
    const key = decodeHref(env, xmlValue(item, "href") || "");
    if (!key || key === prefix.replace(/\/$/, "")) continue;
    const name = key.split("/").pop();
    const folder = /<[^>]*collection\s*\/?\s*>/i.test(item);
    const size = Number(xmlValue(item, "getcontentlength") || 0);
    const uploaded = xmlValue(item, "getlastmodified");
    (folder ? folders : files).push({ key: folder ? `${key}/` : key, name, folder, size, uploaded });
  }
  return { folders, files };
}

export async function get(env, path) { return call(env, path); }
export async function put(env, path, body, contentType) { return call(env, path, { method: "PUT", body, headers: { "Content-Type": contentType } }); }
export async function remove(env, path) { return call(env, path, { method: "DELETE" }); }
export async function move(env, from, to) { return call(env, from, { method: "MOVE", headers: { Destination: url(env, to), Overwrite: "F" } }); }
export async function mkdir(env, path) { return call(env, path, { method: "MKCOL" }); }
