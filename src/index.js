import { getTree, commitChanges, getBlob, getRepoInfo, discoverRepos } from "./github.js";
import { getRepoRegistry, getActiveRepo, saveRepoRegistry, repoId } from "./config.js";

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

function isAuthed(request, env) {
  const header = request.headers.get("Authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  return Boolean(token) && Boolean(env.ACCESS_PASSWORD) && token === env.ACCESS_PASSWORD;
}

// --- server-side brute-force protection ---
// Tracks failed auth attempts per client IP in KV and locks that IP out
// with exponential backoff. This is the real protection layer (the
// frontend's own countdown is just UX — it can't stop a script that hits
// this Worker directly). Only active if the RATE_LIMIT KV binding exists,
// so the Worker still runs without it (see README to add the binding).
const MAX_FAILS_BEFORE_LOCK = 5;
const BASE_LOCK_SECONDS = 30;
const MAX_LOCK_SECONDS = 15 * 60;

function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || "unknown";
}

async function getRateState(env, ip) {
  if (!env.RATE_LIMIT) return null;
  const raw = await env.RATE_LIMIT.get(`login:${ip}`);
  return raw ? JSON.parse(raw) : { fails: 0, lockedUntil: 0 };
}

async function setRateState(env, ip, state) {
  if (!env.RATE_LIMIT) return;
  await env.RATE_LIMIT.put(`login:${ip}`, JSON.stringify(state), {
    expirationTtl: MAX_LOCK_SECONDS + 300,
  });
}

async function recordFailedAttempt(env, ip) {
  if (!env.RATE_LIMIT) return;
  const state = (await getRateState(env, ip)) || { fails: 0, lockedUntil: 0 };
  state.fails += 1;
  if (state.fails >= MAX_FAILS_BEFORE_LOCK) {
    const lockSeconds = Math.min(
      BASE_LOCK_SECONDS * 2 ** (state.fails - MAX_FAILS_BEFORE_LOCK),
      MAX_LOCK_SECONDS
    );
    state.lockedUntil = Date.now() + lockSeconds * 1000;
  }
  await setRateState(env, ip, state);
}

async function clearFailedAttempts(env, ip) {
  if (!env.RATE_LIMIT) return;
  await env.RATE_LIMIT.delete(`login:${ip}`);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // /api/meta is intentionally NOT auth-gated: the login screen needs
    // to show which repo it's connecting to before the user has typed a
    // password. It only ever exposes owner/repo/branch (or {hidden:true}
    // if the admin has turned that off in Settings) — nothing sensitive.
    if (url.pathname === "/api/meta" && request.method === "GET") {
      try {
        const registry = await getRepoRegistry(env);
        if (!registry.showRepoOnLogin || !registry.active) {
          return json({ hidden: true });
        }
        return json({
          owner: registry.active.owner,
          repo: registry.active.repo,
          branch: registry.active.branch || "main",
        });
      } catch {
        return json({ hidden: true });
      }
    }

    if (url.pathname.startsWith("/api/")) {
      const ip = clientIp(request);
      const rateState = await getRateState(env, ip);
      if (rateState && rateState.lockedUntil > Date.now()) {
        const retryAfter = Math.ceil((rateState.lockedUntil - Date.now()) / 1000);
        return json(
          { error: `Too many failed attempts. Try again in ${retryAfter}s.` },
          429,
          { "Retry-After": String(retryAfter) }
        );
      }

      if (!isAuthed(request, env)) {
        await recordFailedAttempt(env, ip);
        return json({ error: "Unauthorized. Check the access password." }, 401);
      }
      await clearFailedAttempts(env, ip);

      try {
        if (url.pathname === "/api/tree" && request.method === "GET") {
          const repoCfg = await getActiveRepo(env);
          const tree = await getTree(env, repoCfg);
          return json(tree);
        }

        if (url.pathname === "/api/repo" && request.method === "GET") {
          const repoCfg = await getActiveRepo(env);
          const info = await getRepoInfo(env, repoCfg);
          return json({
            owner: repoCfg.owner,
            repo: repoCfg.repo,
            branch: repoCfg.branch,
            defaultBranch: info.default_branch,
            private: info.private,
            htmlUrl: info.html_url,
          });
        }

        if (url.pathname === "/api/blob" && request.method === "GET") {
          const sha = url.searchParams.get("sha");
          if (!sha) return json({ error: "Missing sha" }, 400);
          const repoCfg = await getActiveRepo(env);
          const blob = await getBlob(env, repoCfg, sha);
          return json(blob);
        }

        if (url.pathname === "/api/commit" && request.method === "POST") {
          const body = await request.json();
          const repoCfg = await getActiveRepo(env);
          const result = await commitChanges(env, repoCfg, {
            message: body.message || "Update via repo-manager",
            additions: body.additions || [],
            deletions: body.deletions || [],
          });
          return json(result);
        }

        // ---- multi-repo management ----

        if (url.pathname === "/api/repos" && request.method === "GET") {
          const registry = await getRepoRegistry(env);
          return json(registry);
        }

        if (url.pathname === "/api/repos/discover" && request.method === "GET") {
          const q = url.searchParams.get("q") || "";
          const repos = await discoverRepos(env, q);
          return json(repos);
        }

        if (url.pathname === "/api/repos" && request.method === "POST") {
          const body = await request.json();
          const owner = (body.owner || "").trim();
          const repo = (body.repo || "").trim();
          if (!owner || !repo) return json({ error: "owner and repo are required" }, 400);

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

        if (url.pathname === "/api/repos/active" && request.method === "PUT") {
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

        if (url.pathname === "/api/repos" && request.method === "DELETE") {
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

        if (url.pathname === "/api/settings" && request.method === "PUT") {
          const body = await request.json();
          const registry = await getRepoRegistry(env);
          if (typeof body.showRepoOnLogin === "boolean") {
            registry.showRepoOnLogin = body.showRepoOnLogin;
          }
          const saved = await saveRepoRegistry(env, registry);
          return json(saved);
        }

        return json({ error: "Not found" }, 404);
      } catch (err) {
        return json({ error: String(err.message || err) }, 500);
      }
    }

    // Anything else falls through to the static frontend in /public.
    return env.ASSETS.fetch(request);
  },
};
