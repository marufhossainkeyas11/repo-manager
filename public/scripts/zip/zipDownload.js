import { zipSync } from "https://cdn.jsdelivr.net/npm/fflate@0.8.2/+esm";
import { escapeHtml } from "../utils/dom.js";
import { state } from "../state.js";
import { api } from "../api.js";
import { toast } from "../utils/toast.js";
import { base64ToBytes } from "../utils/base64.js";
import { mapWithConcurrency } from "../utils/concurrency.js";

// Fetches blob content for a path, preferring an already-staged addition
// (unsaved edits/uploads) over the committed blob, matching how the editor
// already treats staged content as the source of truth.
async function fetchFileBytes(f) {
  const staged = state.staged.add.get(f.path);
  if (staged && staged.content) return base64ToBytes(staged.content);
  const blob = await api(`/api/blob?sha=${f.sha}`);
  return base64ToBytes(blob.content);
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Downloads every file under `files` (already-resolved list, folders
// pre-expanded to their contained files by the caller) as a single .zip.
// `zipRoot`, if given, is stripped from each path so the zip's internal
// structure starts at the folder being downloaded rather than the repo root.
export async function downloadAsZip(files, zipName, zipRoot = "") {
  if (files.length === 0) { toast("Nothing to download.", "err"); return; }
  toast(`Zipping ${files.length} file(s)…`);
  const zipData = {};
  await mapWithConcurrency(files, 5, async (f) => {
    const bytes = await fetchFileBytes(f);
    const inner = zipRoot && f.path.startsWith(zipRoot + "/") ? f.path.slice(zipRoot.length + 1) : f.path;
    zipData[inner] = bytes;
  });
  const zipped = zipSync(zipData);
  triggerDownload(new Blob([zipped], { type: "application/zip" }), zipName.endsWith(".zip") ? zipName : zipName + ".zip");
  toast(`Downloaded <b>${escapeHtml(zipName)}</b>`, "ok");
}

// Section 9: a selection of exactly one file (no folders involved) downloads
// as itself, raw — no zip wrapper — matching how a native file manager
// treats single- vs multi-file selection. Any folder, or more than one
// file, still goes through downloadAsZip. Callers resolve the selection
// first and pass { files, folderCount } so this stays a pure decision.
export async function downloadSelection({ files, folderCount }, zipName, zipRoot = "") {
  if (files.length === 1 && folderCount === 0) {
    const bytes = await fetchFileBytes(files[0]);
    triggerDownload(new Blob([bytes]), files[0].path.split("/").pop());
    toast(`Downloaded <b>${escapeHtml(files[0].path.split("/").pop())}</b>`, "ok");
    return;
  }
  await downloadAsZip(files, zipName, zipRoot);
}

// Downloads each file individually via sequential browser downloads
// (section 6.2 — the "keep folder structure out of it, just give me the
// files" option). Sequential + a small delay avoids the browser's
// multi-download popup blocker triggering on rapid-fire `a.click()` calls.
export async function downloadIndividually(files) {
  if (files.length === 0) { toast("Nothing to download.", "err"); return; }
  toast(`Downloading ${files.length} file(s)…`);
  for (const f of files) {
    const bytes = await fetchFileBytes(f);
    const filename = f.path.split("/").pop();
    triggerDownload(new Blob([bytes]), filename);
    await new Promise((r) => setTimeout(r, 250));
  }
  toast(`Downloaded ${files.length} file(s)`, "ok");
}
