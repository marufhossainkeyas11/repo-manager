import { $, escapeHtml } from "../utils/dom.js";
import { state } from "../state.js";
import { findFolder } from "../tree/treeIndex.js";
import { formatSize, approxSize } from "../utils/format.js";
import { isImageFile } from "../utils/fileTypes.js";
import { fileIcon, iconFolder, iconDownload, iconRename, iconMove, iconDup, iconTrash, iconMoreDots } from "../utils/icons.js";
import { openContextMenu } from "./contextMenu.js";
import { selectionCount, toggleFileSelected, toggleFolderSelected, updateSelectionBar } from "./selection.js";
import { sizeVerdict } from "../utils/sizeLimits.js";

let onOpenFile = () => {};
export function setOpenFileHandler(fn) { onOpenFile = fn; }
let onNavigateFolder = () => {};
export function setNavigateFolderHandler(fn) { onNavigateFolder = fn; }
let onDropMove = () => {};
export function setDropMoveHandler(fn) { onDropMove = fn; }

let searchQuery = "";
export function setSearchQuery(q) { searchQuery = q.toLowerCase(); renderFileList(); }

let longPressTimer = null;

export function renderFileList() {
  const node = findFolder(state.currentFolder);
  const scroll = $("fileList");
  scroll.innerHTML = "";

  if (!node) {
    scroll.innerHTML = `<div class="empty-state"><div class="big">📁</div>Folder not found.</div>`;
    return;
  }

  let folders = [...node.folders.values()].sort((a, b) => a.path.localeCompare(b.path));
  let files = [...node.files].sort((a, b) => a.path.localeCompare(b.path));

  if (searchQuery) {
    folders = folders.filter((f) => f.path.split("/").pop().toLowerCase().includes(searchQuery));
    files = files.filter((f) => f.path.split("/").pop().toLowerCase().includes(searchQuery));
  }

  if (folders.length === 0 && files.length === 0) {
    scroll.innerHTML = `<div class="empty-state"><div class="big">🗂️</div>${searchQuery ? "No matches." : "This folder is empty."}</div>`;
    return;
  }

  const frag = document.createDocumentFragment();
  for (const f of folders) frag.appendChild(folderRow(f));
  for (const f of files) frag.appendChild(fileRow(f));
  scroll.appendChild(frag);
}

function isSelected(path, isFolder) {
  return isFolder ? state.selection.folders.has(path) : state.selection.files.has(path);
}

function folderRow(node) {
  const row = document.createElement("div");
  row.className = "frow";
  row.dataset.path = node.path;
  row.dataset.folder = "1";
  const name = node.path.split("/").pop();
  const selMode = selectionCount() > 0;
  row.innerHTML = `
    <input type="checkbox" ${isSelected(node.path, true) ? "checked" : ""} style="${selMode ? "" : "display:none"}">
    ${iconFolder()}
    <div class="name-col"><span class="name">${escapeHtml(name)}</span></div>
    <div class="row-actions">
      <button class="rename-a" title="Rename">${iconRename()}</button>
      <button class="move-a" title="Move to…">${iconMove()}</button>
      <button class="row-more" title="More">${iconMoreDots()}</button>
      <button class="delete-a" title="Delete">${iconTrash()}</button>
    </div>
  `;
  wireCommonRowEvents(row, node.path, true, name);
  row.querySelector(".name-col").addEventListener("click", (e) => {
    if (selectionCount() > 0) { toggleFolderSelected(node.path); updateSelectionBar(); renderFileList(); return; }
    onNavigateFolder(node.path);
  });
  row.querySelector(".rename-a")?.addEventListener("click", (e) => { e.stopPropagation(); dispatchAction("rename", node.path, true); });
  row.querySelector(".move-a")?.addEventListener("click", (e) => { e.stopPropagation(); dispatchAction("move", node.path, true); });
  row.querySelector(".delete-a")?.addEventListener("click", (e) => { e.stopPropagation(); dispatchAction("delete", node.path, true); });

  // drag target for moving files/folders into this folder
  row.addEventListener("dragover", (e) => { e.preventDefault(); row.classList.add("drop-target"); });
  row.addEventListener("dragleave", () => row.classList.remove("drop-target"));
  row.addEventListener("drop", (e) => {
    e.preventDefault();
    row.classList.remove("drop-target");
    const draggedPath = e.dataTransfer.getData("text/plain");
    if (draggedPath && draggedPath !== node.path) onDropMove(draggedPath, node.path);
  });
  return row;
}

function fileRow(f) {
  const row = document.createElement("div");
  row.className = "frow";
  row.dataset.path = f.path;
  if (state.staged.add.has(f.path) && !state.tree.find((x) => x.path === f.path)) row.classList.add("staged-add");
  const name = f.path.split("/").pop();
  const isImg = isImageFile(f.path);
  const selMode = selectionCount() > 0;

  const stagedEntry = state.staged.add.get(f.path);
  const sizeBytes = stagedEntry?.content ? approxSize(stagedEntry.content) : f.size;
  const verdict = sizeBytes ? sizeVerdict(sizeBytes) : "ok";
  if (verdict !== "ok") row.classList.add("size-warning-row");

  row.draggable = true;
  row.innerHTML = `
    <input type="checkbox" ${isSelected(f.path, false) ? "checked" : ""} style="${selMode ? "" : "display:none"}">
    ${fileIcon(isImg)}
    <div class="name-col">
      <span class="name">${escapeHtml(name)}</span>
      <span class="subtitle">${formatSize(sizeBytes)}${verdict === "warn" ? " · large" : verdict === "block" ? " · too large" : ""}</span>
    </div>
    <span class="size ${verdict !== "ok" ? "size-warn" : ""}">${formatSize(sizeBytes)}</span>
    <div class="row-actions">
      <button class="dl-a" title="Download">${iconDownload()}</button>
      <button class="rename-a" title="Rename">${iconRename()}</button>
      <button class="move-a" title="Move to…">${iconMove()}</button>
      <button class="dup-a" title="Duplicate">${iconDup()}</button>
      <button class="row-more" title="More">${iconMoreDots()}</button>
      <button class="delete-a" title="Delete">${iconTrash()}</button>
    </div>
  `;
  wireCommonRowEvents(row, f.path, false, name);
  row.querySelector(".name-col").addEventListener("click", () => {
    if (selectionCount() > 0) { toggleFileSelected(f.path); updateSelectionBar(); renderFileList(); return; }
    onOpenFile(f.path);
  });
  row.querySelector(".dl-a")?.addEventListener("click", (e) => { e.stopPropagation(); dispatchAction("download", f.path, false); });
  row.querySelector(".rename-a")?.addEventListener("click", (e) => { e.stopPropagation(); dispatchAction("rename", f.path, false); });
  row.querySelector(".move-a")?.addEventListener("click", (e) => { e.stopPropagation(); dispatchAction("move", f.path, false); });
  row.querySelector(".dup-a")?.addEventListener("click", (e) => { e.stopPropagation(); dispatchAction("duplicate", f.path, false); });
  row.querySelector(".delete-a")?.addEventListener("click", (e) => { e.stopPropagation(); dispatchAction("delete", f.path, false); });

  row.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/plain", f.path);
    row.classList.add("dragging");
  });
  row.addEventListener("dragend", () => row.classList.remove("dragging"));

  return row;
}

let actionDispatcher = null;
export function setActionDispatcher(fn) { actionDispatcher = fn; }
function dispatchAction(act, path, isFolder) { if (actionDispatcher) actionDispatcher(act, path, isFolder); }

function wireCommonRowEvents(row, path, isFolder, name) {
  row.querySelector('input[type="checkbox"]').addEventListener("change", () => {
    if (isFolder) toggleFolderSelected(path); else toggleFileSelected(path);
    updateSelectionBar();
    renderFileList();
  });
  row.querySelector(".row-more")?.addEventListener("click", (e) => {
    e.stopPropagation();
    const r = row.getBoundingClientRect();
    openContextMenu(path, isFolder, r.right, r.bottom);
  });
  row.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openContextMenu(path, isFolder, e.clientX, e.clientY);
  });
  // long-press (touch) triggers the same context/action menu
  row.addEventListener("touchstart", (e) => {
    longPressTimer = setTimeout(() => {
      const t = e.touches[0];
      openContextMenu(path, isFolder, t.clientX, t.clientY);
    }, 500);
  }, { passive: true });
  row.addEventListener("touchend", () => clearTimeout(longPressTimer));
  row.addEventListener("touchmove", () => clearTimeout(longPressTimer));
}
