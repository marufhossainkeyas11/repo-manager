import { $, escapeHtml } from "../utils/dom.js";
import { state, resetStaged } from "../state.js";
import { api } from "../api.js";
import { toast } from "../utils/toast.js";

// loadTree and closeEditor live in main.js / editor/editor.js respectively —
// set once at boot to avoid circular imports (main.js wires nearly every
// module, so it can't be imported from here).
let loadTreeFn = async () => {};
let closeEditorFn = () => {};
export function setCommitDeps({ loadTree, closeEditor }) {
  loadTreeFn = loadTree;
  closeEditorFn = closeEditor;
}

$("commitBtn").addEventListener("click", async () => {
  const additions = [...state.staged.add.entries()].map(([path, v]) => ({ path, ...v }));
  const deletions = [...state.staged.del];
  if (additions.length === 0 && deletions.length === 0) return toast("Nothing staged to commit.");
  const message = $("commitMsg").value.trim() || `Update ${additions.length} file(s), delete ${deletions.length} file(s)`;
  $("commitBtn").disabled = true;
  try {
    const result = await api("/api/commit", {
      method: "POST",
      body: JSON.stringify({ message, additions, deletions }),
    });
    toast(`Committed: <a href="${result.url}" target="_blank">${result.commitSha.slice(0, 7)}</a>`, "ok");
    resetStaged();
    $("commitMsg").value = "";
    closeEditorFn();
    await loadTreeFn();
  } catch (err) {
    toast("Commit failed: " + err.message, "err");
  } finally {
    $("commitBtn").disabled = false;
  }
});
