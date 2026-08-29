// GitHub's Git Data API (POST /git/blobs) hard-rejects any single blob over
// 100MB. The client is supposed to catch this before it ever reaches us
// (see public/scripts/zip/ and the upload handlers) so we don't waste
// bandwidth uploading a file that's doomed to fail — but this check exists
// as defense-in-depth in case someone bypasses the UI and calls /api/commit
// directly (curl/Postman/a modified client).
export const MAX_BLOB_BYTES = 100 * 1024 * 1024; // 100MB — GitHub's hard limit

// `content` is base64, so decoded byte length is roughly content.length * 0.75.
// Good enough for a reject-oversized-uploads check — we don't need to be
// exact to the byte, just need to catch things that are obviously too big.
function approxDecodedBytes(base64content) {
  return Math.floor((base64content.length * 3) / 4);
}

// Returns the path of the first addition that exceeds the limit, or null if
// all additions are within bounds. Additions that reuse an existing blob sha
// (renames/moves — no `content` field) are always fine, since they're not
// uploading new blob data.
export function findOversizedAddition(additions) {
  for (const file of additions) {
    if (!file.content) continue; // reused sha (rename/move), nothing new to check
    if (approxDecodedBytes(file.content) > MAX_BLOB_BYTES) {
      return file.path;
    }
  }
  return null;
}
