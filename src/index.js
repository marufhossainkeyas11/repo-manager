import {
  getTree,
  commitChanges,
  getBlob,
  getRepoInfo,
  getViewer,
  listRepos,
  searchRepos,
  listBranches,
} from "./github.js";

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

// --- active repo + recents, stored server-side in KV so it's the same on
// every device. Falls back to wrangler.jsonc vars (GITHUB_OWNER/REPO/BRANCH)
// only as a bootstrap default the very first time, or if KV isn't bound.
const ACTIVE_REPO_KEY = "repo-manager:active";
const RECENT_REPOS_KEY = "repo-manager:recents";
const MAX_RECENTS = 8;

async function getActiveRepo(env) {
  if (env.RATE_LIMIT) {
    const raw = await env.RATE_LIMIT.get(ACTIVE_REPO_KEY);
    if (raw) return JSON.parse(raw);
  }
  if (env.GITHUB_OWNER && env.GITHUB_REPO) {
    return { owner: env.GITHUB_OWNER, repo: env.GITHUB_REPO, branch: env.GITHUB_BRANCH || "main" };
  }
  return null;
}

async function setActiveRepo(env, { owner, repo, branch }) {
  const value = { owner, repo, branch: branch || "main" };
  if (env.RATE_LIMIT) {
    await env.RATE_LIMIT.put(ACTIVE_REPO_KEY, JSON.stringify(value));
  }
  return value;
}

async function getRecentRepos(env) {
  if (!env.RATE_LIMIT) return [];
  const raw = await env.RATE_LIMIT.get(RECENT_REPOS_KEY);
  return raw ? JSON.parse(raw) : [];
}

async function pushRecentRepo(env, entry) {
  if (!env.RATE_LIMIT) return;
  const list = await getRecentRepos(env);
  const key = `${entry.owner}/${entry.repo}`;
  const filtered = list.filter((r) => `${r.owner}/${r.repo}` !== key);
  filtered.unshift({ ...entry, lastOpened: Date.now() });
  await env.RATE_LIMIT.put(RECENT_REPOS_KEY, JSON.stringify(filtered.slice(0, MAX_RECENTS)));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

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
        // ---- repo-scoped routes: owner/repo/branch come from query params,
        // falling back to the stored active repo when omitted ----
        const active = await getActiveRepo(env);
        const qOwner = url.searchParams.get("owner");
        const qRepo = url.searchParams.get("repo");
        const qBranch = url.searchParams.get("branch");

        if (url.pathname === "/api/tree" && request.method === "GET") {
          const owner = qOwner || active?.owner;
          const repo = qRepo || active?.repo;
          const branch = qBranch || active?.branch || "main";
          if (!owner || !repo) return json({ error: "No repository selected yet." }, 400);
          const tree = await getTree(env, owner, repo, branch);
          return json(tree);
        }

        if (url.pathname === "/api/repo" && request.method === "GET") {
          const owner = qOwner || active?.owner;
          const repo = qRepo || active?.repo;
          if (!owner || !repo) return json({ error: "No repository selected yet." }, 400);
          const info = await getRepoInfo(env, owner, repo);
          return json({
            owner,
            repo,
            branch: qBranch || active?.branch || info.default_branch,
            defaultBranch: info.default_branch,
            private: info.private,
            htmlUrl: info.html_url,
            description: info.description,
          });
        }

        if (url.pathname === "/api/blob" && request.method === "GET") {
          const owner = qOwner || active?.owner;
          const repo = qRepo || active?.repo;
          const sha = url.searchParams.get("sha");
          if (!owner || !repo) return json({ error: "No repository selected yet." }, 400);
          if (!sha) return json({ error: "Missing sha" }, 400);
          const blob = await getBlob(env, owner, repo, sha);
          return json(blob);
        }

        if (url.pathname === "/api/commit" && request.method === "POST") {
          const body = await request.json();
          const owner = body.owner || active?.owner;
          const repo = body.repo || active?.repo;
          const branch = body.branch || active?.branch || "main";
          if (!owner || !repo) return json({ error: "No repository selected yet." }, 400);
          const result = await commitChanges(env, owner, repo, branch, {
            message: body.message || "Update via repo-manager",
            additions: body.additions || [],
            deletions: body.deletions || [],
          });
          return json(result);
        }

        // ---- account/identity ----
        if (url.pathname === "/api/whoami" && request.method === "GET") {
          const viewer = await getViewer(env);
          return json({ login: viewer.login, name: viewer.name, avatarUrl: viewer.avatar_url });
        }

        // ---- repo directory: list, search, recents, branches ----
        if (url.pathname === "/api/repos" && request.method === "GET") {
          const q = url.searchParams.get("q");
          const repos = q && q.trim() ? await searchRepos(env, q.trim()) : await listRepos(env);
          const recents = await getRecentRepos(env);
          return json({ repos, recents, active: await getActiveRepo(env) });
        }

        if (url.pathname === "/api/repos/branches" && request.method === "GET") {
          if (!qOwner || !qRepo) return json({ error: "Missing owner/repo" }, 400);
          const branches = await listBranches(env, qOwner, qRepo);
          return json({ branches });
        }

        // ---- switch the active repo (persists server-side, syncs all devices) ----
        if (url.pathname === "/api/repos/select" && request.method === "POST") {
          const body = await request.json();
          if (!body.owner || !body.repo) return json({ error: "Missing owner/repo" }, 400);
          const value = await setActiveRepo(env, { owner: body.owner, repo: body.repo, branch: body.branch });
          await pushRecentRepo(env, value);
          return json({ active: value });
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
