import { json } from "../lib/json.js";
import { getBlob } from "../lib/github.js";
import { getActiveRepo } from "../lib/config.js";

export async function handleBlob(request, env) {
  const url = new URL(request.url);
  const sha = url.searchParams.get("sha");
  if (!sha) return json({ error: "Missing sha" }, 400);
  const repoCfg = await getActiveRepo(env);
  const blob = await getBlob(env, repoCfg, sha);
  return json(blob);
}
