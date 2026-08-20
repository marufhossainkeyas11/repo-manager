import { getTree, commitChanges, getBlob, getRepoInfo } from "./github.js";

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
          const tree = await getTree(env);
          return json(tree);
        }

        if (url.pathname === "/api/repo" && request.method === "GET") {
          const info = await getRepoInfo(env);
          return json({
            owner: env.GITHUB_OWNER,
            repo: env.GITHUB_REPO,
            branch: env.GITHUB_BRANCH || "main",
            defaultBranch: info.default_branch,
            private: info.private,
            htmlUrl: info.html_url,
          });
        }

        if (url.pathname === "/api/blob" && request.method === "GET") {
          const sha = url.searchParams.get("sha");
          if (!sha) return json({ error: "Missing sha" }, 400);
          const blob = await getBlob(env, sha);
          return json(blob);
        }

        if (url.pathname === "/api/commit" && request.method === "POST") {
          const body = await request.json();
          const result = await commitChanges(env, {
            message: body.message || "Update via repo-manager",
            additions: body.additions || [],
            deletions: body.deletions || [],
          });
          return json(result);
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
