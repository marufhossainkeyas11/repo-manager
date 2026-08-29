import { $ } from "./dom.js";

function iconX() { return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`; }

// kind: "" (info), "ok", "err", "warn" (amber — used for the 50-100MB
// file-size warning in section 7)
export function toast(msg, kind = "") {
  const el = document.createElement("div");
  el.className = "toast" + (kind ? " " + kind : "");
  const icon = kind === "ok"
    ? '<svg class="toast-icon" width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M20 6 9 17l-5-5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    : kind === "err"
    ? '<svg class="toast-icon" width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/><path d="M12 8v5M12 16h.01" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>'
    : kind === "warn"
    ? '<svg class="toast-icon" width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M12 9v4M12 16.5h.01M10.3 3.9 2.6 17.5a1.8 1.8 0 0 0 1.56 2.7h15.68a1.8 1.8 0 0 0 1.56-2.7L13.7 3.9a1.8 1.8 0 0 0-3.4 0Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>'
    : '<svg class="toast-icon" width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/><path d="M12 11v5M12 8h.01" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
  el.innerHTML = `${icon}<div class="toast-body">${msg}</div><button class="toast-close" title="Dismiss">${iconX()}</button>`;
  $("status").appendChild(el);

  el.querySelector(".toast-close").addEventListener("click", (e) => { e.stopPropagation(); el.remove(); });
  el.addEventListener("click", (e) => {
    if (e.target.closest("a") || e.target.closest(".toast-close")) return;
    el.classList.toggle("collapsed");
  });

  const collapseTimer = setTimeout(() => el.classList.add("collapsed"), 4000);
  const removeTimer = setTimeout(() => el.remove(), 9000);
  el.addEventListener("mouseenter", () => { clearTimeout(collapseTimer); clearTimeout(removeTimer); });
}
