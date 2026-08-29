import { $ } from "../utils/dom.js";
import { state } from "../state.js";
import { isTabletOrBelow } from "../utils/breakpoints.js";
import { renderSidebar, setNavigateTo } from "./sidebar.js";

// renderFileList lives in file-list/fileList.js — set once at boot to avoid
// a circular import (fileList.js doesn't need breadcrumb.js, but many
// other modules need both).
let renderFileListFn = () => {};
export function setRenderFileList(fn) { renderFileListFn = fn; }

export function renderBreadcrumb() {
  const bar = $("breadcrumbBar");
  bar.innerHTML = "";
  const rootCrumb = document.createElement("span");
  rootCrumb.className = "crumb" + (state.currentFolder === "" ? " current" : "");
  rootCrumb.textContent = state.repoInfo ? state.repoInfo.repo : "root";
  rootCrumb.addEventListener("click", () => navigateTo(""));
  bar.appendChild(rootCrumb);

  if (state.currentFolder) {
    const parts = state.currentFolder.split("/");
    let acc = "";
    for (let i = 0; i < parts.length; i++) {
      acc = acc ? acc + "/" + parts[i] : parts[i];
      const sep = document.createElement("span");
      sep.className = "sep";
      sep.textContent = "/";
      bar.appendChild(sep);
      const c = document.createElement("span");
      c.className = "crumb" + (acc === state.currentFolder ? " current" : "");
      c.textContent = parts[i];
      const target = acc;
      c.addEventListener("click", () => navigateTo(target));
      bar.appendChild(c);
    }
  }
  $("dropzoneTarget").textContent = state.currentFolder ? "/" + state.currentFolder : "the repo root";
  $("dropzoneTarget2").textContent = state.currentFolder ? "/" + state.currentFolder : "the repo root";
}

export function navigateTo(path) {
  state.currentFolder = path;
  // make sure ancestors are expanded so the sidebar reflects where we are
  const parts = path.split("/").filter(Boolean);
  let acc = "";
  for (const p of parts) { acc = acc ? acc + "/" + p : p; state.expanded.add(acc); }
  renderSidebar();
  renderFileListFn();
  renderBreadcrumb();
  if (isTabletOrBelow() && $("treeSidebar").classList.contains("mobile-open")) {
    // history.back() triggers the popstate handler which closes the
    // drawer, keeping the pushState entry from openDrawer() balanced.
    history.back();
  }
}

setNavigateTo(navigateTo);
