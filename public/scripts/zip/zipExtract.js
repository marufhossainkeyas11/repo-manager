import { unzipSync } from "https://cdn.jsdelivr.net/npm/fflate@0.8.2/+esm";
import { escapeHtml } from "../utils/dom.js";
import { state } from "../state.js";
import { toast } from "../utils/toast.js";
import { bytesToBase64 } from "../utils/base64.js";
import { stageAdd } from "../staging/stagedChanges.js";
import { checkFileSize, summarizeBatch } from "./fileLimitCheck.js";

function joinPath(dir, name) { return dir ? `${dir}/${name}` : name; }

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

// Reads a zip file's entries without staging anything yet — used by the
// upload decision dialog (section 5.2) to show file count + size before the
// user decides whether to extract or keep it as a raw .zip.
export function preScanZip(buf) {
  let unzipped;
  try {
    unzipped = unzipSync(buf);
  } catch (err) {
    return { error: err.message };
  }
  const entries = Object.entries(unzipped).filter(([path, data]) => !path.endsWith("/") && data.length >= 0);
  const totalBytes = entries.reduce((sum, [, data]) => sum + data.length, 0);
  return { entries, totalBytes };
}

// Extracts + wrapper-strips + stages every entry under `targetFolder`
// (the "Unzip & merge into this folder" path — section 5.2). Entries over
// the 100MB hard cap are skipped individually; the rest still stage
// normally (section 8's "no hard cap on file count" rule), with a
// progress callback for the "Extracting N/M…" indicator.
export function extractAndStage(entries, targetFolder, onProgress) {
  let wrapper = stripCommonWrapper(entries.map(([p]) => p));
  let normalized = wrapper ? entries.map(([path, data]) => [path.slice(wrapper.length + 1), data]) : entries;

  let staged = 0;
  let skipped = 0;
  let done = 0;
  for (const [path, data] of normalized) {
    const targetPath = joinPath(targetFolder, path);
    if (checkFileSize(targetPath, data.length)) {
      stageAdd(targetPath, { content: bytesToBase64(data), encoding: "base64" });
      staged++;
    } else {
      skipped++;
    }
    done++;
    if (onProgress) onProgress(done, normalized.length);
  }

  const into = targetFolder || "the repo root";
  if (staged > 0) {
    toast(wrapper
      ? `Unpacked <b>${staged}</b> file(s) from <b>${escapeHtml(wrapper)}/</b> straight into <b>${escapeHtml(into)}</b>`
      : `Unpacked <b>${staged}</b> file(s) into <b>${escapeHtml(into)}</b>`);
  }
  summarizeBatch(staged, skipped);
  return { staged, skipped, wrapper };
}
