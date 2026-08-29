import { json } from "../lib/json.js";
import { getRepoInfo } from "../lib/github.js";
import { getRepoRegistry, saveRepoRegistry, repoId } from "../lib/config.js";
import { isValidOwnerOrRepo } from "../validators/paths.js";

export async function handleReposGet(request, env) {
  const registry = await getRepoRegistry(env);
  return json(registry);
}

export async function handleReposPost(request, env) {
  const body = await request.json();
  const owner = (body.owner || "").trim();
  const repo = (body.repo || "").trim();
  if (!owner || !repo) return json({ error: "owner and repo are required" }, 400);
  if (!isValidOwnerOrRepo(owner) || !isValidOwnerOrRepo(repo)) {
    return json({ error: "owner/repo contains invalid characters." }, 400);
  }

  // Verify access (and auto-resolve default branch) by actually
  // hitting GitHub for this repo before we save anything.
  let info;
  try {
    info = await getRepoInfo(env, { owner, repo, branch: body.branch || "main" });
  } catch (err) {
    return json(
      { error: `Could not access ${owner}/${repo}. Check the name and that your token has access. (${String(err.message || err)})` },
      400
    );
  }

  const branch = body.branch || info.default_branch || "main";
  const registry = await getRepoRegistry(env);
  const id = repoId(owner, repo);
  const existingIdx = registry.list.findIndex((r) => r.id === id);
  const entry = {
    id,
    owner,
    repo,
    branch,
    private: Boolean(info.private),
    addedAt: existingIdx >= 0 ? registry.list[existingIdx].addedAt : new Date().toISOString(),
    lastUsedAt: registry.list[existingIdx >= 0 ? existingIdx : -1]?.lastUsedAt || null,
  };
  if (existingIdx >= 0) {
    registry.list[existingIdx] = entry;
  } else {
    registry.list.push(entry);
  }
  // First repo ever added becomes active automatically.
  if (!registry.active) {
    registry.active = { owner, repo, branch };
  }
  const saved = await saveRepoRegistry(env, registry);
  return json(saved);
}

export async function handleReposActivePut(request, env) {
  const body = await request.json();
  const owner = (body.owner || "").trim();
  const repo = (body.repo || "").trim();
  const registry = await getRepoRegistry(env);
  const id = repoId(owner, repo);
  const match = registry.list.find((r) => r.id === id);
  if (!match) return json({ error: "That repo isn't in your list yet." }, 400);
  registry.active = { owner: match.owner, repo: match.repo, branch: match.branch };
  match.lastUsedAt = new Date().toISOString();
  const saved = await saveRepoRegistry(env, registry);
  return json(saved);
}

export async function handleReposDelete(request, env) {
  const url = new URL(request.url);
  const owner = (url.searchParams.get("owner") || "").trim();
  const repo = (url.searchParams.get("repo") || "").trim();
  const registry = await getRepoRegistry(env);
  const id = repoId(owner, repo);
  if (registry.active && repoId(registry.active.owner, registry.active.repo) === id) {
    return json({ error: "Switch to a different repo before removing this one." }, 400);
  }
  registry.list = registry.list.filter((r) => r.id !== id);
  const saved = await saveRepoRegistry(env, registry);
  return json(saved);
}
