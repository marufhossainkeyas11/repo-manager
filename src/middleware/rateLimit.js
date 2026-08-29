// --- server-side brute-force protection ---
// Tracks failed auth attempts per client IP in KV and locks that IP out
// with exponential backoff. This is the real protection layer (the
// frontend's own countdown is just UX — it can't stop a script that hits
// this Worker directly). Only active if the RATE_LIMIT KV binding exists,
// so the Worker still runs without it (see README to add the binding).
export const MAX_FAILS_BEFORE_LOCK = 5;
export const BASE_LOCK_SECONDS = 30;
export const MAX_LOCK_SECONDS = 15 * 60;

export function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || "unknown";
}

export async function getRateState(env, ip) {
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

export async function recordFailedAttempt(env, ip) {
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

export async function clearFailedAttempts(env, ip) {
  if (!env.RATE_LIMIT) return;
  await env.RATE_LIMIT.delete(`login:${ip}`);
}
