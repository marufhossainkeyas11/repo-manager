import { $, escapeHtml } from "../utils/dom.js";
import { state } from "../state.js";
import { stageRename } from "../staging/stage.js";
import { toast } from "../utils/toast.js";

let onAfterMove = () => {};
export function setAfterMoveHandler(fn) { onAfterMove = fn; }

function moveFolderRecursive(oldPrefix, newPrefix) {
  const affected = state.tree.filter((f) => f.path === oldPrefix || f.path.startsWith(oldPrefix + "/"));
  for (const f of affected) stageRename(f.path, newPrefix + f.path.slice(oldPrefix.length));
  for (const path of [...state.staged.add.keys()]) {
    if (path.startsWith(oldPrefix + "/")) {
      const entry = state.staged.add.get(path);
      state.staged.add.delete(path);
      state.staged.add.set(newPrefix + path.slice(oldPrefix.length), entry);
    }
  }
}

export function moveItemToFolder(path, destFolder, isFolder) {
  const name = path.split("/").pop();
  const newPath = destFolder ? `${destFolder}/${name}` : name;
  if (newPath === path) return;
  if (isFolder) moveFolderRecursive(path, newPath);
  else stageRename(path, newPath);
  onAfterMove();
  toast(`Moved to ${destFolder || "root"}`, "ok");
}

// Simple prompt-based "Move to…" — lightweight and dependency-free, good
// enough for a power-user tool. items: [{path, isFolder}]
export function openMoveDialog(items) {
  const label = items.length === 1 ? items[0].path.split("/").pop() : `${items.length} items`;
  const dest = prompt(`Move "${label}" to which folder? (leave blank for root)`, state.currentFolder || "");
  if (dest === null) return;
  const cleaned = dest.trim().replace(/^\/+|\/+$/g, "");
  for (const { path, isFolder } of items) moveItemToFolder(path, cleaned, isFolder);
}
