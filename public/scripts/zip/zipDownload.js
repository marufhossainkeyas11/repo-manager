import { zipSync } from "https://cdn.jsdelivr.net/npm/fflate@0.8.2/+esm";
import { $, escapeHtml } from "../utils/dom.js";
import { state } from "../state.js";
import { api } from "../api.js";
import { resolveSelectionToFiles } from "./resolveSelection.js";
import { mapWithConcurrency } from "../utils/concurrency.js";
import { base64ToBytes } from "../utils/base64.js";
import { appendSuffix } from "../utils/format.js";
import { toast } from "../utils/toast.js";

async function confirmLargeSelection(count, verb) {
  if (count < 20) return true;
  return confirm(`${count} files affected. ${verb} cannot be easily undone once committed. Continue?`);
}

async function fetchFileBytes(path) {
  const staged = state.staged.add.get(path);
  if (staged) return base64ToBytes(staged.content);
  const f = state.tree.find((x) => x.path === path);
  if (!f) return null;
  const blob = await api(`/api/blob?sha=${encodeURIComponent(f.sha)}`);
  return base64ToBytes(blob.content.replace(/\n/g, ""));
}

function triggerBrowserDownload(bytes, filename, mime = "application/octet-stream") {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Downloads the current selection. If the selection is exactly one file
// (no folders, no multi-select), it downloads that file directly in its
// original format — no zip wrapper, matching normal file-manager behavior
// (Google Files / Windows Explorer only zip on folder or multi-selection).
export async function downloadSelectionAsZip(setButtonBusy) {
  const resolved = resolveSelectionToFiles();
  if (resolved.length === 0) return toast("Nothing to download in the current selection.", "err");

  if (resolved.length === 1 && state.selection.folders.size === 0) {
    const only = resolved[0];
    const bytes = await fetchFileBytes(only.path);
    if (!bytes) return toast("Couldn't find that file.", "err");
    triggerBrowserDownload(bytes, only.zipPath);
    toast(`Downloaded "${escapeHtml(only.zipPath)}"`, "ok");
    return;
  }

  const ok = await confirmLargeSelection(resolved.length, "Zipping");
  if (!ok) return;

  setButtonBusy(true, `Zipping 0/${resolved.length}…`);
  try {
    const zipEntries = {};
    const usedNames = new Set();
    let done = 0;
    await mapWithConcurrency(resolved, 5, async (r) => {
      const bytes = await fetchFileBytes(r.path);
      if (!bytes) { done++; setButtonBusy(true, `Zipping ${done}/${resolved.length}…`); return; }
      let finalZipPath = r.zipPath;
      if (!finalZipPath.includes("/")) {
        let n = 2;
        while (usedNames.has(finalZipPath)) { finalZipPath = appendSuffix(r.zipPath, n); n++; }
        usedNames.add(finalZipPath);
      }
      zipEntries[finalZipPath] = bytes;
      done++;
      setButtonBusy(true, `Zipping ${done}/${resolved.length}…`);
    });
    const zipped = zipSync(zipEntries);
    const folderName = state.currentFolder ? state.currentFolder.split("/").pop() : (state.repoInfo ? state.repoInfo.repo : "files");
    triggerBrowserDownload(zipped, `${folderName}.zip`, "application/zip");
    toast(`Downloaded ${resolved.length} file(s) as ${escapeHtml(folderName)}.zip`, "ok");
  } catch (err) {
    toast("Couldn't build the zip: " + err.message, "err");
  } finally {
    setButtonBusy(false);
  }
}

// "Download individually" — each selected file triggers as a separate
// browser download, serially with a small delay between each, since
// browsers block/flag many near-simultaneous downloads as popup spam.
// Folder structure is not preserved (browsers can't create folders on
// download) — this is called out in the UI near the option.
export async function downloadSelectionIndividually(setButtonBusy) {
  const resolved = resolveSelectionToFiles();
  if (resolved.length === 0) return toast("Nothing to download in the current selection.", "err");

  setButtonBusy(true, `Downloading 0/${resolved.length}…`);
  let done = 0;
  try {
    for (const r of resolved) {
      const bytes = await fetchFileBytes(r.path);
      if (bytes) {
        const flatName = r.zipPath.includes("/") ? r.zipPath.split("/").pop() : r.zipPath;
        triggerBrowserDownload(bytes, flatName);
      }
      done++;
      setButtonBusy(true, `Downloading ${done}/${resolved.length}…`);
      await new Promise((res) => setTimeout(res, 350)); // throttle to avoid browser popup-blocking
    }
    toast(`Triggered ${resolved.length} separate downloads.`, "ok");
  } catch (err) {
    toast("Couldn't download all files: " + err.message, "err");
  } finally {
    setButtonBusy(false);
  }
}

export async function downloadSingleFile(path) {
  const bytes = await fetchFileBytes(path);
  if (!bytes) return toast("Couldn't find that file.", "err");
  const name = path.split("/").pop();
  triggerBrowserDownload(bytes, name);
  toast(`Downloaded "${escapeHtml(name)}"`, "ok");
}
