import { $, escapeHtml } from "../utils/dom.js";
import { state } from "../state.js";
import { renderSidebar, closeSidebarDrawerIfMobile } from "./sidebar.js";

let onFolderChanged = () => {};
export function setFolderChangedHandler(fn) { onFolderChanged = fn; }

export function renderBreadcrumb() {
  const bar = $("breadcrumbBar");
  bar.innerHTML = "";
  const parts = state.currentFolder ? state.currentFolder.split("/") : [];

  const rootCrumb = document.createElement("span");
  rootCrumb.className = "crumb" + (parts.length === 0 ? " current" : "");
  rootCrumb.textContent = "root";
  rootCrumb.addEventListener("click", () => navigateTo(""));
  bar.appendChild(rootCrumb);

  let acc = "";
  parts.forEach((part, i) => {
    acc = acc ? `${acc}/${part}` : part;
    const sep = document.createElement("span");
    sep.className = "sep";
    sep.textContent = "/";
    bar.appendChild(sep);
    const crumb = document.createElement("span");
    crumb.className = "crumb" + (i === parts.length - 1 ? " current" : "");
    crumb.textContent = part;
    const target = acc;
    crumb.addEventListener("click", () => navigateTo(target));
    bar.appendChild(crumb);
  });
}

export function navigateTo(path, opts = {}) {
  state.currentFolder = path;
  // expand every ancestor so the sidebar shows the active path
  let acc = "";
  for (const seg of path.split("/").filter(Boolean)) {
    acc = acc ? `${acc}/${seg}` : seg;
    state.expanded.add(acc);
  }
  renderBreadcrumb();
  renderSidebar();
  onFolderChanged();
  if (opts.fromSidebarClick) closeSidebarDrawerIfMobile();
}
