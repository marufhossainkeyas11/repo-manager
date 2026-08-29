import { json, SECURITY_HEADERS } from "./lib/json.js";
import { isAuthed } from "./middleware/auth.js";
import {
  clientIp,
  getRateState,
  recordFailedAttempt,
  clearFailedAttempts,
} from "./middleware/rateLimit.js";

import { handleMeta } from "./routes/meta.js";
import { handleTree } from "./routes/tree.js";
import { handleBlob } from "./routes/blob.js";
import { handleRepo } from "./routes/repo.js";
import { handleCommit } from "./routes/commit.js";
import {
  handleReposGet,
  handleReposPost,
  handleReposActivePut,
  handleReposDelete,
} from "./routes/repos.js";
import { handleReposDiscover } from "./routes/reposDiscover.js";
import { handleSettingsPut } from "./routes/settings.js";

// Route table: [method, pathname] -> handler. Matched exactly, in order.
// This file is intentionally just a dispatcher — no business logic lives
// here, only URL matching and the auth/rate-limit gate that wraps every
// /api/* route except /api/meta.
const ROUTES = [
  ["GET", "/api/tree", handleTree],
  ["GET", "/api/repo", handleRepo],
  ["GET", "/api/blob", handleBlob],
  ["POST", "/api/commit", handleCommit],
  ["GET", "/api/repos", handleReposGet],
  ["GET", "/api/repos/discover", handleReposDiscover],
  ["POST", "/api/repos", handleReposPost],
  ["PUT", "/api/repos/active", handleReposActivePut],
  ["DELETE", "/api/repos", handleReposDelete],
  ["PUT", "/api/settings", handleSettingsPut],
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // /api/meta is intentionally NOT auth-gated (see routes/meta.js).
    if (url.pathname === "/api/meta" && request.method === "GET") {
      return handleMeta(request, env);
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
        const match = ROUTES.find(([method, path]) => method === request.method && path === url.pathname);
        if (match) return await match[2](request, env);
        return json({ error: "Not found" }, 404);
      } catch (err) {
        return json({ error: String(err.message || err) }, 500);
      }
    }

    // Anything else falls through to the static frontend in /public.
    // No CORS headers are set intentionally — this Worker only ever serves
    // its own frontend, so allowing cross-origin fetches to /api/* would
    // only widen the attack surface for no benefit.
    const assetResponse = await env.ASSETS.fetch(request);
    const headers = new Headers(assetResponse.headers);
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) headers.set(key, value);
    return new Response(assetResponse.body, { status: assetResponse.status, headers });
  },
};
