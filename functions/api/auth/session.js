import { json, isAuthenticated } from "../../_lib.js";
export async function onRequestGet({ request, env }) { return json({ authenticated: await isAuthenticated(request, env) }); }
