// Server-side defense-in-depth against path traversal in commit paths.
// GitHub's Git Data API takes a raw tree path and does some normalization
// itself, but we don't want to rely on that alone — a malicious client
// could try to send something like "../../.github/workflows/x.yml" to
// write outside the intended tree structure. Reject anything with a ".."
// segment, a leading slash, or a null byte before it ever reaches GitHub.
export function isValidCommitPath(path) {
  if (typeof path !== "string" || path.length === 0) return false;
  if (path.includes("\0")) return false;
  if (path.startsWith("/")) return false;
  const segments = path.split("/");
  return segments.every((seg) => seg !== "." && seg !== "..");
}

// GitHub owner/repo names: alphanumeric, hyphen, underscore, dot only
// (matches GitHub's actual naming rules closely enough to block injection
// attempts without being overly strict about edge cases GitHub itself
// would reject anyway via the API call that follows).
const OWNER_REPO_RE = /^[A-Za-z0-9._-]+$/;

export function isValidOwnerOrRepo(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 100 && OWNER_REPO_RE.test(value);
}
