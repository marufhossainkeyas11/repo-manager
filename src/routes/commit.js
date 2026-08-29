import { json } from "../lib/json.js";
import { commitChanges } from "../lib/github.js";
import { getActiveRepo } from "../lib/config.js";
import { isValidCommitPath } from "../validators/paths.js";
import { findOversizedAddition, MAX_BLOB_BYTES } from "../validators/fileLimits.js";

export async function handleCommit(request, env) {
  const body = await request.json();
  const additions = body.additions || [];
  const deletions = body.deletions || [];

  // Defense-in-depth: reject path traversal attempts before they ever reach
  // GitHub's API. The client should never send these, but a malicious
  // client bypassing the UI (direct API call) could try to.
  for (const file of additions) {
    if (!isValidCommitPath(file.path)) {
      return json({ error: `Invalid path: ${file.path}` }, 400);
    }
  }
  for (const path of deletions) {
    if (!isValidCommitPath(path)) {
      return json({ error: `Invalid path: ${path}` }, 400);
    }
  }

  // Defense-in-depth: the client is supposed to block oversized files
  // before upload (see public/scripts/zip/ and file-list/), but enforce
  // the same 100MB GitHub blob limit here too, in case that check was
  // bypassed.
  const oversizedPath = findOversizedAddition(additions);
  if (oversizedPath) {
    return json(
      { error: `${oversizedPath} exceeds GitHub's ${MAX_BLOB_BYTES / (1024 * 1024)}MB per-file limit.` },
      400
    );
  }

  const repoCfg = await getActiveRepo(env);
  const result = await commitChanges(env, repoCfg, {
    message: body.message || "Update via repo-manager",
    additions,
    deletions,
  });
  return json(result);
}
