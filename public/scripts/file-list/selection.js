import { $ } from "../utils/dom.js";
import { state, selectionCount, resetSelection } from "../state.js";
import { findFolder } from "../tree/treeIndex.js";
import { isMobile } from "../utils/breakpoints.js";

// renderFileList lives in file-list/fileList.js — set once at boot to
// avoid a circular import (fileList.js calls into this module too).
let renderFileListFn = () => {};
export function setRenderFileList(fn) { renderFileListFn = fn; }

let lastClickedPath = null;

// Shift-click = range select, Ctrl/Cmd-click = toggle individual without
// disturbing others (native checkbox click already toggles individually,
// so this only needs to special-case the range case and record the anchor).
export function handleSelClick(e, path, kind) {
  const currentListOrder = [...$("fileList").querySelectorAll(".sel")].map((el) => ({ path: el.dataset.path, kind: el.dataset.kind }));
  if (e.shiftKey && lastClickedPath) {
    e.preventDefault();
    const fromIdx = currentListOrder.findIndex((x) => x.path === lastClickedPath);
    const toIdx = currentListOrder.findIndex((x) => x.path === path);
    if (fromIdx !== -1 && toIdx !== -1) {
      const [lo, hi] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
      for (let i = lo; i <= hi; i++) {
        toggleSelection(currentListOrder[i].path, currentListOrder[i].kind, true);
      }
      renderFileListFn();
    }
    return;
  }
  lastClickedPath = path;
}

export function toggleSelection(path, kind, checked) {
  const set = kind === "folder" ? state.selection.folders : state.selection.files;
  if (checked) set.add(path); else set.delete(path);
}

export function updateSelectAllCheckbox(folders, files) {
  const total = folders.length + files.length;
  const selectedCount = folders.filter((f) => state.selection.folders.has(f.path)).length
    + files.filter((f) => state.selection.files.has(f.path)).length;
  const st = total === 0 ? "none" : selectedCount === 0 ? "none" : selectedCount === total ? "all" : "some";
  for (const id of ["selectAllToggle", "selectionBarAllToggle"]) {
    const el = $(id);
    if (!el) continue;
    el.checked = st === "all";
    el.indeterminate = st === "some";
    el.disabled = total === 0;
  }
}

export function currentVisibleEntries() {
  const node = findFolder(state.currentFolder);
  if (!node) return { folders: [], files: [] };
  const filter = $("search").value.trim().toLowerCase();
  const folders = [...node.folders.values()].filter((f) => f.path.split("/").pop().toLowerCase().includes(filter));
  const files = node.files.filter((f) => f.path.split("/").pop().toLowerCase().includes(filter));
  return { folders, files };
}

export function toggleSelectAll(checked) {
  const { folders, files } = currentVisibleEntries();
  for (const f of folders) toggleSelection(f.path, "folder", checked);
  for (const f of files) toggleSelection(f.path, "file", checked);
  renderFileListFn();
}
$("selectAllToggle").addEventListener("change", (e) => toggleSelectAll(e.target.checked));
$("selectionBarAllToggle").addEventListener("change", (e) => toggleSelectAll(e.target.checked));

export function clearSelection() {
  resetSelection();
  state.selectionMode = false;
  renderFileListFn();
  updateSelectionToolbar();
}
$("selBarClearBtn").addEventListener("click", clearSelection);

export function updateSelectionToolbar() {
  const any = selectionCount() > 0;
  $("deleteSelectedBtn").style.display = any ? "inline-flex" : "none";
  $("downloadSplitWrap").style.display = any ? "inline-flex" : "none";
  // mobile: swap the normal toolbar/bottom-nav for a compact selection bar
  const mobile = isMobile();
  const show = (mobile && (any || state.selectionMode)) || (!mobile && any);
  $("selectionBar").classList.toggle("active", show);
  $("toolbar").classList.toggle("selection-hidden", mobile && show);
  $("selectionCount").textContent = `${selectionCount()} selected`;
}
window.addEventListener("resize", updateSelectionToolbar);
$("selBarZipBtn").addEventListener("click", () => $("downloadSelectedBtn").click());
$("selBarDeleteBtn").addEventListener("click", () => $("deleteSelectedBtn").click());

// Mobile-only: explicit selection-mode toggle (section 4.2 bottom nav
// "Select" button) and long-press (~450ms) shortcut into the same mode.
export function enterSelectionMode() {
  state.selectionMode = true;
  updateSelectionToolbar();
}
export function exitSelectionMode() {
  state.selectionMode = false;
  resetSelection();
  renderFileListFn();
  updateSelectionToolbar();
}
