import { $ } from "../utils/dom.js";
import { TABLET_MAX } from "../utils/breakpoints.js";

const PANEL_WIDTH_KEY = "rm_panel_widths";
function loadPanelWidths() {
  try { return JSON.parse(localStorage.getItem(PANEL_WIDTH_KEY)) || {}; }
  catch { return {}; }
}
function savePanelWidths(widths) {
  try { localStorage.setItem(PANEL_WIDTH_KEY, JSON.stringify(widths)); } catch { /* ignore quota errors */ }
}
function applyStoredPanelWidths() {
  if (window.innerWidth <= TABLET_MAX) return; // resizing is desktop-only; mobile/tablet use fixed/full-width panels
  const widths = loadPanelWidths();
  if (widths.sidebar) $("treeSidebar").style.width = widths.sidebar + "px";
  if (widths.editor) $("editorPanel").style.width = widths.editor + "px";
}

function makeResizable(handle, panel, { min, max, invert }) {
  let dragging = false;
  let startX = 0;
  let startWidth = 0;
  handle.addEventListener("mousedown", (e) => {
    if (window.innerWidth <= TABLET_MAX) return; // handles are hidden here anyway, but guard regardless
    dragging = true;
    handle.classList.add("dragging");
    startX = e.clientX;
    startWidth = panel.getBoundingClientRect().width;
    document.body.style.userSelect = "none";
    e.preventDefault();
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    let newWidth = invert ? startWidth - dx : startWidth + dx;
    newWidth = Math.max(min, Math.min(max, newWidth));
    panel.style.width = newWidth + "px";
  });
  window.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove("dragging");
    document.body.style.userSelect = "";
    const widths = loadPanelWidths();
    widths[panel.id === "treeSidebar" ? "sidebar" : "editor"] = Math.round(panel.getBoundingClientRect().width);
    savePanelWidths(widths);
  });
}

export function initResizablePanels() {
  makeResizable($("sidebarResizeHandle"), $("treeSidebar"), { min: 160, max: 480, invert: false });
  makeResizable($("editorResizeHandle"), $("editorPanel"), { min: 320, max: 900, invert: true });
  applyStoredPanelWidths();
  window.addEventListener("resize", () => { if (window.innerWidth > TABLET_MAX) applyStoredPanelWidths(); });
}
