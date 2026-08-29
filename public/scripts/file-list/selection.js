import { $ } from "../utils/dom.js";
import { state } from "../state.js";

export function selectionCount() { return state.selection.files.size + state.selection.folders.size; }

export function clearSelection() {
  state.selection.files.clear();
  state.selection.folders.clear();
}

export function toggleFileSelected(path) {
  if (state.selection.files.has(path)) state.selection.files.delete(path);
  else state.selection.files.add(path);
}
export function toggleFolderSelected(path) {
  if (state.selection.folders.has(path)) state.selection.folders.delete(path);
  else state.selection.folders.add(path);
}

let onSelectionChanged = () => {};
export function setSelectionChangedHandler(fn) { onSelectionChanged = fn; }

function toggleSelectionEntry(path, kind, checked) {
  const set = kind === "folder" ? state.selection.folders : state.selection.files;
  if (checked) set.add(path); else set.delete(path);
}

export function updateSelectAllCheckbox(folders, files) {
  const total = folders.length + files.length;
  const selectedCount = folders.filter((f) => state.selection.folders.has(f.path)).length
    + files.filter((f) => state.selection.files.has(f.path)).length;
  const s = total === 0 ? "none" : selectedCount === 0 ? "none" : selectedCount === total ? "all" : "some";
  for (const id of ["selectAllToggle", "selectionBarAllToggle"]) {
    const el = $(id);
    if (!el) continue;
    el.checked = s === "all";
    el.indeterminate = s === "some";
    el.disabled = total === 0;
  }
}

export function toggleSelectAll(checked, folders, files) {
  for (const f of folders) toggleSelectionEntry(f.path, "folder", checked);
  for (const f of files) toggleSelectionEntry(f.path, "file", checked);
}

export function updateSelectionBar() {
  const count = selectionCount();
  const bar = $("selectionBar");
  const toolbar = $("toolbar");
  bar.classList.toggle("active", count > 0);
  toolbar.classList.toggle("selection-hidden", count > 0);
  $("selBarCount").textContent = `${count} selected`;
  $("bottomNav")?.classList.toggle("selection-hidden", count > 0);
  const wrap = $("downloadSplitWrap");
  if (wrap) wrap.style.display = count > 0 ? "inline-flex" : "none";
  const del = $("deleteSelectedBtn");
  if (del) del.style.display = count > 0 ? "inline-flex" : "none";
  onSelectionChanged(count);
}
