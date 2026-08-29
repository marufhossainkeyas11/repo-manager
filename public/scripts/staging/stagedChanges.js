import { state } from "../state.js";
import { buildTreeIndex } from "../tree/treeIndex.js";
import { renderSidebar } from "../tree/sidebar.js";

// renderFileList and renderStage both need to run after every staging
// mutation, but living in file-list/ and staging/stageDrawer.js
// respectively would create circular imports back into this file — set
// once at boot from main.js instead.
let renderFileListFn = () => {};
let renderStageFn = () => {};
export function setStagingRenderers({ renderFileList, renderStage }) {
  renderFileListFn = renderFileList;
  renderStageFn = renderStage;
}

function afterStagingChange() {
  buildTreeIndex();
  renderSidebar();
  renderFileListFn();
  renderStageFn();
}

export function stageAdd(path, entry) {
  state.staged.del.delete(path);
  state.staged.add.set(path, entry);
  afterStagingChange();
}
export function stageDelete(path) {
  state.staged.add.delete(path);
  state.staged.del.add(path);
  afterStagingChange();
}
export function unstage(path, type) {
  if (type === "add") state.staged.add.delete(path);
  else state.staged.del.delete(path);
  afterStagingChange();
}
export function stageMove(oldPath, newPath, sha) {
  stageDelete(oldPath);
  stageAdd(newPath, { sha });
}

// Re-keys a brand-new staged file (no sha yet, so it can't go through
// stageMove) to a new path without touching the tree/sidebar/file-list —
// callers that need those refreshed should call afterStagingChange()
// themselves afterward. Used by rename/move flows for un-committed files.
export function restageNewFile(oldPath, newPath) {
  const entry = state.staged.add.get(oldPath);
  state.staged.add.delete(oldPath);
  state.staged.add.set(newPath, entry);
}

export { afterStagingChange };
