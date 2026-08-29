import { $, escapeHtml, escapeAttr } from "../utils/dom.js";
import { state } from "../state.js";
import { unstage } from "./stagedChanges.js";
import { MAX_WARN_BYTES } from "../zip/fileLimitCheck.js";
import { approxSize } from "../utils/base64.js";

export function renderStage() {
  const list = $("stageList");
  const moves = new Map(); // detect add+del pairs that share a sha as "moves" for nicer display
  const shaToDel = new Map();
  for (const p of state.staged.del) {
    const orig = state.tree.find((x) => x.path === p);
    if (orig) shaToDel.set(orig.sha, p);
  }
  const addEntries = [];
  for (const [path, entry] of state.staged.add) {
    if (entry.sha && shaToDel.has(entry.sha)) {
      moves.set(shaToDel.get(entry.sha), path);
    } else {
      addEntries.push(path);
    }
  }
  const movedFroms = new Set(moves.keys());
  const delEntries = [...state.staged.del].filter((p) => !movedFroms.has(p));

  const rows = [
    ...[...moves.entries()].map(([from, to]) => ({ type: "move", from, to })),
    ...delEntries.map((path) => ({ type: "del", path })),
    ...addEntries.map((path) => ({ type: "add", path })),
  ].sort((a, b) => (a.path || a.from).localeCompare(b.path || b.from));

  $("stageCount").textContent = String(rows.length);
  $("stageCount").classList.toggle("zero", rows.length === 0);
  const addCount = addEntries.length, delCount = delEntries.length, moveCount = moves.size;
  $("diffstat").innerHTML = rows.length
    ? [addCount ? `<span class="add">+${addCount}</span>` : "", delCount ? `<span class="del">−${delCount}</span>` : "", moveCount ? `<span>⇄${moveCount}</span>` : ""].filter(Boolean).join("")
    : "";

  if (rows.length === 0) {
    list.innerHTML = '<div class="empty-state">Nothing staged yet — edits, uploads, deletes, and moves will queue up here.</div>';
    return;
  }
  list.innerHTML = "";
  for (const r of rows) {
    const row = document.createElement("div");
    row.className = "diffRow " + r.type;
    // Amber warning icon (section 7.2) for any staged addition between
    // 50-100MB — same threshold the toast used when it was first staged.
    const warnPath = r.type === "add" ? r.path : r.type === "move" ? r.to : null;
    const entry = warnPath ? state.staged.add.get(warnPath) : null;
    const isWarnSize = entry && entry.content && approxSize(entry.content) >= MAX_WARN_BYTES;
    const warnIcon = isWarnSize ? '<span class="warn-icon" title="Large file (50MB+)">⚠</span>' : "";
    if (r.type === "move") {
      row.innerHTML = `<span class="mark">⇄</span>${warnIcon}<span class="path">${escapeHtml(r.from)}<span class="arrow">→</span>${escapeHtml(r.to)}</span><span class="remove" data-from="${escapeAttr(r.from)}" data-to="${escapeAttr(r.to)}" data-type="move">✕</span>`;
    } else {
      row.innerHTML = `<span class="mark">${r.type === "add" ? "+" : "−"}</span>${warnIcon}<span class="path">${escapeHtml(r.path)}</span><span class="remove" data-path="${escapeAttr(r.path)}" data-type="${r.type}">✕</span>`;
    }
    list.appendChild(row);
  }
  list.querySelectorAll(".remove").forEach((el) => {
    el.addEventListener("click", () => {
      if (el.dataset.type === "move") {
        unstage(el.dataset.from, "del");
        unstage(el.dataset.to, "add");
      } else {
        unstage(el.dataset.path, el.dataset.type);
      }
    });
  });
}

// ---------------- stage drawer collapse ----------------
let stageCollapsed = false;
$("stageDrawerHeader").addEventListener("click", () => {
  stageCollapsed = !stageCollapsed;
  $("stageList").classList.toggle("collapsed", stageCollapsed);
  $("stageChev").classList.toggle("collapsed", stageCollapsed);
});
