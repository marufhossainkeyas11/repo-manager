import { $, escapeHtml } from "../utils/dom.js";
import { state } from "../state.js";
import { commitStaged, stagedCount } from "./stage.js";
import { toast } from "../utils/toast.js";

let onAfterCommit = () => {};
export function setAfterCommitHandler(fn) { onAfterCommit = fn; }

export function initCommitBar() {
  $("commitBtn").addEventListener("click", async () => {
    if (stagedCount() === 0) return toast("Nothing staged to commit.", "err");
    const additionsCount = state.staged.add.size;
    const deletionsCount = state.staged.del.size;
    const message = $("commitMsg").value.trim() || `Update ${additionsCount} file(s), delete ${deletionsCount} file(s)`;
    $("commitBtn").disabled = true;
    try {
      const result = await commitStaged(message);
      toast(`Committed: <a href="${result.url}" target="_blank">${result.commitSha.slice(0, 7)}</a>`, "ok");
      $("commitMsg").value = "";
      await onAfterCommit();
    } catch (err) {
      toast("Commit failed: " + err.message, "err");
    } finally {
      $("commitBtn").disabled = false;
    }
  });
}
