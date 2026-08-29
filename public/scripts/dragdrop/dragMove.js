import { escapeHtml } from "../utils/dom.js";
import { state } from "../state.js";
import { toast } from "../utils/toast.js";
import { stageMove, restageNewFile, afterStagingChange } from "../staging/stagedChanges.js";

// Desktop-only (section 4.2: touch screens don't get reliable native drag
// events, so mobile/tablet always use the explicit "Move to…" button
// instead — this module is simply never wired to touch handlers).
export function handleDropOnFolder(targetFolder, dataStr) {
  if (!dataStr) return;
  let data;
  try { data = JSON.parse(dataStr); } catch { return; }
  if (data.kind === "file") {
    const oldPath = data.path;
    const name = oldPath.split("/").pop();
    const newPath = targetFolder ? `${targetFolder}/${name}` : name;
    if (newPath === oldPath) return;
    const f = state.tree.find((x) => x.path === oldPath) || {};
    const sha = f.sha || state.staged.add.get(oldPath)?.sha;
    if (sha) {
      stageMove(oldPath, newPath, sha);
    } else {
      restageNewFile(oldPath, newPath);
      afterStagingChange();
    }
    toast(`Moved <b>${escapeHtml(name)}</b> → <b>${escapeHtml(targetFolder || "/")}</b>`);
  } else if (data.kind === "folder") {
    const oldPath = data.path;
    if (targetFolder === oldPath || targetFolder.startsWith(oldPath + "/")) {
      toast("Can't move a folder into itself.", "err");
      return;
    }
    const name = oldPath.split("/").pop();
    const newPath = targetFolder ? `${targetFolder}/${name}` : name;
    const affected = state.tree.filter((f) => f.path === oldPath || f.path.startsWith(oldPath + "/"));
    affected.forEach((f) => { if (!state.staged.del.has(f.path)) stageMove(f.path, newPath + f.path.slice(oldPath.length), f.sha); });
    toast(`Moved folder <b>${escapeHtml(name)}</b> → <b>${escapeHtml(targetFolder || "/")}</b>`);
  }
}
