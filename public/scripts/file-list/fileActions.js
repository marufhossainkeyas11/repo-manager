import { $, escapeHtml } from "../utils/dom.js";
import { state } from "../state.js";
import { api } from "../api.js";
import { toast } from "../utils/toast.js";
import { stageAdd, stageDelete, stageMove, restageNewFile, afterStagingChange } from "../staging/stagedChanges.js";
import { openPrompt } from "./promptModal.js";
import { navigateTo } from "../tree/breadcrumb.js";

// closeEditor / openFileInEditor live in editor/editor.js — set once at
// boot from main.js to avoid a circular import (editor.js doesn't need
// fileActions.js, but this file needs both editor functions).
let closeEditorFn = () => {};
let openFileInEditorFn = () => {};
export function setEditorFns({ closeEditor, openFileInEditor }) {
  closeEditorFn = closeEditor;
  openFileInEditorFn = openFileInEditor;
}

export function promptMoveFile(oldPath) {
  const filename = oldPath.includes("/") ? oldPath.slice(oldPath.lastIndexOf("/") + 1) : oldPath;
  openPrompt({
    title: "Move to…",
    hint: "Enter the destination folder path (or edit the full path directly).",
    initial: oldPath,
    confirmLabel: "Move",
    onConfirm: (newPath) => {
      newPath = newPath.trim().replace(/^\/+/, "");
      if (newPath && !newPath.endsWith(filename) && !newPath.includes(".") && newPath !== oldPath) {
        newPath = newPath.replace(/\/+$/, "") + "/" + filename;
      }
      if (!newPath || newPath === oldPath) return;
      const f = state.tree.find((x) => x.path === oldPath) || { sha: state.staged.add.get(oldPath)?.sha };
      if (f.sha) {
        stageMove(oldPath, newPath, f.sha);
      } else {
        restageNewFile(oldPath, newPath);
        afterStagingChange();
      }
      toast(`Staged move: <b>${escapeHtml(filename)}</b> → <b>${escapeHtml(newPath)}</b>`);
      if (state.openFile === oldPath) closeEditorFn();
    },
  });
}

export function promptMoveFolder(oldPath) {
  const folderName = oldPath.split("/").pop();
  openPrompt({
    title: "Move folder to…",
    hint: "Enter the new parent path for this folder. Every file inside will be staged as a move.",
    initial: oldPath,
    confirmLabel: "Move",
    onConfirm: (newPath) => {
      newPath = newPath.trim().replace(/^\/+/, "").replace(/\/+$/, "");
      if (newPath && !newPath.endsWith(folderName) && newPath !== oldPath) {
        newPath = newPath + "/" + folderName;
      }
      if (!newPath || newPath === oldPath) return;
      moveFolderContents(oldPath, newPath);
      toast(`Staged folder move: <b>${escapeHtml(oldPath)}</b> → <b>${escapeHtml(newPath)}</b>`);
      if (state.currentFolder === oldPath || state.currentFolder.startsWith(oldPath + "/")) navigateTo(newPath + state.currentFolder.slice(oldPath.length));
    },
  });
}

export function promptRenameFile(oldPath) {
  openPrompt({
    title: "Rename file",
    hint: "Full path within the repo. Moving to a different folder also works — just change the path.",
    initial: oldPath,
    confirmLabel: "Rename",
    onConfirm: (newPath) => {
      newPath = newPath.trim().replace(/^\/+/, "");
      if (!newPath || newPath === oldPath) return;
      const f = state.tree.find((x) => x.path === oldPath) || { sha: state.staged.add.get(oldPath)?.sha };
      if (f.sha) {
        stageMove(oldPath, newPath, f.sha);
      } else {
        restageNewFile(oldPath, newPath);
        afterStagingChange();
      }
      toast(`Staged rename: <b>${escapeHtml(oldPath.split("/").pop())}</b> → <b>${escapeHtml(newPath)}</b>`);
      if (state.openFile === oldPath) closeEditorFn();
    },
  });
}

export function promptRenameFolder(oldPath) {
  openPrompt({
    title: "Rename folder",
    hint: "Every file inside this folder will be staged as a move to the new path.",
    initial: oldPath,
    confirmLabel: "Rename",
    onConfirm: (newPath) => {
      newPath = newPath.trim().replace(/^\/+/, "").replace(/\/+$/, "");
      if (!newPath || newPath === oldPath) return;
      moveFolderContents(oldPath, newPath);
      toast(`Staged folder rename: <b>${escapeHtml(oldPath)}</b> → <b>${escapeHtml(newPath)}</b>`);
      if (state.currentFolder === oldPath || state.currentFolder.startsWith(oldPath + "/")) navigateTo(newPath + state.currentFolder.slice(oldPath.length));
    },
  });
}

// Shared by move + rename for folders: restages every committed file under
// oldPath as a move, and re-keys every not-yet-committed staged file under
// oldPath to the new path.
function moveFolderContents(oldPath, newPath) {
  const affected = state.tree.filter((f) => f.path === oldPath || f.path.startsWith(oldPath + "/"));
  const stagedAffected = [...state.staged.add.keys()].filter((p) => p.startsWith(oldPath + "/"));
  for (const f of affected) {
    if (state.staged.del.has(f.path)) continue;
    const rest = f.path.slice(oldPath.length);
    stageMove(f.path, newPath + rest, f.sha);
  }
  for (const p of stagedAffected) {
    const rest = p.slice(oldPath.length);
    restageNewFile(p, newPath + rest);
  }
  afterStagingChange();
}

export function deleteFolder(path) {
  const affected = state.tree.filter((f) => f.path === path || f.path.startsWith(path + "/"));
  const stagedAffected = [...state.staged.add.keys()].filter((p) => p === path || p.startsWith(path + "/"));
  if (affected.length === 0 && stagedAffected.length === 0) {
    toast("Folder is empty — nothing to stage.");
    return;
  }
  affected.forEach((f) => stageDelete(f.path));
  stagedAffected.forEach((p) => state.staged.add.delete(p));
  afterStagingChange();
  toast(`Staged delete of folder <b>${escapeHtml(path)}</b> (${affected.length + stagedAffected.length} file(s))`);
}

export async function duplicateFile(f) {
  const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/") + 1) : "";
  const base = f.path.split("/").pop();
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : "";
  let newPath = `${dir}${stem} copy${ext}`;
  let n = 2;
  while (state.tree.find((x) => x.path === newPath) || state.staged.add.has(newPath)) {
    newPath = `${dir}${stem} copy ${n}${ext}`;
    n++;
  }
  try {
    if (f.staged) {
      const entry = state.staged.add.get(f.path);
      stageAdd(newPath, { ...entry });
    } else {
      const blob = await api(`/api/blob?sha=${encodeURIComponent(f.sha)}`);
      stageAdd(newPath, { content: blob.content, encoding: blob.encoding || "base64" });
    }
    toast(`Duplicated as <b>${escapeHtml(newPath.split("/").pop())}</b>`);
  } catch (err) {
    toast("Couldn't duplicate: " + err.message, "err");
  }
}

// ---------------- new file / folder ----------------
function closeNewMenu() { $("newMenu").classList.remove("open"); }
export { closeNewMenu };

$("newFolderBtn").addEventListener("click", () => {
  closeNewMenu();
  openPrompt({
    title: "New folder",
    hint: "Git doesn't track empty folders — a small .gitkeep file is added so it shows up after committing.",
    initial: state.currentFolder ? state.currentFolder + "/" : "",
    confirmLabel: "Create",
    onConfirm: (v) => {
      let path = v.trim().replace(/^\/+/, "").replace(/\/+$/, "");
      if (!path) return;
      stageAdd(path + "/.gitkeep", { content: "", encoding: "base64" });
      toast(`Staged new folder <b>${escapeHtml(path)}</b>`);
      navigateTo(path);
    },
  });
});

$("newFileBtn").addEventListener("click", () => {
  closeNewMenu();
  openPrompt({
    title: "New file",
    hint: "Give it a full path and name — it opens in the editor right away.",
    initial: state.currentFolder ? state.currentFolder + "/" : "",
    confirmLabel: "Create",
    onConfirm: (v) => {
      let path = v.trim().replace(/^\/+/, "");
      if (!path) return;
      if (state.tree.find((x) => x.path === path) || state.staged.add.has(path)) {
        toast("A file already exists at that path.", "err");
        return;
      }
      stageAdd(path, { content: "", encoding: "base64" });
      toast(`Created <b>${escapeHtml(path.split("/").pop())}</b>`);
      openFileInEditorFn({ path, staged: true });
    },
  });
});

$("uploadFilesBtn").addEventListener("click", () => { closeNewMenu(); $("fileInput").click(); });

$("newMenuBtn").addEventListener("click", (e) => { e.stopPropagation(); $("newMenu").classList.toggle("open"); });
document.addEventListener("click", (e) => { if (!e.target.closest(".toolbar-menu-wrap")) closeNewMenu(); });
