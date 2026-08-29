// Constant-time string comparison to avoid a timing side-channel on the
// access password check. A naive `===` comparison short-circuits at the
// first mismatched character, which — in a very sensitive setup — could
// theoretically let an attacker infer the password length/prefix from
// response timing. This walks the full length of both strings regardless
// of where they diverge.
function timingSafeEqual(a, b) {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  // Length must still be checked, but do it without an early return that
  // reveals length via timing on its own — compare against a max-length
  // buffer either way. In practice password length leakage is minor, but
  // this keeps the comparison itself branch-free over the byte loop.
  const len = Math.max(aBytes.length, bBytes.length);
  let diff = aBytes.length === bBytes.length ? 0 : 1;
  for (let i = 0; i < len; i++) {
    const x = i < aBytes.length ? aBytes[i] : 0;
    const y = i < bBytes.length ? bBytes[i] : 0;
    diff |= x ^ y;
  }
  return diff === 0;
}

export function isAuthed(request, env) {
  const header = request.headers.get("Authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token || !env.ACCESS_PASSWORD) return false;
  return timingSafeEqual(token, env.ACCESS_PASSWORD);
}
