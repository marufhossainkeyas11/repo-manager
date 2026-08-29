// Repo registry: lets the app manage multiple GitHub repos at runtime,
// stored in the CONFIG KV namespace under a single key. If that key
// doesn't exist yet (fresh deploy, or CONFIG binding missing), we
// fall back to building the same shape from the legacy env vars
// (GITHUB_OWNER/GITHUB_REPO/GITHUB_BRANCH) so existing deployments
// keep working unmodified.

const REGISTRY_KEY = "repos";

function repoId(owner, repo) {
  return `${owner}/${repo}`;
}

function fallbackRegistry(env) {
  const owner = env.GITHUB_OWNER;
  const repo = env.GITHUB_REPO;
  const branch = env.GITHUB_BRANCH || "main";
  const active = owner && repo ? { owner, repo, branch } : null;
  return {
    active,
    list: active
      ? [
          {
            id: repoId(owner, repo),
            owner,
            repo,
            branch,
            private: undefined,
            addedAt: null,
            lastUsedAt: null,
          },
        ]
      : [],
    showRepoOnLogin: true,
  };
}

// Reads the full registry ({active, list, showRepoOnLogin}) from KV,
// falling back to the env-var-derived shape if CONFIG is missing or
// the key hasn't been written yet.
export async function getRepoRegistry(env) {
  if (!env.CONFIG) return fallbackRegistry(env);
  const raw = await env.CONFIG.get(REGISTRY_KEY);
  if (!raw) return fallbackRegistry(env);
  try {
    const parsed = JSON.parse(raw);
    // Defensive defaults in case of partial/older data.
    return {
      active: parsed.active || null,
      list: Array.isArray(parsed.list) ? parsed.list : [],
      showRepoOnLogin: parsed.showRepoOnLogin !== false,
    };
  } catch {
    return fallbackRegistry(env);
  }
}

// Convenience: just the active {owner, repo, branch}. Throws if none
// is configured at all (no KV entry and no env vars) so callers get a
// clear error instead of undefined owner/repo propagating into GitHub
// API calls.
export async function getActiveRepo(env) {
  const registry = await getRepoRegistry(env);
  if (!registry.active || !registry.active.owner || !registry.active.repo) {
    throw new Error(
      "No active repository configured. Add one in Settings, or set GITHUB_OWNER/GITHUB_REPO in wrangler.jsonc."
    );
  }
  return {
    owner: registry.active.owner,
    repo: registry.active.repo,
    branch: registry.active.branch || "main",
  };
}

export async function saveRepoRegistry(env, registry) {
  if (!env.CONFIG) {
    throw new Error("CONFIG KV namespace is not bound. Add it to wrangler.jsonc to enable multi-repo.");
  }
  const toSave = {
    active: registry.active || null,
    list: Array.isArray(registry.list) ? registry.list : [],
    showRepoOnLogin: registry.showRepoOnLogin !== false,
  };
  await env.CONFIG.put(REGISTRY_KEY, JSON.stringify(toSave));
  return toSave;
}

export { repoId };
