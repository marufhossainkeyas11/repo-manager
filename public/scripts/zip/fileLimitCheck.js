import { escapeHtml } from "../utils/dom.js";
import { formatSize } from "../utils/format.js";
import { toast } from "../utils/toast.js";
import { approxSize } from "../utils/base64.js";

// GitHub's real limits (section 7.1, as of 2026): a single blob over 100MB
// is hard-rejected by the Git Data API; 50MB+ is allowed but GitHub itself
// warns about it in repo browsing, so that's used here as the soft
// threshold. Mirrored server-side in src/validators/fileLimits.js as a
// second defense-in-depth layer — bandwidth is saved by checking here
// first, before the bytes ever leave the browser.
export const MAX_WARN_BYTES = 50 * 1024 * 1024;
export const MAX_BLOCK_BYTES = 100 * 1024 * 1024;

// Checks one candidate file (already-decoded byte length) against the
// limits and shows the appropriate toast. Returns true if it's safe to
// stage, false if it must be skipped (over the hard 100MB cap).
export function checkFileSize(path, byteLength) {
  const filename = path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path;
  if (byteLength > MAX_BLOCK_BYTES) {
    toast(
      `<b>${escapeHtml(filename)}</b> is ${formatSize(byteLength)}, which exceeds GitHub's 100MB per-file limit. It can't be committed through the Git API.`,
      "err"
    );
    return false;
  }
  if (byteLength >= MAX_WARN_BYTES) {
    toast(
      `⚠ <b>${escapeHtml(filename)}</b> is ${formatSize(byteLength)} — GitHub allows files up to 100MB, but large files slow down cloning. Consider Git LFS for files this size.`,
      "warn"
    );
  }
  return true;
}

// Same check against an already-base64-encoded staged entry (used when
// re-checking staged additions, e.g. in the stage drawer warning icon).
export function checkStagedEntrySize(path, entry) {
  if (!entry.content) return true; // renames/moves reuse an existing blob sha, nothing to check
  return checkFileSize(path, approxSize(entry.content));
}

// Batch helper for zip extraction / multi-file upload (sections 7.2, 8):
// returns { passed: [...], skippedCount } and shows one summary toast when
// a mix of files passed and failed, per the plan's acceptance criteria.
export function summarizeBatch(stagedCount, skippedCount) {
  if (skippedCount > 0 && stagedCount > 0) {
    toast(`${stagedCount} file${stagedCount === 1 ? "" : "s"} staged, ${skippedCount} file${skippedCount === 1 ? "" : "s"} skipped (too large).`, "warn");
  }
}
