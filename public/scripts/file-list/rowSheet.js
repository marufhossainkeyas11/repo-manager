import { $, escapeHtml } from "../utils/dom.js";
import { state } from "../state.js";
import { toast } from "../utils/toast.js";
import { iconRename, iconMove, iconDup, iconTrash, iconDownload } from "./icons.js";
import { promptRenameFile, promptRenameFolder, promptMoveFile, promptMoveFolder, duplicateFile, deleteFolder } from "./fileActions.js";
import { stageDelete } from "../staging/stagedChanges.js";

// Section 4.2: mobile/touch equivalent of contextMenu.js — a bottom sheet
// instead of a position-anchored floating menu, since floating menus
// aren't reliably reachable by thumb on a phone.
export function openRowSheet(path, kind) {
  const isFile = kind === "file";
  $("rowSheetTitle").textContent = path;
  const body = $("rowSheet");
  const existing = body.querySelector(".sheet-actions");
  if (existing) existing.remove();

  const actions = document.createElement("div");
  actions.className = "sheet-actions";
  actions.innerHTML = isFile
    ? `
      <button id="sheetRename">${iconRename()} Rename</button>
      <button id="sheetMove">${iconMove()} Move to…</button>
      <button id="sheetDup">${iconDup()} Duplicate</button>
      <button id="sheetDownload">${iconDownload()} Download as .zip</button>
      <hr />
      <button id="sheetDelete" class="danger-item">${iconTrash()} Delete</button>
    `
    : `
      <button id="sheetRename">${iconRename()} Rename</button>
      <button id="sheetMove">${iconMove()} Move to…</button>
      <button id="sheetDownload">${iconDownload()} Download as .zip</button>
      <hr />
      <button id="sheetDelete" class="danger-item">${iconTrash()} Delete folder</button>
    `;
  body.appendChild(actions);

  actions.querySelector("#sheetRename").addEventListener("click", () => {
    closeRowSheet();
    isFile ? promptRenameFile(path) : promptRenameFolder(path);
  });
  actions.querySelector("#sheetMove").addEventListener("click", () => {
    closeRowSheet();
    isFile ? promptMoveFile(path) : promptMoveFolder(path);
  });
  if (isFile) {
    actions.querySelector("#sheetDup").addEventListener("click", () => {
      closeRowSheet();
      const f = state.tree.find((x) => x.path === path) || { path, staged: state.staged.add.has(path) };
      duplicateFile(f);
    });
  }
  actions.querySelector("#sheetDownload").addEventListener("click", () => {
    closeRowSheet();
    const prevSelection = state.selection;
    state.selection = isFile ? { files: new Set([path]), folders: new Set() } : { files: new Set(), folders: new Set([path]) };
    $("downloadSelectedBtn").click();
    state.selection = prevSelection;
  });
  actions.querySelector("#sheetDelete").addEventListener("click", () => {
    closeRowSheet();
    if (isFile) { stageDelete(path); toast(`Staged delete: <b>${escapeHtml(path.split("/").pop())}</b>`); }
    else deleteFolder(path);
  });

  $("rowSheetBackdrop").classList.add("open");
}
export function closeRowSheet() { $("rowSheetBackdrop").classList.remove("open"); }
$("rowSheetBackdrop").addEventListener("click", (e) => { if (e.target === $("rowSheetBackdrop")) closeRowSheet(); });
