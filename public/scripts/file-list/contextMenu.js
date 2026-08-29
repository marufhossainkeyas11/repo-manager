import { $ } from "../utils/dom.js";
import { state } from "../state.js";
import { toast } from "../utils/toast.js";
import { escapeHtml } from "../utils/dom.js";
import { iconRename, iconMove, iconDup, iconTrash, iconDownload } from "./icons.js";
import { promptRenameFile, promptRenameFolder, promptMoveFile, promptMoveFolder, duplicateFile, deleteFolder } from "./fileActions.js";
import { stageDelete } from "../staging/stagedChanges.js";

export function openContextMenu(x, y, path, kind) {
  const menu = $("rowContextMenu");
  const isFile = kind === "file";
  menu.innerHTML = isFile
    ? `
      <button id="ctxRename">${iconRename()} Rename</button>
      <button id="ctxMove">${iconMove()} Move to…</button>
      <button id="ctxDup">${iconDup()} Duplicate</button>
      <button id="ctxDownload">${iconDownload()} Download as .zip</button>
      <hr />
      <button id="ctxDelete" class="danger-item">${iconTrash()} Delete</button>
    `
    : `
      <button id="ctxRename">${iconRename()} Rename</button>
      <button id="ctxMove">${iconMove()} Move to…</button>
      <button id="ctxDownload">${iconDownload()} Download as .zip</button>
      <hr />
      <button id="ctxDelete" class="danger-item">${iconTrash()} Delete folder</button>
    `;

  menu.querySelector("#ctxRename").addEventListener("click", () => {
    closeContextMenu();
    isFile ? promptRenameFile(path) : promptRenameFolder(path);
  });
  menu.querySelector("#ctxMove").addEventListener("click", () => {
    closeContextMenu();
    isFile ? promptMoveFile(path) : promptMoveFolder(path);
  });
  if (isFile) {
    menu.querySelector("#ctxDup").addEventListener("click", () => {
      closeContextMenu();
      const f = state.tree.find((x) => x.path === path) || { path, staged: state.staged.add.has(path) };
      duplicateFile(f);
    });
  }
  menu.querySelector("#ctxDownload").addEventListener("click", () => {
    closeContextMenu();
    // reuse the existing selection-based zip flow: select just this one item, zip it, restore prior selection
    const prevSelection = state.selection;
    state.selection = isFile ? { files: new Set([path]), folders: new Set() } : { files: new Set(), folders: new Set([path]) };
    $("downloadSelectedBtn").click();
    state.selection = prevSelection;
  });
  menu.querySelector("#ctxDelete").addEventListener("click", () => {
    closeContextMenu();
    if (isFile) { stageDelete(path); toast(`Staged delete: <b>${escapeHtml(path.split("/").pop())}</b>`); }
    else deleteFolder(path);
  });

  // position, keeping the menu on-screen
  menu.style.left = "0px"; menu.style.top = "0px"; menu.classList.add("open");
  const rect = menu.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - 8;
  const maxY = window.innerHeight - rect.height - 8;
  menu.style.left = Math.min(x, maxX) + "px";
  menu.style.top = Math.min(y, maxY) + "px";
}
export function closeContextMenu() { $("rowContextMenu").classList.remove("open"); }
document.addEventListener("click", closeContextMenu);
document.addEventListener("contextmenu", (e) => { if (!e.target.closest(".frow")) closeContextMenu(); });
window.addEventListener("scroll", closeContextMenu, true);
window.addEventListener("resize", closeContextMenu);
