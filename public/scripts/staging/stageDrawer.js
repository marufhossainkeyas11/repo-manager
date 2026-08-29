import { $, escapeHtml } from "../utils/dom.js";
import { state } from "../state.js";
import { computeDiffRows, stagedCount } from "./stage.js";
import { iconWarn } from "../utils/icons.js";
import { sizeVerdict } from "../utils/sizeLimits.js";
import { approxSize } from "../utils/format.js";

let drawerCollapsed = false;
let onRemoveStaged = () => {};
export function setRemoveStagedHandler(fn) { onRemoveStaged = fn; }

export function renderStageDrawer() {
  const rows = computeDiffRows();
  const count = stagedCount();
  const countEl = $("stageCount");
  countEl.textContent = count;
  countEl.classList.toggle("zero", count === 0);

  let adds = 0, dels = 0;
  for (const r of rows) { if (r.type === "add" || r.type === "move") adds++; if (r.type === "del") dels++; }
  $("diffstatAdd").textContent = `+${adds}`;
  $("diffstatDel").textContent = `-${dels}`;

  $("commitBtn").disabled = count === 0;
  $("commitMsg").disabled = count === 0;

  const list = $("stageList");
  if (rows.length === 0) {
    list.innerHTML = `<div class="empty-state" style="padding:14px 0;">No staged changes yet.</div>`;
    return;
  }
  list.innerHTML = rows.map((r) => rowHtml(r)).join("");
  list.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onRemoveStaged(btn.dataset.remove, btn.dataset.removeFrom || null);
    });
  });
}

function rowHtml(r) {
  const cls = r.type === "add" ? "add" : r.type === "del" ? "del" : "move";
  const mark = r.type === "add" ? "+" : r.type === "del" ? "−" : "→";
  let warn = "";
  if (r.type === "add" || r.type === "move") {
    const entry = state.staged.add.get(r.path);
    if (entry && entry.content) {
      const verdict = sizeVerdict(approxSize(entry.content));
      if (verdict !== "ok") warn = `<span class="warn-icon" title="Large file — approaching GitHub's 100MB limit">${iconWarn()}</span>`;
    }
  }
  const pathHtml = r.type === "move"
    ? `${escapeHtml(r.fromPath)}<span class="arrow">→</span>${escapeHtml(r.path)}`
    : escapeHtml(r.path);
  return `
    <div class="diffRow ${cls}">
      <span class="mark">${mark}</span>
      <span class="path">${pathHtml}</span>
      ${warn}
      <span class="remove" data-remove="${escapeHtml(r.path)}" ${r.fromPath ? `data-remove-from="${escapeHtml(r.fromPath)}"` : ""} title="Unstage">×</span>
    </div>
  `;
}

$("stageDrawerHeader").addEventListener("click", () => {
  drawerCollapsed = !drawerCollapsed;
  $("stageList").classList.toggle("collapsed", drawerCollapsed);
  $("stageChev").classList.toggle("collapsed", drawerCollapsed);
});
