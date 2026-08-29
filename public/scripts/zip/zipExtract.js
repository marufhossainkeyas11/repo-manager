import { unzipSync } from "https://cdn.jsdelivr.net/npm/fflate@0.8.2/+esm";
import { state } from "../state.js";
import { stageAdd } from "../staging/stage.js";
import { bytesToBase64 } from "../utils/base64.js";
import { sizeVerdict } from "../utils/sizeLimits.js";
import { toast } from "../utils/toast.js";
import { escapeHtml } from "../utils/dom.js";

// If every entry in the zip lives under one shared top-level folder (a common
// side effect of zipping a folder directly, e.g. on a phone), that wrapper
// folder is stripped so the wrapper's *contents* land directly in the target
// folder — never a copy of the wrapper itself nested inside it.
export function stripCommonWrapper(paths) {
  if (paths.length === 0) return null;
  const firstSegs = paths[0].split("/");
  if (firstSegs.length < 2) return null; // first entry is already top-level, nothing to strip
  const candidate = firstSegs[0];
  const allShareIt = paths.every((p) => {
    const segs = p.split("/");
    return segs.length >= 2 && segs[0] === candidate;
  });
  return allShareIt ? candidate : null;
}

function joinPath(dir, name) { return dir ? `${dir}/${name}` : name; }

// Parses the zip and returns its extractable entries without staging
// anything yet — used by the decision modal to show file count / size
// before the user chooses extract vs. keep-as-zip.
export function prescan(buf) {
  const unzipped = unzipSync(buf);
  const entries = Object.entries(unzipped).filter(([path, data]) => !path.endsWith("/") && data.length >= 0);
  const totalBytes = entries.reduce((sum, [, data]) => sum + data.length, 0);
  return { unzipped, entries, totalBytes };
}

// Extracts and stages every entry under destFolder, applying the same
// wrapper-strip heuristic and per-file size-limit check as any other
// upload. Reports progress via onProgress(done, total) for large zips.
export async function extractAndStage(entries, destFolder, onProgress) {
  let paths = entries.map(([p]) => p);
  const wrapper = stripCommonWrapper(paths);
  const finalEntries = wrapper
    ? entries.map(([path, data]) => [path.slice(wrapper.length + 1), data])
    : entries;

  let staged = 0;
  let skipped = 0;
  const total = finalEntries.length;
  for (let i = 0; i < finalEntries.length; i++) {
    const [path, data] = finalEntries[i];
    const verdict = sizeVerdict(data.length);
    if (verdict === "block") {
      skipped++;
      toast(`"${path}" is over GitHub's 100MB per-file limit — skipped.`, "err");
    } else {
      if (verdict === "warn") {
        toast(`"${path}" is large (${(data.length / (1024 * 1024)).toFixed(0)}MB) — staged, but consider Git LFS.`, "warn");
      }
      const targetPath = joinPath(destFolder, path);
      stageAdd(targetPath, bytesToBase64(data), "base64");
      staged++;
    }
    if (onProgress) onProgress(i + 1, total);
    // yield to the UI thread periodically so progress text actually paints
    // on very large zips (200+ files)
    if (i % 15 === 0) await new Promise((r) => setTimeout(r, 0));
  }

  const into = destFolder || "the repo root";
  const summary = skipped > 0
    ? `${staged} file${staged === 1 ? "" : "s"} staged, ${skipped} skipped (too large).`
    : wrapper
    ? `Unpacked ${staged} file${staged === 1 ? "" : "s"} from ${escapeHtml(wrapper)}/ straight into ${escapeHtml(into)}`
    : `Unpacked ${staged} file${staged === 1 ? "" : "s"} into ${escapeHtml(into)}`;
  toast(summary, skipped > 0 ? "warn" : "ok");
  return { staged, skipped, wrapper };
}
