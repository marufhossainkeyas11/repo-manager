import { $, escapeHtml, escapeAttr } from "../utils/dom.js";
import { state } from "../state.js";
import { formatSize } from "../utils/format.js";
import { findFolder } from "../tree/treeIndex.js";
import { navigateTo } from "../tree/breadcrumb.js";
import { handleDropOnFolder } from "../dragdrop/dragMove.js";
import { fileIconSvg, iconRename, iconMove, iconDup, iconTrash, iconMoreDots } from "./icons.js";
import { promptRenameFile, promptRenameFolder, promptMoveFile, promptMoveFolder, duplicateFile, deleteFolder } from "./fileActions.js";
import { stageDelete } from "../staging/stagedChanges.js";
import { toast } from "../utils/toast.js";
import { handleSelClick, toggleSelection, updateSelectAllCheckbox, updateSelectionToolbar, enterSelectionMode } from "./selection.js";
import { openContextMenu } from "./contextMenu.js";
import { openRowSheet } from "./rowSheet.js";
import { isTabletOrBelow } from "../utils/breakpoints.js";
import { MAX_WARN_BYTES } from "../zip/fileLimitCheck.js";

// openFileInEditor lives in editor/editor.js — set once at boot to avoid
// a circular import (editor.js doesn't need fileList.js).
let openFileInEditorFn = () => {};
export function setOpenFileInEditor(fn) { openFileInEditorFn = fn; }

const LONG_PRESS_MS = 450;

export function renderFileList() {
  const node = findFolder(state.currentFolder);
  const list = $("fileList");
  list.innerHTML = "";

  if (!node) { list.innerHTML = '<div class="empty-state">Folder not found — it may have just been removed.</div>'; updateSelectionToolbar(); return; }

  const filter = $("search").value.trim().toLowerCase();
  const folders = [...node.folders.values()]
    .filter((f) => f.path.split("/").pop().toLowerCase().includes(filter))
    .sort((a, b) => a.path.localeCompare(b.path));
  const files = node.files
    .filter((f) => f.path.split("/").pop().toLowerCase().includes(filter))
    .sort((a, b) => a.path.localeCompare(b.path));

  if (folders.length === 0 && files.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="big">📁</div>${filter ? "No matches in this folder." : "This folder is empty. Create a file or drop something in."}</div>`;
    updateSelectionToolbar();
    return;
  }

  const touchCapable = isTabletOrBelow();

  for (const f of folders) {
    const row = document.createElement("div");
    row.className = "frow";
    row.draggable = !touchCapable;
    row.innerHTML = `
      <input type="checkbox" data-path="${escapeAttr(f.path)}" data-kind="folder" class="sel" />
      <svg class="ftype-ic folder" width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
      <div class="name-col"><span class="name">${escapeHtml(f.path.split("/").pop())}</span><span class="subtitle">Folder</span></div>
      <span class="size"></span>
      <div class="row-actions">
        <button class="rename-a" title="Rename">${iconRename()}</button>
        <button class="move-a" title="Move to…">${iconMove()}</button>
        <button class="danger delete-a" title="Delete folder">${iconTrash()}</button>
        <button class="row-more" title="More">${iconMoreDots()}</button>
      </div>
    `;
    row.querySelector(".sel").checked = state.selection.folders.has(f.path);
    row.addEventListener("click", (e) => { if (e.target.closest(".row-actions") || e.target.classList.contains("sel")) return; navigateTo(f.path); });
    row.querySelector(".rename-a").addEventListener("click", (e) => { e.stopPropagation(); promptRenameFolder(f.path); });
    row.querySelector(".move-a").addEventListener("click", (e) => { e.stopPropagation(); promptMoveFolder(f.path); });
    row.querySelector(".delete-a").addEventListener("click", (e) => { e.stopPropagation(); deleteFolder(f.path); });
    row.querySelector(".row-more").addEventListener("click", (e) => {
      e.stopPropagation();
      if (touchCapable) { openRowSheet(f.path, "folder"); return; }
      const r = e.currentTarget.getBoundingClientRect();
      openContextMenu(r.right, r.bottom, f.path, "folder");
    });
    row.querySelector(".sel").addEventListener("click", (e) => handleSelClick(e, f.path, "folder"));
    row.querySelector(".sel").addEventListener("change", (e) => { toggleSelection(f.path, "folder", e.target.checked); updateSelectionToolbar(); });
    row.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", JSON.stringify({ kind: "folder", path: f.path })); row.classList.add("dragging"); });
    row.addEventListener("dragend", () => row.classList.remove("dragging"));
    row.addEventListener("dragover", (e) => { e.preventDefault(); row.classList.add("drop-target"); });
    row.addEventListener("dragleave", () => row.classList.remove("drop-target"));
    row.addEventListener("drop", (e) => {
      e.preventDefault(); e.stopPropagation();
      row.classList.remove("drop-target");
      handleDropOnFolder(f.path, e.dataTransfer.getData("text/plain"));
    });
    row.addEventListener("contextmenu", (e) => { e.preventDefault(); if (!touchCapable) openContextMenu(e.clientX, e.clientY, f.path, "folder"); });
    wireLongPress(row, f.path, "folder");
    list.appendChild(row);
  }

  for (const f of files) {
    const row = document.createElement("div");
    const isStagedAdd = state.staged.add.has(f.path);
    const isStagedDel = state.staged.del.has(f.path);
    const sizeWarn = (f.size || 0) >= MAX_WARN_BYTES;
    row.className = "frow" + (isStagedAdd ? " staged-add" : "") + (isStagedDel ? " staged-del" : "") + (sizeWarn ? " size-warn-row" : "");
    row.draggable = !touchCapable;
    row.innerHTML = `
      <input type="checkbox" data-path="${escapeAttr(f.path)}" data-kind="file" class="sel" />
      ${fileIconSvg(f.path)}
      <div class="name-col"><span class="name">${escapeHtml(f.path.split("/").pop())}</span><span class="subtitle">${formatSize(f.size)}</span></div>
      <span class="size${sizeWarn ? " size-warn" : ""}">${formatSize(f.size)}</span>
      <div class="row-actions">
        <button class="rename-a" title="Rename">${iconRename()}</button>
        <button class="move-a" title="Move to…">${iconMove()}</button>
        <button class="dup-a" title="Duplicate">${iconDup()}</button>
        <button class="danger delete-a" title="Delete">${iconTrash()}</button>
        <button class="row-more" title="More">${iconMoreDots()}</button>
      </div>
    `;
    row.querySelector(".sel").checked = state.selection.files.has(f.path);
    row.addEventListener("click", (e) => { if (e.target.closest(".row-actions") || e.target.classList.contains("sel")) return; openFileInEditorFn(f); });
    row.querySelector(".rename-a").addEventListener("click", (e) => { e.stopPropagation(); promptRenameFile(f.path); });
    row.querySelector(".move-a").addEventListener("click", (e) => { e.stopPropagation(); promptMoveFile(f.path); });
    row.querySelector(".dup-a").addEventListener("click", (e) => { e.stopPropagation(); duplicateFile(f); });
    row.querySelector(".delete-a").addEventListener("click", (e) => { e.stopPropagation(); stageDelete(f.path); toast(`Staged delete: <b>${escapeHtml(f.path.split("/").pop())}</b>`); });
    row.querySelector(".row-more").addEventListener("click", (e) => {
      e.stopPropagation();
      if (touchCapable) { openRowSheet(f.path, "file"); return; }
      const r = e.currentTarget.getBoundingClientRect();
      openContextMenu(r.right, r.bottom, f.path, "file");
    });
    row.querySelector(".sel").addEventListener("click", (e) => handleSelClick(e, f.path, "file"));
    row.querySelector(".sel").addEventListener("change", (e) => { toggleSelection(f.path, "file", e.target.checked); updateSelectionToolbar(); });
    row.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", JSON.stringify({ kind: "file", path: f.path })); row.classList.add("dragging"); });
    row.addEventListener("dragend", () => row.classList.remove("dragging"));
    row.addEventListener("contextmenu", (e) => { e.preventDefault(); if (!touchCapable) openContextMenu(e.clientX, e.clientY, f.path, "file"); });
    wireLongPress(row, f.path, "file");
    list.appendChild(row);
  }

  updateSelectAllCheckbox(folders, files);
  updateSelectionToolbar();
}

// Touch-hold (~450ms) enters selection mode and selects the pressed row —
// section 4.2's native-file-manager shortcut, in addition to the existing
// checkbox-tap method. Desktop rows aren't draggable=false here purely to
// keep this simple; mouse users don't trigger touchstart at all.
function wireLongPress(row, path, kind) {
  let timer = null;
  let moved = false;
  row.addEventListener("touchstart", () => {
    moved = false;
    timer = setTimeout(() => {
      if (moved) return;
      enterSelectionMode();
      toggleSelection(path, kind, true);
      row.querySelector(".sel").checked = true;
      updateSelectionToolbar();
      if (navigator.vibrate) navigator.vibrate(15);
    }, LONG_PRESS_MS);
  }, { passive: true });
  row.addEventListener("touchmove", () => { moved = true; clearTimeout(timer); }, { passive: true });
  row.addEventListener("touchend", () => clearTimeout(timer));
}
