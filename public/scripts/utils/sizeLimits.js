// GitHub's Git Data API hard-rejects any single blob over 100MB. This is
// the primary enforcement point (checked before upload, since the file
// content is already in the browser — no point spending bandwidth
// uploading something doomed to fail). The server has a matching check in
// src/validators/fileLimits.js as defense-in-depth in case this is bypassed.
export const WARN_BYTES = 50 * 1024 * 1024;   // 50MB — GitHub's own soft-warning threshold
export const MAX_BYTES = 100 * 1024 * 1024;   // 100MB — GitHub's hard per-blob limit

// Returns "ok" | "warn" | "block" for a given byte size.
export function sizeVerdict(bytes) {
  if (bytes > MAX_BYTES) return "block";
  if (bytes > WARN_BYTES) return "warn";
  return "ok";
}
