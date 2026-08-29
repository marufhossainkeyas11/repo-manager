import { json } from "../lib/json.js";
import { discoverRepos } from "../lib/github.js";

export async function handleReposDiscover(request, env) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q") || "";
  const repos = await discoverRepos(env, q);
  return json(repos);
}
