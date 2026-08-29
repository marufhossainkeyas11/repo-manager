import { $, escapeHtml } from "../utils/dom.js";
import { iconDownload, iconRename, iconMove, iconDup, iconTrash } from "../utils/icons.js";
import { isMobile } from "../utils/breakpoints.js";

// Row actions are provided by file-list/rowActions.js at init time to avoid
// a circular import (rowActions needs to open this menu; this menu calls
// back into rowActions).
let actions = null;
export function setRowActions(a) { actions = a; }

let currentTarget = null; // { path, isFolder }

export function openContextMenu(path, isFolder, x, y) {
  currentTarget = { path, isFolder };
  if (isMobile()) {
    openMobileActionSheet(path, isFolder);
    return;
  }
  const menu = $("rowContextMenu");
  menu.innerHTML = menuItemsHtml(isFolder);
  menu.classList.add("open");
  const rect = menu.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  menu.style.left = Math.min(x, vw - rect.width - 8) + "px";
  menu.style.top = Math.min(y, vh - rect.height - 8) + "px";
  wireMenuButtons(menu);
}

function menuItemsHtml(isFolder) {
  return `
    ${!isFolder ? `<button data-act="download">${iconDownload()} Download</button>` : ""}
    <button data-act="rename">${iconRename()} Rename</button>
    <button data-act="move">${iconMove()} Move to…</button>
    ${!isFolder ? `<button data-act="duplicate">${iconDup()} Duplicate</button>` : ""}
    <hr>
    <button data-act="delete" class="danger-item">${iconTrash()} Delete</button>
  `;
}

function wireMenuButtons(container) {
  container.querySelectorAll("button[data-act]").forEach((btn) => {
    btn.onclick = () => {
      const act = btn.dataset.act;
      closeContextMenu();
      dispatch(act);
    };
  });
}

function dispatch(act) {
  if (!currentTarget || !actions) return;
  const { path, isFolder } = currentTarget;
  if (act === "download") actions.download(path);
  if (act === "rename") actions.rename(path, isFolder);
  if (act === "move") actions.move(path, isFolder);
  if (act === "duplicate") actions.duplicate(path);
  if (act === "delete") actions.deleteItem(path, isFolder);
}

export function closeContextMenu() {
  $("rowContextMenu").classList.remove("open");
}

document.addEventListener("click", (e) => {
  if (!e.target.closest("#rowContextMenu")) closeContextMenu();
});

// ---------- mobile bottom-sheet variant ----------
function openMobileActionSheet(path, isFolder) {
  const backdrop = $("rowSheetBackdrop");
  const sheet = $("rowSheet");
  sheet.innerHTML = `<div class="sheet-handle"></div>` + menuItemsHtml(isFolder);
  wireMenuButtons(sheet);
  backdrop.classList.add("open");
}
$("rowSheetBackdrop").addEventListener("click", (e) => {
  if (e.target === $("rowSheetBackdrop")) $("rowSheetBackdrop").classList.remove("open");
});
