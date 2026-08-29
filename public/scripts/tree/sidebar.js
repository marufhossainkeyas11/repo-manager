import { $, escapeHtml } from "../utils/dom.js";
import { state } from "../state.js";
import { countFilesUnder } from "./treeIndex.js";
import { isMobile } from "../utils/breakpoints.js";

// Set by main.js — navigateTo lives in breadcrumb.js but both modules need
// each other (sidebar click navigates; navigateTo re-renders sidebar), so
// this indirection avoids a circular import.
let onNavigate = () => {};
export function setNavigateHandler(fn) { onNavigate = fn; }
let onDropOnFolder = () => {};
export function setDropHandler(fn) { onDropOnFolder = fn; }
let onCloseDrawer = () => {};
export function setCloseDrawerHandler(fn) { onCloseDrawer = fn; }

export function renderSidebar() {
  const root = $("treeRoot");
  root.innerHTML = "";
  root.appendChild(renderFolderNode(state.treeIndex, 0, true));
}

function folderHasChildren(node) { return node.folders.size > 0; }

function renderFolderNode(node, depth, isRoot) {
  const wrap = document.createElement("div");
  wrap.className = "tnode";

  if (!isRoot) {
    const row = document.createElement("div");
    row.className = "tnode-row" + (state.currentFolder === node.path ? " active" : "");
    row.dataset.path = node.path;
    const hasKids = folderHasChildren(node);
    const isOpen = state.expanded.has(node.path);
    const fileCount = countFilesUnder(node);
    row.innerHTML = `
      <svg class="chev ${hasKids ? (isOpen ? "open" : "") : "spacer"}" width="10" height="10" viewBox="0 0 24 24" fill="none"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <svg class="folder-ic" width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
      <span class="fname">${escapeHtml(node.path.split("/").pop())}</span>
      <span class="fcount">${fileCount}</span>
    `;
    const chevEl = row.querySelector(".chev");
    // Chevron: expand/collapse only, doesn't navigate or close the mobile drawer.
    chevEl.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!hasKids) return;
      toggleExpand(node.path);
      renderSidebar();
    });
    // Name/icon/row: navigate only — predictable, VS-Code-style separation
    // from expand/collapse.
    row.addEventListener("click", () => {
      onNavigate(node.path, { fromSidebarClick: true });
    });
    row.addEventListener("dragover", (e) => { e.preventDefault(); row.classList.add("drop-target"); });
    row.addEventListener("dragleave", () => row.classList.remove("drop-target"));
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      row.classList.remove("drop-target");
      onDropOnFolder(node.path, e.dataTransfer.getData("text/plain"));
    });
    wrap.appendChild(row);
  }

  const childWrap = document.createElement("div");
  childWrap.className = "tnode-children" + (!isRoot && !state.expanded.has(node.path) ? " collapsed" : "");
  const sortedFolders = [...node.folders.values()].sort((a, b) => a.path.localeCompare(b.path));
  for (const child of sortedFolders) {
    childWrap.appendChild(renderFolderNode(child, depth + 1, false));
  }
  if (isRoot || state.expanded.has(node.path)) wrap.appendChild(childWrap);
  return wrap;
}

export function toggleExpand(path) {
  if (state.expanded.has(path)) state.expanded.delete(path);
  else state.expanded.add(path);
}

export function closeSidebarDrawerIfMobile() {
  if (isMobile() && $("treeSidebar").classList.contains("mobile-open")) {
    onCloseDrawer();
  }
}
