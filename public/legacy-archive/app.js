let prefix = "";
let authenticated = false;
const $ = (selector) => document.querySelector(selector);
const notice = (message = "") => { $("#notice").textContent = message; };
const displaySize = (size) => size ? `${(size / 1024).toFixed(size > 1024 * 1024 ? 1 : 0)} KB` : "-";

async function api(url, options) {
  const response = await fetch(url, options);
  const data = response.headers.get("content-type")?.includes("application/json") ? await response.json() : {};
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

function render(data) {
  const rows = [...data.folders, ...data.files];
  $("#list").innerHTML = rows.length ? rows.map((item) => `<article class="row"><span>${item.folder ? "▸" : "□"}</span><a class="name" data-key="${encodeURIComponent(item.key)}" data-folder="${item.folder}">${escapeHtml(item.name)}</a><span class="meta">${item.folder ? "文件夹" : displaySize(item.size)}</span><span class="actions">${authenticated && !item.folder ? `<button data-rename="${encodeURIComponent(item.key)}">重命名</button><button data-delete="${encodeURIComponent(item.key)}">删除</button>` : ""}${!item.folder ? `<a href="/api/download?path=${encodeURIComponent(item.key)}"><button>下载</button></a>` : ""}</span></article>`).join("") : '<p class="loading">此目录为空</p>';
  document.querySelectorAll(".name").forEach((el) => el.onclick = () => el.dataset.folder ? open(decodeURIComponent(el.dataset.key)) : location.assign(`/api/download?path=${el.dataset.key}`));
  document.querySelectorAll("[data-delete]").forEach((el) => el.onclick = () => remove(decodeURIComponent(el.dataset.delete)));
  document.querySelectorAll("[data-rename]").forEach((el) => el.onclick = () => rename(decodeURIComponent(el.dataset.rename)));
}
function escapeHtml(value) { const el = document.createElement("span"); el.textContent = value; return el.innerHTML; }
async function load() { notice(); $("#list").innerHTML = '<p class="loading">正在载入文件...</p>'; try { render(await api(`/api/files?prefix=${encodeURIComponent(prefix)}`)); } catch (error) { notice(error.message); } $("#crumb").textContent = prefix || "根目录"; $("#up").disabled = !prefix; }
function open(key) { prefix = key; load(); }
async function remove(key) { if (!confirm(`删除 ${key.split("/").pop()}？`)) return; try { await api(`/api/files?path=${encodeURIComponent(key)}`, { method:"DELETE" }); load(); } catch (e) { notice(e.message); } }
async function rename(key) { const name = prompt("新文件名", key.split("/").pop()); if (!name) return; const destination = `${key.split("/").slice(0,-1).join("/")}${key.includes("/") ? "/" : ""}${name}`; try { await api("/api/files", { method:"PATCH", headers:{"content-type":"application/json"}, body:JSON.stringify({from:key,to:destination}) }); load(); } catch(e) { notice(e.message); } }
async function setup() { authenticated = (await api("/api/auth/session")).authenticated; $("#mode").textContent = authenticated ? "可编辑" : "只读访问"; $("#tools").hidden = !authenticated; $("#login").hidden = authenticated; $("#logout").hidden = !authenticated; load(); }
$("#login").onclick = () => $("#login-dialog").showModal(); $("#cancel").onclick = () => $("#login-dialog").close();
$("#login-form").onsubmit = async (event) => { event.preventDefault(); try { await api("/api/auth/login", {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({key:$("#key").value})}); $("#login-dialog").close(); $("#key").value=""; setup(); } catch(e) { notice(e.message); } };
$("#logout").onclick = async () => { await api("/api/auth/logout", {method:"POST"}); setup(); };
$("#up").onclick = () => { prefix = prefix.replace(/[^/]+\/$/, ""); load(); };
$("#upload").onchange = async (event) => { for (const file of event.target.files) { const form = new FormData(); form.append("path", `${prefix}${file.name}`); form.append("file", file); try { await api("/api/files", {method:"POST",body:form}); } catch(e) { notice(e.message); break; } } event.target.value=""; load(); };
$("#new-folder").onclick = async () => { const name = prompt("文件夹名称"); if (!name) return; try { await api("/api/folder", {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({path:`${prefix}${name}`})}); load(); } catch(e) { notice(e.message); } };
setup().catch((e) => notice(e.message));
