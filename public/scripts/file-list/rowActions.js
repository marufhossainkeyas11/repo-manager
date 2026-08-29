import { $, escapeHtml } from "../utils/dom.js";
import { state } from "../state.js";
import { toast } from "../utils/toast.js";
import { stageRename, stageDelete, stageDuplicate, getFileContentForStaging } from "../staging/stage.js";
import { appendSuffix } from "../utils/format.js";

let onAfterChange = () => {};
export function setAfterChangeHandler(fn) { onAfterChange = fn; }
let downloadSingleFile = () => {};
export function setDownloadHandler(fn) { downloadSingleFile = fn; }
let openMoveDialog = () => {};
export function setMoveDialogHandler(fn) { openMoveDialog = fn; }

export const rowActions = {
  download(path) { downloadSingleFile(path); },

  rename(path, isFolder) {
    // inline-rename: swap the row's name span for a text input; the caller
    // (fileList.js) re-renders after commit, so we just need to locate the
    // live row here.
    const row = document.querySelector(`.frow[data-path="${CSS.escape(path)}"]`);
    if (!row) return;
    const nameCol = row.querySelector(".name-col");
    const nameEl = row.querySelector(".name");
    const oldName = path.split("/").pop();
    const input = document.createElement("input");
    input.type = "text";
    input.className = "rename";
    input.value = oldName;
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    const commit = () => {
      const newName = input.value.trim();
      if (newName && newName !== oldName) {
        const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
        const newPath = parent ? `${parent}/${newName}` : newName;
        if (isFolder) stageRenameFolder(path, newPath);
        else stageRename(path, newPath);
        onAfterChange();
      } else {
        onAfterChange(); // just re-render to restore the span
      }
    };
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") input.blur();
      if (e.key === "Escape") { input.value = oldName; input.blur(); }
    });
  },

  move(path, isFolder) { openMoveDialog([{ path, isFolder }]); },

  duplicate(path) {
    stageDuplicate(path);
    onAfterChange();
  },

  async deleteItem(path, isFolder) {
    if (isFolder) {
      if (!confirm(`Delete folder "${path.split("/").pop()}" and everything inside it?`)) return;
      stageDeleteFolder(path);
    } else {
      stageDelete(path);
    }
    onAfterChange();
  },
};

function stageRenameFolder(oldPrefix, newPrefix) {
  const affected = state.tree.filter((f) => f.path === oldPrefix || f.path.startsWith(oldPrefix + "/"));
  for (const f of affected) {
    const rest = f.path.slice(oldPrefix.length);
    stageRename(f.path, newPrefix + rest);
  }
  // also catch already-staged additions under this folder
  for (const path of [...state.staged.add.keys()]) {
    if (path.startsWith(oldPrefix + "/")) {
      const rest = path.slice(oldPrefix.length);
      const entry = state.staged.add.get(path);
      state.staged.add.delete(path);
      state.staged.add.set(newPrefix + rest, entry);
    }
  }
}

function stageDeleteFolder(prefix) {
  const affected = state.tree.filter((f) => f.path === prefix || f.path.startsWith(prefix + "/"));
  for (const f of affected) stageDelete(f.path);
  for (const path of [...state.staged.add.keys()]) {
    if (path === prefix || path.startsWith(prefix + "/")) state.staged.add.delete(path);
  }
}
