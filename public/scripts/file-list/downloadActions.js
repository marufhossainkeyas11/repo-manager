import { $ } from "../utils/dom.js";
import { state, selectionCount } from "../state.js";
import { toast } from "../utils/toast.js";
import { stageDelete } from "../staging/stagedChanges.js";
import { confirmLargeSelection } from "./promptModal.js";
import { clearSelection } from "./selection.js";
import { downloadAsZip, downloadIndividually, downloadSelection } from "../zip/zipDownload.js";

// split-button dropdown toggle (section 6): primary click on
// downloadSelectedBtn zips/downloads directly; this chevron button just
// opens the "download individually" alternative.
$("downloadSplitToggle").addEventListener("click", (e) => {
  e.stopPropagation();
  $("downloadSplitMenu").classList.toggle("open");
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".split-btn")) $("downloadSplitMenu").classList.remove("open");
});

// Resolves the current selection (files + folders) down to a flat list of
// { path, zipPath } — loose files zip at root by filename; folder
// selections keep their folder name as a wrapper dir with the relative
// structure inside, which is standard "compress a folder" behavior.
function resolveSelectionToFiles() {
  const results = [];
  const seen = new Set();

  function allFilesUnder(folderPath) {
    const out = [];
    for (const f of state.tree) {
      if (state.staged.del.has(f.path)) continue;
      if (f.path === folderPath || f.path.startsWith(folderPath + "/")) out.push(f.path);
    }
    for (const p of state.staged.add.keys()) {
      if (p === folderPath || p.startsWith(folderPath + "/")) out.push(p);
    }
    return [...new Set(out)];
  }

  for (const path of state.selection.files) {
    if (state.staged.del.has(path)) continue;
    if (seen.has(path)) continue;
    seen.add(path);
    const name = path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path;
    results.push({ path, zipPath: name });
  }
  for (const folderPath of state.selection.folders) {
    const folderName = folderPath.split("/").pop();
    for (const filePath of allFilesUnder(folderPath)) {
      if (seen.has(filePath)) continue;
      seen.add(filePath);
      const rest = filePath.slice(folderPath.length); // includes leading "/"
      results.push({ path: filePath, zipPath: folderName + rest });
    }
  }
  return results;
}

$("deleteSelectedBtn").addEventListener("click", async () => {
  if (selectionCount() === 0) return toast("Select some files first.");
  const resolved = resolveSelectionToFiles();
  if (resolved.length === 0) return toast("Nothing to delete in the current selection.");
  const ok = await confirmLargeSelection(resolved.length, "Deleting");
  if (!ok) return;
  resolved.forEach((r) => stageDelete(r.path));
  clearSelection();
});

// Split-button: primary click = zip (or raw single-file download per
// section 9), dropdown = "Download files individually" (section 6.2).
$("downloadSelectedBtn").addEventListener("click", async () => {
  if (selectionCount() === 0) return toast("Select some files first.");
  const resolved = resolveSelectionToFiles();
  if (resolved.length === 0) return toast("Nothing to download in the current selection.");
  const ok = await confirmLargeSelection(resolved.length, "Zipping");
  if (!ok) return;

  const folderName = state.currentFolder ? state.currentFolder.split("/").pop() : (state.repoInfo ? state.repoInfo.repo : "files");
  const files = resolved.map((r) => state.tree.find((x) => x.path === r.path) || { path: r.path, sha: state.staged.add.get(r.path)?.sha });
  await downloadSelection({ files, folderCount: state.selection.folders.size }, folderName);
});

$("downloadIndividuallyBtn")?.addEventListener("click", async () => {
  $("downloadSplitMenu").classList.remove("open");
  if (selectionCount() === 0) return toast("Select some files first.");
  const resolved = resolveSelectionToFiles();
  if (resolved.length === 0) return toast("Nothing to download in the current selection.");
  const hasFolder = state.selection.folders.size > 0;
  if (hasFolder) {
    toast("Files inside folders will download individually without their folder structure — use 'Download as .zip' to preserve it.", "warn");
  }
  const files = resolved.map((r) => state.tree.find((x) => x.path === r.path) || { path: r.path, sha: state.staged.add.get(r.path)?.sha });
  await downloadIndividually(files);
});

export { resolveSelectionToFiles };
