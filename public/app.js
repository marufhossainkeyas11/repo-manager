import { unzipSync, zipSync } from "https://cdn.jsdelivr.net/npm/fflate@0.8.2/+esm";

const $ = (id) => document.getElementById(id);

// ---------------- state ----------------
const REMEMBER_KEY = "rm_pw_remember"; // localStorage: password persisted across browser restarts, opt-in
let PW = sessionStorage.getItem("rm_pw") || localStorage.getItem(REMEMBER_KEY) || "";
let tree = [];                 // flat list from /api/tree: [{path, sha, size}]
let treeIndex = null;          // nested folder structure built from `tree`
let staged = { add: new Map(), del: new Set() }; // add: path -> {content?,sha?,encoding}, del: set of paths
let currentFolder = "";        // "" = root
let expanded = new Set([""]);  // expanded folder paths in the sidebar
let openFile = null;           // path of file currently open in the editor
let repoInfo = null;
let selection = { files: new Set(), folders: new Set() }; // persists across folder navigation

const TEXT_EXT = new Set(["js","jsx","ts","tsx","json","jsonc","md","markdown","txt","css","scss","html","htm","xml","yml","yaml","toml","ini","env","sh","bash","py","rb","go","rs","c","h","cpp","hpp","java","kt","swift","php","sql","graphql","vue","svelte","lock","gitignore","gitattributes","editorconfig","csv","log"]);
const IMAGE_EXT = new Set(["png","jpg","jpeg","gif","webp","svg","bmp","ico"]);

function extOf(path) {
  const base = path.split("/").pop();
  if (base.startsWith(".") && !base.includes(".", 1)) return base.slice(1).toLowerCase(); // dotfiles like .gitignore
  const i = base.lastIndexOf(".");
  return i === -1 ? "" : base.slice(i + 1).toLowerCase();
}
function isTextFile(path) { return TEXT_EXT.has(extOf(path)); }
function isImageFile(path) { return IMAGE_EXT.has(extOf(path)); }

// ---------------- lockout (client-side UX speed bump only) ----------------
const LOCK_KEY = "rm_lock";
function getLockState() {
  try { return JSON.parse(localStorage.getItem(LOCK_KEY) || "null") || { fails: 0, until: 0 }; }
  catch { return { fails: 0, until: 0 }; }
}
function setLockState(s) { localStorage.setItem(LOCK_KEY, JSON.stringify(s)); }
function registerFailedAttempt() {
  const s = getLockState();
  s.fails += 1;
  if (s.fails >= 3) {
    const delaySeconds = Math.min(30 * 2 ** (s.fails - 3), 300);
    s.until = Date.now() + delaySeconds * 1000;
  }
  setLockState(s);
  return s;
}
function clearLockState() { setLockState({ fails: 0, until: 0 }); }
function lockRemainingMs() { return Math.max(0, getLockState().until - Date.now()); }

// ---------------- toast ----------------
function toast(msg, kind = "") {
  const el = document.createElement("div");
  el.className = "toast" + (kind ? " " + kind : "");
  const icon = kind === "ok"
    ? '<svg class="toast-icon" width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M20 6 9 17l-5-5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    : kind === "err"
    ? '<svg class="toast-icon" width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/><path d="M12 8v5M12 16h.01" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>'
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
function iconX() { return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`; }

// ---------------- api ----------------
async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: {
      "Authorization": "Bearer " + PW,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  if (res.status === 401) {
    sessionStorage.removeItem("rm_pw");
    localStorage.removeItem(REMEMBER_KEY);
    showLogin();
    throw new Error("Unauthorized");
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

// ---------------- login flow ----------------
function showLogin() {
  $("login").style.display = "flex";
  $("app").style.display = "none";
  updateLockoutUI();
  loadLoginMeta();
}

// Unauthenticated — called as soon as the login screen is shown, before
// any password is entered. Populates the repo tag, or hides it entirely
// if the admin turned off "show repo on login" in Settings.
async function loadLoginMeta() {
  const tag = $("loginRepoTag");
  try {
    const res = await fetch("/api/meta");
    const meta = await res.json();
    if (meta.hidden || !meta.owner) {
      tag.style.display = "none";
      return;
    }
    tag.textContent = `${meta.owner}/${meta.repo}`;
    tag.style.display = "inline-flex";
  } catch {
    tag.style.display = "none";
  }
}

async function showApp() {
  $("login").style.display = "none";
  $("app").style.display = "flex";
  await loadTree();
  loadRepoInfo();
}

async function loadRepoInfo() {
  try {
    repoInfo = await api("/api/repo");
    $("repoPill").innerHTML = `<span class="repo-pill-inner"><b>${escapeHtml(repoInfo.repo)}</b></span><span class="branch-badge">⎇ ${escapeHtml(repoInfo.branch)}</span>`;
    $("rmActiveName").textContent = `${repoInfo.owner}/${repoInfo.repo}`;
    $("rmActiveBranch").textContent = `⎇ ${repoInfo.branch}`;
    $("rmActiveVisibility").textContent = repoInfo.private ? "Private" : "Public";
    $("rmActiveVisibility").classList.toggle("private", Boolean(repoInfo.private));
    $("rmActiveLink").href = repoInfo.htmlUrl || "#";
  } catch {
    // non-fatal — repo pill just stays blank
  }
}

async function loadTree() {
  const data = await api("/api/tree");
  tree = data.files;
  buildTreeIndex();
  renderSidebar();
  renderFileList();
  renderBreadcrumb();
}

// ---------------- folder index ----------------
function buildTreeIndex() {
  const root = { path: "", folders: new Map(), files: [] };
  for (const f of tree) {
    if (staged.del.has(f.path)) continue;
    const parts = f.path.split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      const p = parts.slice(0, i + 1).join("/");
      if (!node.folders.has(seg)) node.folders.set(seg, { path: p, folders: new Map(), files: [] });
      node = node.folders.get(seg);
    }
    node.files.push(f);
  }
  // fold in staged additions so new/renamed/moved files show up before commit
  for (const [path, entry] of staged.add) {
    const parts = path.split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      const p = parts.slice(0, i + 1).join("/");
      if (!node.folders.has(seg)) node.folders.set(seg, { path: p, folders: new Map(), files: [] });
      node = node.folders.get(seg);
    }
    if (!node.files.find((x) => x.path === path)) {
      node.files.push({ path, sha: entry.sha || null, size: entry.content ? approxSize(entry.content) : 0, staged: true });
    }
  }
  treeIndex = root;
}
function approxSize(base64) { return Math.floor((base64.length * 3) / 4); }

function findFolder(path) {
  if (!path) return treeIndex;
  const parts = path.split("/");
  let node = treeIndex;
  for (const seg of parts) {
    if (!node.folders.has(seg)) return null;
    node = node.folders.get(seg);
  }
  return node;
}

// ---------------- sidebar tree ----------------
function renderSidebar() {
  const root = $("treeRoot");
  root.innerHTML = "";
  root.appendChild(renderFolderNode(treeIndex, 0, true));
}

function folderHasChildren(node) { return node.folders.size > 0; }

function renderFolderNode(node, depth, isRoot) {
  const wrap = document.createElement("div");
  wrap.className = "tnode";

  if (!isRoot) {
    const row = document.createElement("div");
    row.className = "tnode-row" + (currentFolder === node.path ? " active" : "");
    row.dataset.path = node.path;
    const hasKids = folderHasChildren(node);
    const isOpen = expanded.has(node.path);
    row.innerHTML = `
      <svg class="chev ${hasKids ? (isOpen ? "open" : "") : "spacer"}" width="10" height="10" viewBox="0 0 24 24" fill="none"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <svg class="folder-ic" width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
      <span class="fname">${escapeHtml(node.path.split("/").pop())}</span>
    `;
    const chevEl = row.querySelector(".chev");
    function closeDrawerIfMobile() {
      if (window.innerWidth <= 760 && $("treeSidebar").classList.contains("mobile-open")) {
        history.back();
      }
    }
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
      currentFolder = node.path;
      renderSidebar();
      renderFileList();
      renderBreadcrumb();
      closeDrawerIfMobile();
    });
    row.addEventListener("dragover", (e) => { e.preventDefault(); row.classList.add("drop-target"); });
    row.addEventListener("dragleave", () => row.classList.remove("drop-target"));
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      row.classList.remove("drop-target");
      handleDropOnFolder(node.path, e.dataTransfer.getData("text/plain"));
    });
    wrap.appendChild(row);
  }

  const childWrap = document.createElement("div");
  childWrap.className = "tnode-children" + (!isRoot && !expanded.has(node.path) ? " collapsed" : "");
  const sortedFolders = [...node.folders.values()].sort((a, b) => a.path.localeCompare(b.path));
  for (const child of sortedFolders) {
    childWrap.appendChild(renderFolderNode(child, depth + 1, false));
  }
  if (isRoot || expanded.has(node.path)) wrap.appendChild(childWrap);
  return wrap;
}

function toggleExpand(path) {
  if (expanded.has(path)) expanded.delete(path);
  else expanded.add(path);
}

// ---------------- breadcrumb ----------------
function renderBreadcrumb() {
  const bar = $("breadcrumbBar");
  bar.innerHTML = "";
  const rootCrumb = document.createElement("span");
  rootCrumb.className = "crumb" + (currentFolder === "" ? " current" : "");
  rootCrumb.textContent = repoInfo ? repoInfo.repo : "root";
  rootCrumb.addEventListener("click", () => navigateTo(""));
  bar.appendChild(rootCrumb);

  if (currentFolder) {
    const parts = currentFolder.split("/");
    let acc = "";
    for (let i = 0; i < parts.length; i++) {
      acc = acc ? acc + "/" + parts[i] : parts[i];
      const sep = document.createElement("span");
      sep.className = "sep";
      sep.textContent = "/";
      bar.appendChild(sep);
      const c = document.createElement("span");
      c.className = "crumb" + (acc === currentFolder ? " current" : "");
      c.textContent = parts[i];
      const target = acc;
      c.addEventListener("click", () => navigateTo(target));
      bar.appendChild(c);
    }
  }
  $("dropzoneTarget").textContent = currentFolder ? "/" + currentFolder : "the repo root";
}

function navigateTo(path) {
  currentFolder = path;
  // make sure ancestors are expanded so the sidebar reflects where we are
  const parts = path.split("/").filter(Boolean);
  let acc = "";
  for (const p of parts) { acc = acc ? acc + "/" + p : p; expanded.add(acc); }
  renderSidebar();
  renderFileList();
  renderBreadcrumb();
  if (window.innerWidth <= 760 && $("treeSidebar").classList.contains("mobile-open")) {
    // history.back() triggers the popstate handler which closes the
    // drawer, keeping the pushState entry from openDrawer() balanced.
    history.back();
  }
}

// ---------------- file list ----------------
let lastClickedPath = null; // for shift-click range selection (desktop)

function renderFileList() {
  const node = findFolder(currentFolder);
  const list = $("fileList");
  list.innerHTML = "";

  if (!node) { list.innerHTML = '<div class="empty-state">Folder not found — it may have just been removed.</div>'; updateSelectionToolbar(); return; }

  const filter = $("search").value.trim().toLowerCase();
  const folders = [...node.folders.values()]
    .filter((f) => f.path.split("/").pop().toLowerCase().includes(filter))
    .sort((a, b) => a.path.localeCompare(b.path));
  const files = node.files
    .filter((f) => f.path.split("/").pop().toLowerCase().includes(filter))
    .sort((a, b) => a.path.localeCompare(b.path));

  if (folders.length === 0 && files.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="big">📁</div>${filter ? "No matches in this folder." : "This folder is empty. Create a file or drop something in."}</div>`;
    updateSelectionToolbar();
    return;
  }

  for (const f of folders) {
    const row = document.createElement("div");
    row.className = "frow";
    row.draggable = true;
    row.innerHTML = `
      <input type="checkbox" data-path="${escapeAttr(f.path)}" data-kind="folder" class="sel" />
      <svg class="ftype-ic folder" width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
      <span class="name">${escapeHtml(f.path.split("/").pop())}</span>
      <span class="size"></span>
      <div class="row-actions">
        <button class="rename-a" title="Rename">${iconRename()}</button>
        <button class="move-a" title="Move to…">${iconMove()}</button>
        <button class="danger delete-a" title="Delete folder">${iconTrash()}</button>
      </div>
    `;
    row.querySelector(".sel").checked = selection.folders.has(f.path);
    row.addEventListener("click", (e) => { if (e.target.closest(".row-actions") || e.target.classList.contains("sel")) return; navigateTo(f.path); });
    row.querySelector(".rename-a").addEventListener("click", (e) => { e.stopPropagation(); promptRenameFolder(f.path); });
    row.querySelector(".move-a").addEventListener("click", (e) => { e.stopPropagation(); promptMoveFolder(f.path); });
    row.querySelector(".delete-a").addEventListener("click", (e) => { e.stopPropagation(); deleteFolder(f.path); });
    row.querySelector(".sel").addEventListener("click", (e) => handleSelClick(e, f.path, "folder"));
    row.querySelector(".sel").addEventListener("change", (e) => { toggleSelection(f.path, "folder", e.target.checked); });
    row.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", JSON.stringify({ kind: "folder", path: f.path })); row.classList.add("dragging"); });
    row.addEventListener("dragend", () => row.classList.remove("dragging"));
    row.addEventListener("dragover", (e) => { e.preventDefault(); row.classList.add("drop-target"); });
    row.addEventListener("dragleave", () => row.classList.remove("drop-target"));
    row.addEventListener("drop", (e) => {
      e.preventDefault(); e.stopPropagation();
      row.classList.remove("drop-target");
      handleDropOnFolder(f.path, e.dataTransfer.getData("text/plain"));
    });
    row.addEventListener("contextmenu", (e) => { e.preventDefault(); openContextMenu(e.clientX, e.clientY, f.path, "folder"); });
    list.appendChild(row);
  }

  for (const f of files) {
    const row = document.createElement("div");
    const isStagedAdd = staged.add.has(f.path);
    const isStagedDel = staged.del.has(f.path);
    row.className = "frow" + (isStagedAdd ? " staged-add" : "") + (isStagedDel ? " staged-del" : "");
    row.draggable = true;
    row.innerHTML = `
      <input type="checkbox" data-path="${escapeAttr(f.path)}" data-kind="file" class="sel" />
      ${fileIcon(f.path)}
      <span class="name">${escapeHtml(f.path.split("/").pop())}</span>
      <span class="size">${formatSize(f.size)}</span>
      <div class="row-actions">
        <button class="rename-a" title="Rename">${iconRename()}</button>
        <button class="move-a" title="Move to…">${iconMove()}</button>
        <button class="dup-a" title="Duplicate">${iconDup()}</button>
        <button class="danger delete-a" title="Delete">${iconTrash()}</button>
      </div>
    `;
    row.querySelector(".sel").checked = selection.files.has(f.path);
    row.addEventListener("click", (e) => { if (e.target.closest(".row-actions") || e.target.classList.contains("sel")) return; openFileInEditor(f); });
    row.querySelector(".rename-a").addEventListener("click", (e) => { e.stopPropagation(); promptRenameFile(f.path); });
    row.querySelector(".move-a").addEventListener("click", (e) => { e.stopPropagation(); promptMoveFile(f.path); });
    row.querySelector(".dup-a").addEventListener("click", (e) => { e.stopPropagation(); duplicateFile(f); });
    row.querySelector(".delete-a").addEventListener("click", (e) => { e.stopPropagation(); stageDelete(f.path); toast(`Staged delete: <b>${escapeHtml(f.path.split("/").pop())}</b>`); });
    row.querySelector(".sel").addEventListener("click", (e) => handleSelClick(e, f.path, "file"));
    row.querySelector(".sel").addEventListener("change", (e) => { toggleSelection(f.path, "file", e.target.checked); });
    row.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", JSON.stringify({ kind: "file", path: f.path })); row.classList.add("dragging"); });
    row.addEventListener("dragend", () => row.classList.remove("dragging"));
    row.addEventListener("contextmenu", (e) => { e.preventDefault(); openContextMenu(e.clientX, e.clientY, f.path, "file"); });
    list.appendChild(row);
  }

  updateSelectAllCheckbox(folders, files);
  updateSelectionToolbar();
}

// ---------------- right-click context menu (desktop) ----------------
function openContextMenu(x, y, path, kind) {
  const menu = $("rowContextMenu");
  const isFile = kind === "file";
  menu.innerHTML = isFile
    ? `
      <button id="ctxRename">${iconRename()} Rename</button>
      <button id="ctxMove">${iconMove()} Move to…</button>
      <button id="ctxDup">${iconDup()} Duplicate</button>
      <button id="ctxDownload">${iconDownload()} Download as .zip</button>
      <hr />
      <button id="ctxDelete" class="danger-item">${iconTrash()} Delete</button>
    `
    : `
      <button id="ctxRename">${iconRename()} Rename</button>
      <button id="ctxMove">${iconMove()} Move to…</button>
      <button id="ctxDownload">${iconDownload()} Download as .zip</button>
      <hr />
      <button id="ctxDelete" class="danger-item">${iconTrash()} Delete folder</button>
    `;

  menu.querySelector("#ctxRename").addEventListener("click", () => {
    closeContextMenu();
    isFile ? promptRenameFile(path) : promptRenameFolder(path);
  });
  menu.querySelector("#ctxMove").addEventListener("click", () => {
    closeContextMenu();
    isFile ? promptMoveFile(path) : promptMoveFolder(path);
  });
  if (isFile) {
    menu.querySelector("#ctxDup").addEventListener("click", () => {
      closeContextMenu();
      const f = tree.find((x) => x.path === path) || { path, staged: staged.add.has(path) };
      duplicateFile(f);
    });
  }
  menu.querySelector("#ctxDownload").addEventListener("click", () => {
    closeContextMenu();
    // reuse the existing selection-based zip flow: select just this one item, zip it, restore prior selection
    const prevSelection = selection;
    selection = isFile ? { files: new Set([path]), folders: new Set() } : { files: new Set(), folders: new Set([path]) };
    $("downloadSelectedBtn").click();
    selection = prevSelection;
  });
  menu.querySelector("#ctxDelete").addEventListener("click", () => {
    closeContextMenu();
    if (isFile) { stageDelete(path); toast(`Staged delete: <b>${escapeHtml(path.split("/").pop())}</b>`); }
    else deleteFolder(path);
  });

  // position, keeping the menu on-screen
  menu.style.left = "0px"; menu.style.top = "0px"; menu.classList.add("open");
  const rect = menu.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - 8;
  const maxY = window.innerHeight - rect.height - 8;
  menu.style.left = Math.min(x, maxX) + "px";
  menu.style.top = Math.min(y, maxY) + "px";
}
function closeContextMenu() { $("rowContextMenu").classList.remove("open"); }
document.addEventListener("click", closeContextMenu);
document.addEventListener("contextmenu", (e) => { if (!e.target.closest(".frow")) closeContextMenu(); });
window.addEventListener("scroll", closeContextMenu, true);
window.addEventListener("resize", closeContextMenu);
function iconDownload() { return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M12 4v12M7 11l5 5 5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 20h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`; }

// Shift-click = range select, Ctrl/Cmd-click = toggle individual without
// disturbing others (native checkbox click already toggles individually,
// so this only needs to special-case the range case and record the anchor).
function handleSelClick(e, path, kind) {
  const currentListOrder = [...$("fileList").querySelectorAll(".sel")].map((el) => ({ path: el.dataset.path, kind: el.dataset.kind }));
  if (e.shiftKey && lastClickedPath) {
    e.preventDefault();
    const fromIdx = currentListOrder.findIndex((x) => x.path === lastClickedPath);
    const toIdx = currentListOrder.findIndex((x) => x.path === path);
    if (fromIdx !== -1 && toIdx !== -1) {
      const [lo, hi] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
      for (let i = lo; i <= hi; i++) {
        toggleSelection(currentListOrder[i].path, currentListOrder[i].kind, true);
      }
      renderFileList();
    }
    return;
  }
  lastClickedPath = path;
}

function toggleSelection(path, kind, checked) {
  const set = kind === "folder" ? selection.folders : selection.files;
  if (checked) set.add(path); else set.delete(path);
}

function updateSelectAllCheckbox(folders, files) {
  const total = folders.length + files.length;
  const selectedCount = folders.filter((f) => selection.folders.has(f.path)).length
    + files.filter((f) => selection.files.has(f.path)).length;
  const state = total === 0 ? "none" : selectedCount === 0 ? "none" : selectedCount === total ? "all" : "some";
  for (const id of ["selectAllToggle", "selectionBarAllToggle"]) {
    const el = $(id);
    if (!el) continue;
    el.checked = state === "all";
    el.indeterminate = state === "some";
    el.disabled = total === 0;
  }
}

function currentVisibleEntries() {
  const node = findFolder(currentFolder);
  if (!node) return { folders: [], files: [] };
  const filter = $("search").value.trim().toLowerCase();
  const folders = [...node.folders.values()].filter((f) => f.path.split("/").pop().toLowerCase().includes(filter));
  const files = node.files.filter((f) => f.path.split("/").pop().toLowerCase().includes(filter));
  return { folders, files };
}

function toggleSelectAll(checked) {
  const { folders, files } = currentVisibleEntries();
  for (const f of folders) toggleSelection(f.path, "folder", checked);
  for (const f of files) toggleSelection(f.path, "file", checked);
  renderFileList();
}
$("selectAllToggle").addEventListener("change", (e) => toggleSelectAll(e.target.checked));
$("selectionBarAllToggle").addEventListener("change", (e) => toggleSelectAll(e.target.checked));

function clearSelection() {
  selection = { files: new Set(), folders: new Set() };
  renderFileList();
}
$("selBarClearBtn").addEventListener("click", clearSelection);

function selectionCount() { return selection.files.size + selection.folders.size; }

function updateSelectionToolbar() {
  const any = selectionCount() > 0;
  $("deleteSelectedBtn").style.display = any ? "inline-flex" : "none";
  $("downloadSelectedBtn").style.display = any ? "inline-flex" : "none";
  // mobile: swap the normal toolbar for a compact selection bar
  const isMobile = window.innerWidth <= 760;
  $("selectionBar").classList.toggle("active", isMobile && any);
  $("toolbar").classList.toggle("selection-hidden", isMobile && any);
  $("selectionCount").textContent = `${selectionCount()} selected`;
}
window.addEventListener("resize", updateSelectionToolbar);
$("selBarZipBtn").addEventListener("click", () => $("downloadSelectedBtn").click());
$("selBarDeleteBtn").addEventListener("click", () => $("deleteSelectedBtn").click());

function fileIcon(path) {
  if (isImageFile(path)) return `<svg class="ftype-ic image" width="15" height="15" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="1.8"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/><path d="M21 15l-5-5L5 21" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
  return `<svg class="ftype-ic file" width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-6-5Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M13 3v5h6" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
}
function iconRename() { return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M12 20h9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`; }
function iconMove() { return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M10 13h6M13 10l3 3-3 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`; }
function iconDup() { return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" stroke="currentColor" stroke-width="1.8"/></svg>`; }
function iconTrash() { return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6h12Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`; }

// ---------------- staging ----------------
function stageAdd(path, entry) {
  staged.del.delete(path);
  staged.add.set(path, entry);
  buildTreeIndex();
  renderSidebar();
  renderFileList();
  renderStage();
}
function stageDelete(path) {
  staged.add.delete(path);
  staged.del.add(path);
  buildTreeIndex();
  renderSidebar();
  renderFileList();
  renderStage();
}
function unstage(path, type) {
  if (type === "add") staged.add.delete(path);
  else staged.del.delete(path);
  buildTreeIndex();
  renderSidebar();
  renderFileList();
  renderStage();
}

function stageMove(oldPath, newPath, sha) {
  stageDelete(oldPath);
  stageAdd(newPath, { sha });
}

function renderStage() {
  const list = $("stageList");
  const moves = new Map(); // detect add+del pairs that share a sha as "moves" for nicer display
  const shaToDel = new Map();
  for (const p of staged.del) {
    const orig = tree.find((x) => x.path === p);
    if (orig) shaToDel.set(orig.sha, p);
  }
  const addEntries = [];
  for (const [path, entry] of staged.add) {
    if (entry.sha && shaToDel.has(entry.sha)) {
      moves.set(shaToDel.get(entry.sha), path);
    } else {
      addEntries.push(path);
    }
  }
  const movedFroms = new Set(moves.keys());
  const delEntries = [...staged.del].filter((p) => !movedFroms.has(p));

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
    if (r.type === "move") {
      row.innerHTML = `<span class="mark">⇄</span><span class="path">${escapeHtml(r.from)}<span class="arrow">→</span>${escapeHtml(r.to)}</span><span class="remove" data-from="${escapeAttr(r.from)}" data-to="${escapeAttr(r.to)}" data-type="move">✕</span>`;
    } else {
      row.innerHTML = `<span class="mark">${r.type === "add" ? "+" : "−"}</span><span class="path">${escapeHtml(r.path)}</span><span class="remove" data-path="${escapeAttr(r.path)}" data-type="${r.type}">✕</span>`;
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

// ---------------- rename / duplicate / delete-folder ----------------
// "Move to…" is the same underlying operation as rename (both just stage
// the file/folder at a new path) — this variant frames the prompt around
// picking a destination folder rather than renaming, and pre-selects just
// the folder portion of the path so typing a destination is fast.
function promptMoveFile(oldPath) {
  const filename = oldPath.includes("/") ? oldPath.slice(oldPath.lastIndexOf("/") + 1) : oldPath;
  openPrompt({
    title: "Move to…",
    hint: "Enter the destination folder path (or edit the full path directly).",
    initial: oldPath,
    confirmLabel: "Move",
    onConfirm: (newPath) => {
      newPath = newPath.trim().replace(/^\/+/, "");
      // if they typed a folder path without the filename, append it
      if (newPath && !newPath.endsWith(filename) && !newPath.includes(".") && newPath !== oldPath) {
        newPath = newPath.replace(/\/+$/, "") + "/" + filename;
      }
      if (!newPath || newPath === oldPath) return;
      const f = tree.find((x) => x.path === oldPath) || { sha: staged.add.get(oldPath)?.sha };
      if (f.sha) {
        stageMove(oldPath, newPath, f.sha);
      } else {
        const entry = staged.add.get(oldPath);
        staged.add.delete(oldPath);
        staged.add.set(newPath, entry);
        buildTreeIndex(); renderSidebar(); renderFileList(); renderStage();
      }
      toast(`Staged move: <b>${escapeHtml(filename)}</b> → <b>${escapeHtml(newPath)}</b>`);
      if (openFile === oldPath) closeEditor();
    },
  });
}

function promptMoveFolder(oldPath) {
  const folderName = oldPath.split("/").pop();
  openPrompt({
    title: "Move folder to…",
    hint: "Enter the new parent path for this folder. Every file inside will be staged as a move.",
    initial: oldPath,
    confirmLabel: "Move",
    onConfirm: (newPath) => {
      newPath = newPath.trim().replace(/^\/+/, "").replace(/\/+$/, "");
      if (newPath && !newPath.endsWith(folderName) && newPath !== oldPath) {
        newPath = newPath + "/" + folderName;
      }
      if (!newPath || newPath === oldPath) return;
      const affected = tree.filter((f) => f.path === oldPath || f.path.startsWith(oldPath + "/"));
      const stagedAffected = [...staged.add.keys()].filter((p) => p.startsWith(oldPath + "/"));
      for (const f of affected) {
        if (staged.del.has(f.path)) continue;
        const rest = f.path.slice(oldPath.length);
        stageMove(f.path, newPath + rest, f.sha);
      }
      for (const p of stagedAffected) {
        const rest = p.slice(oldPath.length);
        const entry = staged.add.get(p);
        staged.add.delete(p);
        staged.add.set(newPath + rest, entry);
      }
      buildTreeIndex(); renderSidebar(); renderFileList(); renderStage();
      toast(`Staged folder move: <b>${escapeHtml(oldPath)}</b> → <b>${escapeHtml(newPath)}</b>`);
      if (currentFolder === oldPath || currentFolder.startsWith(oldPath + "/")) navigateTo(newPath + currentFolder.slice(oldPath.length));
    },
  });
}

function promptRenameFile(oldPath) {
  openPrompt({
    title: "Rename file",
    hint: "Full path within the repo. Moving to a different folder also works — just change the path.",
    initial: oldPath,
    confirmLabel: "Rename",
    onConfirm: (newPath) => {
      newPath = newPath.trim().replace(/^\/+/, "");
      if (!newPath || newPath === oldPath) return;
      const f = tree.find((x) => x.path === oldPath) || { sha: staged.add.get(oldPath)?.sha };
      if (f.sha) {
        stageMove(oldPath, newPath, f.sha);
      } else {
        // it's a brand-new staged file without a sha yet — just re-key it
        const entry = staged.add.get(oldPath);
        staged.add.delete(oldPath);
        staged.add.set(newPath, entry);
        buildTreeIndex(); renderSidebar(); renderFileList(); renderStage();
      }
      toast(`Staged rename: <b>${escapeHtml(oldPath.split("/").pop())}</b> → <b>${escapeHtml(newPath)}</b>`);
      if (openFile === oldPath) closeEditor();
    },
  });
}

function promptRenameFolder(oldPath) {
  openPrompt({
    title: "Rename folder",
    hint: "Every file inside this folder will be staged as a move to the new path.",
    initial: oldPath,
    confirmLabel: "Rename",
    onConfirm: (newPath) => {
      newPath = newPath.trim().replace(/^\/+/, "").replace(/\/+$/, "");
      if (!newPath || newPath === oldPath) return;
      const affected = tree.filter((f) => f.path === oldPath || f.path.startsWith(oldPath + "/"));
      const stagedAffected = [...staged.add.keys()].filter((p) => p.startsWith(oldPath + "/"));
      for (const f of affected) {
        if (staged.del.has(f.path)) continue;
        const rest = f.path.slice(oldPath.length);
        stageMove(f.path, newPath + rest, f.sha);
      }
      for (const p of stagedAffected) {
        const rest = p.slice(oldPath.length);
        const entry = staged.add.get(p);
        staged.add.delete(p);
        staged.add.set(newPath + rest, entry);
      }
      buildTreeIndex(); renderSidebar(); renderFileList(); renderStage();
      toast(`Staged folder rename: <b>${escapeHtml(oldPath)}</b> → <b>${escapeHtml(newPath)}</b>`);
      if (currentFolder === oldPath || currentFolder.startsWith(oldPath + "/")) navigateTo(newPath + currentFolder.slice(oldPath.length));
    },
  });
}

function deleteFolder(path) {
  const affected = tree.filter((f) => f.path === path || f.path.startsWith(path + "/"));
  const stagedAffected = [...staged.add.keys()].filter((p) => p === path || p.startsWith(path + "/"));
  if (affected.length === 0 && stagedAffected.length === 0) {
    toast("Folder is empty — nothing to stage.");
    return;
  }
  affected.forEach((f) => stageDelete(f.path));
  stagedAffected.forEach((p) => staged.add.delete(p));
  buildTreeIndex(); renderSidebar(); renderFileList(); renderStage();
  toast(`Staged delete of folder <b>${escapeHtml(path)}</b> (${affected.length + stagedAffected.length} file(s))`);
}

async function duplicateFile(f) {
  const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/") + 1) : "";
  const base = f.path.split("/").pop();
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : "";
  let newPath = `${dir}${stem} copy${ext}`;
  let n = 2;
  while (tree.find((x) => x.path === newPath) || staged.add.has(newPath)) {
    newPath = `${dir}${stem} copy ${n}${ext}`;
    n++;
  }
  try {
    if (f.staged) {
      const entry = staged.add.get(f.path);
      stageAdd(newPath, { ...entry });
    } else {
      const blob = await api(`/api/blob?sha=${encodeURIComponent(f.sha)}`);
      stageAdd(newPath, { content: blob.content, encoding: blob.encoding || "base64" });
    }
    toast(`Duplicated as <b>${escapeHtml(newPath.split("/").pop())}</b>`);
  } catch (err) {
    toast("Couldn't duplicate: " + err.message, "err");
  }
}

// Resolves the current selection (files + folders) down to a flat list of
// { path, zipPath } — loose files zip at root by filename; folder
// selections keep their folder name as a wrapper dir with the relative
// structure inside, which is standard "compress a folder" behavior.
function resolveSelectionToFiles() {
  const results = [];
  const seen = new Set();

  function allFilesUnder(folderPath) {
    // tree + staged additions, prefix-matched; staged deletions excluded
    const out = [];
    for (const f of tree) {
      if (staged.del.has(f.path)) continue;
      if (f.path === folderPath || f.path.startsWith(folderPath + "/")) out.push(f.path);
    }
    for (const p of staged.add.keys()) {
      if (p === folderPath || p.startsWith(folderPath + "/")) out.push(p);
    }
    return [...new Set(out)];
  }

  for (const path of selection.files) {
    if (staged.del.has(path)) continue;
    if (seen.has(path)) continue;
    seen.add(path);
    const name = path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path;
    results.push({ path, zipPath: name });
  }
  for (const folderPath of selection.folders) {
    const folderName = folderPath.split("/").pop();
    for (const filePath of allFilesUnder(folderPath)) {
      if (seen.has(filePath)) continue;
      seen.add(filePath);
      const rest = filePath.slice(folderPath.length); // includes leading "/"
      results.push({ path: filePath, zipPath: folderName + rest });
    }
  }
  return results;
}

async function confirmLargeSelection(count, verb) {
  if (count < 20) return true;
  return new Promise((resolve) => {
    openPrompt({
      title: "Large selection",
      hint: `${count} files affected. ${verb} cannot be easily undone once committed. Continue?`,
      initial: "",
      confirmLabel: "Continue",
      hideInput: true,
      onConfirm: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}

$("deleteSelectedBtn").addEventListener("click", async () => {
  if (selectionCount() === 0) return toast("Select some files first.");
  const resolved = resolveSelectionToFiles();
  if (resolved.length === 0) return toast("Nothing to delete in the current selection.");
  const ok = await confirmLargeSelection(resolved.length, "Deleting");
  if (!ok) return;
  resolved.forEach((r) => stageDelete(r.path));
  clearSelection();
});

// Small concurrency-limited fetch pool, mirroring the server's
// mapWithConcurrency pattern — keeps the zip responsive with live progress
// instead of firing all blob fetches at once.
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

$("downloadSelectedBtn").addEventListener("click", async () => {
  if (selectionCount() === 0) return toast("Select some files first.");
  const resolved = resolveSelectionToFiles();
  if (resolved.length === 0) return toast("Nothing to zip in the current selection.");
  const ok = await confirmLargeSelection(resolved.length, "Zipping");
  if (!ok) return;

  $("downloadSelectedBtn").disabled = true;
  const btn = $("downloadSelectedBtn");
  let done = 0;
  btn.textContent = `Zipping 0/${resolved.length}…`;
  try {
    const zipEntries = {};
    const usedNames = new Set(); // dedupe only applies to root-level loose files
    await mapWithConcurrency(resolved, 5, async (r) => {
      let bytes;
      const staged_ = staged.add.get(r.path);
      if (staged_) {
        bytes = base64ToBytes(staged_.content);
      } else {
        const f = tree.find((x) => x.path === r.path);
        if (!f) { done++; btn.textContent = `Zipping ${done}/${resolved.length}…`; return; }
        const blob = await api(`/api/blob?sha=${encodeURIComponent(f.sha)}`);
        bytes = base64ToBytes(blob.content.replace(/\n/g, ""));
      }
      let finalZipPath = r.zipPath;
      if (!finalZipPath.includes("/")) {
        // loose root file — dedupe by filename same as before
        let n = 2;
        while (usedNames.has(finalZipPath)) { finalZipPath = appendSuffix(r.zipPath, n); n++; }
        usedNames.add(finalZipPath);
      }
      zipEntries[finalZipPath] = bytes;
      done++;
      btn.textContent = `Zipping ${done}/${resolved.length}…`;
    });
    const zipped = zipSync(zipEntries);
    const blob = new Blob([zipped], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const folderName = currentFolder ? currentFolder.split("/").pop() : (repoInfo ? repoInfo.repo : "files");
    a.href = url;
    a.download = `${folderName}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast(`Downloaded <b>${resolved.length}</b> file(s) as <b>${escapeHtml(folderName)}.zip</b>`, "ok");
  } catch (err) {
    toast("Couldn't build the zip: " + err.message, "err");
  } finally {
    $("downloadSelectedBtn").disabled = false;
    $("downloadSelectedBtn").textContent = "Download as .zip";
  }
});

function appendSuffix(name, n) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
}

// ---------------- drag & drop move ----------------
function handleDropOnFolder(targetFolder, dataStr) {
  if (!dataStr) return;
  let data;
  try { data = JSON.parse(dataStr); } catch { return; }
  if (data.kind === "file") {
    const oldPath = data.path;
    const name = oldPath.split("/").pop();
    const newPath = targetFolder ? `${targetFolder}/${name}` : name;
    if (newPath === oldPath) return;
    const f = tree.find((x) => x.path === oldPath) || {};
    const sha = f.sha || staged.add.get(oldPath)?.sha;
    if (sha) {
      stageMove(oldPath, newPath, sha);
    } else {
      const entry = staged.add.get(oldPath);
      staged.add.delete(oldPath);
      staged.add.set(newPath, entry);
      buildTreeIndex(); renderSidebar(); renderFileList(); renderStage();
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
    const affected = tree.filter((f) => f.path === oldPath || f.path.startsWith(oldPath + "/"));
    affected.forEach((f) => { if (!staged.del.has(f.path)) stageMove(f.path, newPath + f.path.slice(oldPath.length), f.sha); });
    toast(`Moved folder <b>${escapeHtml(name)}</b> → <b>${escapeHtml(targetFolder || "/")}</b>`);
  }
}

// ---------------- new file / folder prompts ----------------
// Doubles as a generic confirm dialog when hideInput is set (used for the
// "large selection" confirms) — same modal, input just isn't shown/used.
let promptState = null;
function openPrompt({ title, hint, initial, confirmLabel, onConfirm, onCancel, hideInput }) {
  $("promptTitle").textContent = title;
  $("promptHint").textContent = hint || "";
  $("promptInput").value = initial || "";
  $("promptInput").style.display = hideInput ? "none" : "";
  $("promptConfirm").textContent = confirmLabel || "Create";
  promptState = { onConfirm, onCancel, hideInput };
  $("promptBackdrop").classList.add("open");
  if (!hideInput) setTimeout(() => { $("promptInput").focus(); $("promptInput").select(); }, 30);
}
function closePrompt(cancelled) {
  if (cancelled && promptState && promptState.onCancel) promptState.onCancel();
  $("promptBackdrop").classList.remove("open");
  $("promptInput").style.display = "";
  promptState = null;
}
$("promptCancel").addEventListener("click", () => closePrompt(true));
$("promptBackdrop").addEventListener("click", (e) => { if (e.target === $("promptBackdrop")) closePrompt(true); });
$("promptConfirm").addEventListener("click", () => {
  const v = $("promptInput").value;
  if (promptState) promptState.onConfirm(v);
  closePrompt(false);
});
$("promptInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { $("promptConfirm").click(); }
  if (e.key === "Escape") closePrompt(true);
});

$("newFolderBtn").addEventListener("click", () => {
  closeMenu();
  openPrompt({
    title: "New folder",
    hint: "Git doesn't track empty folders — a small .gitkeep file is added so it shows up after committing.",
    initial: currentFolder ? currentFolder + "/" : "",
    confirmLabel: "Create",
    onConfirm: (v) => {
      let path = v.trim().replace(/^\/+/, "").replace(/\/+$/, "");
      if (!path) return;
      stageAdd(path + "/.gitkeep", { content: "", encoding: "base64" });
      toast(`Staged new folder <b>${escapeHtml(path)}</b>`);
      navigateTo(path);
    },
  });
});

$("newFileBtn").addEventListener("click", () => {
  closeMenu();
  openPrompt({
    title: "New file",
    hint: "Give it a full path and name — it opens in the editor right away.",
    initial: currentFolder ? currentFolder + "/" : "",
    confirmLabel: "Create",
    onConfirm: (v) => {
      let path = v.trim().replace(/^\/+/, "");
      if (!path) return;
      if (tree.find((x) => x.path === path) || staged.add.has(path)) {
        toast("A file already exists at that path.", "err");
        return;
      }
      stageAdd(path, { content: "", encoding: "base64" });
      toast(`Created <b>${escapeHtml(path.split("/").pop())}</b>`);
      openFileInEditor({ path, staged: true });
    },
  });
});

$("uploadFilesBtn").addEventListener("click", () => { closeMenu(); $("fileInput").click(); });

function closeMenu() { $("newMenu").classList.remove("open"); }
$("newMenuBtn").addEventListener("click", (e) => { e.stopPropagation(); $("newMenu").classList.toggle("open"); });
document.addEventListener("click", (e) => { if (!e.target.closest(".toolbar-menu-wrap")) closeMenu(); });

// ---------------- zip / file drop -> extract client-side -> stage as additions ----------------
const dz = $("dropzone");
dz.addEventListener("click", (e) => {
  // Slim (collapsed) state: first click just expands it, so a stray tap
  // while scrolling doesn't accidentally pop the file picker open.
  if (!dz.classList.contains("expanded") && !dz.classList.contains("drag")) {
    dz.classList.add("expanded");
    return;
  }
  $("fileInput").click();
});
["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("drag"); }));
["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("drag"); }));
dz.addEventListener("drop", (e) => handleFiles(e.dataTransfer.files));
document.addEventListener("click", (e) => {
  if (!e.target.closest("#dropzone") && dz.classList.contains("expanded")) dz.classList.remove("expanded");
});
$("fileInput").addEventListener("change", (e) => { handleFiles(e.target.files); e.target.value = ""; });

function joinPath(dir, name) { return dir ? `${dir}/${name}` : name; }

async function handleFiles(fileList) {
  for (const file of fileList) {
    if (file.name.toLowerCase().endsWith(".zip")) {
      await handleZip(file);
    } else {
      const buf = new Uint8Array(await file.arrayBuffer());
      const path = joinPath(currentFolder, file.name);
      stageAdd(path, { content: bytesToBase64(buf), encoding: "base64" });
      toast(`Staged: <b>${escapeHtml(path)}</b>`);
    }
  }
}

// If every entry in the zip lives under one shared top-level folder (a common
// side effect of zipping a folder directly, e.g. on a phone), that wrapper
// folder is stripped so the wrapper's *contents* land directly in the target
// folder — never a copy of the wrapper itself nested inside it.
function stripCommonWrapper(paths) {
  if (paths.length === 0) return null;
  const firstSegs = paths[0].split("/");
  if (firstSegs.length < 2) return null; // first entry is already top-level, nothing to strip
  const candidate = firstSegs[0];
  const allShareIt = paths.every((p) => {
    const segs = p.split("/");
    return segs.length >= 2 && segs[0] === candidate;
  });
  return allShareIt ? candidate : null;
}

async function handleZip(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  let unzipped;
  try {
    unzipped = unzipSync(buf);
  } catch (err) {
    return toast("Couldn't extract zip: " + err.message, "err");
  }
  let entries = Object.entries(unzipped).filter(([path, data]) => !path.endsWith("/") && data.length >= 0);
  if (entries.length === 0) return toast("No files found in that zip.", "err");

  const wrapper = stripCommonWrapper(entries.map(([p]) => p));
  if (wrapper) {
    entries = entries.map(([path, data]) => [path.slice(wrapper.length + 1), data]);
  }

  for (const [path, data] of entries) {
    const targetPath = joinPath(currentFolder, path);
    stageAdd(targetPath, { content: bytesToBase64(data), encoding: "base64" });
  }
  const into = currentFolder || "the repo root";
  toast(wrapper
    ? `Unpacked <b>${entries.length}</b> file(s) from <b>${escapeHtml(wrapper)}/</b> straight into <b>${escapeHtml(into)}</b>`
    : `Unpacked <b>${entries.length}</b> file(s) into <b>${escapeHtml(into)}</b>`);
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
function utf8ToBase64(str) { return bytesToBase64(new TextEncoder().encode(str)); }
function base64ToUtf8(b64) { return new TextDecoder().decode(base64ToBytes(b64)); }

// ---------------- editor / preview ----------------
async function openFileInEditor(f) {
  openFile = f.path;
  closeFindBar();
  $("editorPanel").classList.add("open");
  $("editorResizeHandle").classList.add("visible");
  $("editorName").textContent = f.path;
  $("editorMeta").textContent = formatSize(f.size || 0);
  $("editorStatus").textContent = "";
  $("editorSaveBtn").style.display = "none";
  const body = $("editorBody");
  body.innerHTML = `<div class="no-preview">Loading…</div>`;

  try {
    let base64content;
    if (f.staged) {
      const entry = staged.add.get(f.path);
      base64content = entry.content;
    } else {
      const blob = await api(`/api/blob?sha=${encodeURIComponent(f.sha)}`);
      base64content = blob.content.replace(/\n/g, "");
    }

    if (isImageFile(f.path)) {
      const mime = extOf(f.path) === "svg" ? "image/svg+xml" : `image/${extOf(f.path) === "jpg" ? "jpeg" : extOf(f.path)}`;
      body.innerHTML = `<div class="img-preview"><img src="data:${mime};base64,${base64content}" /></div>`;
    } else if (isTextFile(f.path) || (f.size || 0) < 200000) {
      let text;
      try { text = base64ToUtf8(base64content); }
      catch { text = ""; }
      body.innerHTML = "";
      const ta = document.createElement("textarea");
      ta.spellcheck = false;
      ta.value = text;
      ta.dataset.original = text;
      ta.addEventListener("input", () => {
        $("editorSaveBtn").style.display = ta.value !== ta.dataset.original ? "inline-flex" : "none";
      });
      body.appendChild(ta);
      ta.focus();
    } else {
      body.innerHTML = `<div class="no-preview">${fileIcon(f.path)}<div>No inline preview for this file type.<br/>Download it from GitHub directly, or drag a replacement in to overwrite it.</div></div>`;
    }
  } catch (err) {
    body.innerHTML = `<div class="no-preview">Couldn't load this file: ${escapeHtml(err.message)}</div>`;
  }
}

function closeEditor() {
  openFile = null;
  $("editorPanel").classList.remove("open");
  $("editorResizeHandle").classList.remove("visible");
  $("editorBody").innerHTML = "";
  closeFindBar();
}
$("editorCloseBtn").addEventListener("click", closeEditor);

$("editorSaveBtn").addEventListener("click", () => {
  if (!openFile) return;
  const ta = $("editorBody").querySelector("textarea");
  if (!ta) return;
  const content = utf8ToBase64(ta.value);
  const existing = tree.find((x) => x.path === openFile);
  stageAdd(openFile, { content, encoding: "base64" });
  ta.dataset.original = ta.value;
  $("editorSaveBtn").style.display = "none";
  $("editorStatus").textContent = "Staged — commit to save to GitHub";
  toast(`Staged edit: <b>${escapeHtml(openFile.split("/").pop())}</b>`);
});

// ---------------- editor toolbar: select-all / copy / find ----------------
function currentEditorTextarea() {
  return $("editorBody").querySelector("textarea");
}

function editorSelectAll() {
  const ta = currentEditorTextarea();
  if (!ta) return;
  ta.focus();
  ta.select();
}
$("editorSelectAllBtn").addEventListener("click", editorSelectAll);
$("editorOverflowSelectAll").addEventListener("click", () => { $("editorOverflowMenu").classList.remove("open"); editorSelectAll(); });

async function editorCopy() {
  const ta = currentEditorTextarea();
  if (!ta) return;
  try {
    await navigator.clipboard.writeText(ta.value);
    toast("Copied file contents.", "ok");
  } catch {
    toast("Couldn't copy — your browser may be blocking clipboard access.", "err");
  }
}
$("editorCopyBtn").addEventListener("click", editorCopy);
$("editorOverflowCopy").addEventListener("click", () => { $("editorOverflowMenu").classList.remove("open"); editorCopy(); });

$("editorOverflowBtn").addEventListener("click", (e) => { e.stopPropagation(); $("editorOverflowMenu").classList.toggle("open"); });
document.addEventListener("click", () => $("editorOverflowMenu").classList.remove("open"));

// ---- find in file ----
// Deliberately simple: case-insensitive substring only, no regex. Matches
// are recomputed on every input change; next/prev just walks the list.
let findMatches = [];   // array of start indices into ta.value
let findActiveIdx = -1;

function openFindBar() {
  const ta = currentEditorTextarea();
  if (!ta) return; // no find inside non-text previews (image/binary)
  $("findBar").classList.add("open");
  $("editorFindBtn").classList.add("active");
  $("findInput").focus();
  $("findInput").select();
  runFindSearch();
}
function closeFindBar() {
  $("findBar").classList.remove("open");
  $("editorFindBtn").classList.remove("active");
  $("findInput").value = "";
  findMatches = [];
  findActiveIdx = -1;
  $("findCount").textContent = "";
}
$("editorFindBtn").addEventListener("click", () => {
  if ($("findBar").classList.contains("open")) closeFindBar();
  else openFindBar();
});
$("findCloseBtn").addEventListener("click", closeFindBar);

function runFindSearch() {
  const ta = currentEditorTextarea();
  const q = $("findInput").value;
  findMatches = [];
  findActiveIdx = -1;
  if (!ta || !q) { $("findCount").textContent = ""; updateFindButtons(); return; }
  const haystack = ta.value.toLowerCase();
  const needle = q.toLowerCase();
  let from = 0;
  while (true) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    findMatches.push(idx);
    from = idx + needle.length;
  }
  if (findMatches.length > 0) {
    findActiveIdx = 0;
    goToMatch(0);
  } else {
    $("findCount").textContent = "0/0";
  }
  updateFindButtons();
}
$("findInput").addEventListener("input", runFindSearch);
$("findInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); e.shiftKey ? findStep(-1) : findStep(1); }
  if (e.key === "Escape") closeFindBar();
});

function updateFindButtons() {
  const has = findMatches.length > 0;
  $("findPrevBtn").disabled = !has;
  $("findNextBtn").disabled = !has;
}

function findStep(dir) {
  if (findMatches.length === 0) return;
  findActiveIdx = (findActiveIdx + dir + findMatches.length) % findMatches.length;
  goToMatch(findActiveIdx);
}
$("findPrevBtn").addEventListener("click", () => findStep(-1));
$("findNextBtn").addEventListener("click", () => findStep(1));

function goToMatch(idx) {
  const ta = currentEditorTextarea();
  const q = $("findInput").value;
  if (!ta || !q || findMatches[idx] === undefined) return;
  const start = findMatches[idx];
  const end = start + q.length;
  ta.focus();
  ta.setSelectionRange(start, end);
  // Modern browsers auto-scroll the caret into view from setSelectionRange
  // in most cases; as a fallback (older WebViews), estimate the line by
  // counting newlines up to the match and scroll manually.
  requestAnimationFrame(() => {
    const rect = ta.getBoundingClientRect();
    const stillVisible = ta.selectionStart >= 0; // selection applied
    if (!stillVisible) return;
    const before = ta.value.slice(0, start);
    const line = before.split("\n").length - 1;
    const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 18;
    const approxTop = line * lineHeight;
    if (approxTop < ta.scrollTop || approxTop > ta.scrollTop + ta.clientHeight - lineHeight) {
      ta.scrollTop = Math.max(0, approxTop - ta.clientHeight / 2);
    }
  });
  $("findCount").textContent = `${idx + 1}/${findMatches.length}`;
}

// Ctrl/Cmd+F -> find bar, Ctrl/Cmd+S -> save — only while the editor
// textarea itself is focused, never as a global shortcut.
document.addEventListener("keydown", (e) => {
  const ta = currentEditorTextarea();
  if (!ta || document.activeElement !== ta) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === "f") {
    e.preventDefault();
    openFindBar();
  } else if (mod && e.key.toLowerCase() === "s") {
    e.preventDefault();
    if ($("editorSaveBtn").style.display !== "none") $("editorSaveBtn").click();
  }
});

// ---------------- commit ----------------
$("commitBtn").addEventListener("click", async () => {
  const additions = [...staged.add.entries()].map(([path, v]) => ({ path, ...v }));
  const deletions = [...staged.del];
  if (additions.length === 0 && deletions.length === 0) return toast("Nothing staged to commit.");
  const message = $("commitMsg").value.trim() || `Update ${additions.length} file(s), delete ${deletions.length} file(s)`;
  $("commitBtn").disabled = true;
  try {
    const result = await api("/api/commit", {
      method: "POST",
      body: JSON.stringify({ message, additions, deletions }),
    });
    toast(`Committed: <a href="${result.url}" target="_blank">${result.commitSha.slice(0, 7)}</a>`, "ok");
    staged = { add: new Map(), del: new Set() };
    $("commitMsg").value = "";
    closeEditor();
    await loadTree();
  } catch (err) {
    toast("Commit failed: " + err.message, "err");
  } finally {
    $("commitBtn").disabled = false;
  }
});

// ---------------- stage drawer collapse ----------------
let stageCollapsed = false;
$("stageDrawerHeader").addEventListener("click", () => {
  stageCollapsed = !stageCollapsed;
  $("stageList").classList.toggle("collapsed", stageCollapsed);
  $("stageChev").classList.toggle("collapsed", stageCollapsed);
});

// ---------------- settings modal / repo manager ----------------
let repoRegistry = null; // {active, list, showRepoOnLogin} from /api/repos
let browseResults = [];
let browseDebounceTimer = null;

$("settingsBtn").addEventListener("click", () => {
  $("settingsBackdrop").classList.add("open");
  $("settingsBackdrop").classList.toggle("wide-backdrop", true);
  loadRepoManager();
});
$("settingsClose").addEventListener("click", () => $("settingsBackdrop").classList.remove("open"));
$("settingsBackdrop").addEventListener("click", (e) => { if (e.target === $("settingsBackdrop")) $("settingsBackdrop").classList.remove("open"); });

async function loadRepoManager() {
  try {
    repoRegistry = await api("/api/repos");
    renderRepoList();
    renderShowOnLoginToggle();
  } catch (err) {
    $("rmRepoList").innerHTML = `<div class="rm-repo-row rm-empty">Couldn't load repositories: ${escapeHtml(err.message)}</div>`;
  }
}

function renderRepoList() {
  const list = $("rmRepoList");
  if (!repoRegistry || repoRegistry.list.length === 0) {
    list.innerHTML = '<div class="rm-repo-row rm-empty">No repositories saved yet — add one below.</div>';
    return;
  }
  const activeId = repoRegistry.active ? `${repoRegistry.active.owner}/${repoRegistry.active.repo}` : null;
  list.innerHTML = "";
  for (const r of repoRegistry.list) {
    const isActive = r.id === activeId;
    const row = document.createElement("div");
    row.className = "rm-repo-row";
    row.innerHTML = `
      <div class="rm-repo-info">
        <div class="rm-repo-name">${escapeHtml(r.owner)}/${escapeHtml(r.repo)}</div>
        <div class="rm-repo-branch">⎇ ${escapeHtml(r.branch)}${r.private ? " · Private" : ""}</div>
      </div>
      ${isActive
        ? '<span class="rm-active-pill">● Active</span>'
        : `<button class="btn secondary sm rm-switch-btn">Switch</button>`}
      <button class="rm-remove" title="Remove" ${isActive ? "disabled" : ""}>${iconTrash()}</button>
    `;
    if (!isActive) {
      row.querySelector(".rm-switch-btn").addEventListener("click", () => switchActiveRepo(r.owner, r.repo));
    }
    row.querySelector(".rm-remove").addEventListener("click", () => removeRepo(r.owner, r.repo, isActive));
    list.appendChild(row);
  }
}

async function switchActiveRepo(owner, repo) {
  const pendingCount = staged.add.size + staged.del.size;
  if (pendingCount > 0) {
    const ok = await new Promise((resolve) => {
      openPrompt({
        title: "Discard uncommitted changes?",
        hint: `${pendingCount} uncommitted change(s) will be discarded (nothing has happened on GitHub — none of this was committed). Continue?`,
        confirmLabel: "Switch repo",
        hideInput: true,
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
    if (!ok) return;
  }
  try {
    repoRegistry = await api("/api/repos/active", { method: "PUT", body: JSON.stringify({ owner, repo }) });
    staged = { add: new Map(), del: new Set() };
    clearSelection();
    closeEditor();
    renderRepoList();
    await loadTree();
    await loadRepoInfo();
    toast(`Switched to <b>${escapeHtml(owner)}/${escapeHtml(repo)}</b>`, "ok");
  } catch (err) {
    toast("Couldn't switch repo: " + err.message, "err");
  }
}

async function removeRepo(owner, repo, isActive) {
  if (isActive) return; // button is disabled, but guard anyway
  try {
    repoRegistry = await api(`/api/repos?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`, { method: "DELETE" });
    renderRepoList();
    toast(`Removed <b>${escapeHtml(owner)}/${escapeHtml(repo)}</b> from your list`);
  } catch (err) {
    toast("Couldn't remove repo: " + err.message, "err");
  }
}

// ---- add repository: toggle panel + tabs ----
$("rmAddToggle").addEventListener("click", () => {
  const panel = $("rmAddPanel");
  panel.classList.toggle("open");
  if (panel.classList.contains("open")) $("rmBrowseSearch").focus();
});

function setRmTab(tab) {
  $("rmTabBrowseBtn").classList.toggle("active", tab === "browse");
  $("rmTabManualBtn").classList.toggle("active", tab === "manual");
  $("rmTabBrowse").classList.toggle("active", tab === "browse");
  $("rmTabManual").classList.toggle("active", tab === "manual");
  if (tab === "browse" && browseResults.length === 0) runBrowseSearch("");
}
$("rmTabBrowseBtn").addEventListener("click", () => setRmTab("browse"));
$("rmTabManualBtn").addEventListener("click", () => setRmTab("manual"));

// ---- browse tab ----
$("rmBrowseSearch").addEventListener("input", (e) => {
  clearTimeout(browseDebounceTimer);
  const q = e.target.value.trim();
  browseDebounceTimer = setTimeout(() => runBrowseSearch(q), 300);
});

async function runBrowseSearch(q) {
  $("rmBrowseResults").innerHTML = '<div class="rm-repo-row rm-empty">Searching…</div>';
  try {
    browseResults = await api(`/api/repos/discover?q=${encodeURIComponent(q)}`);
    renderBrowseResults();
  } catch (err) {
    $("rmBrowseResults").innerHTML = `<div class="rm-repo-row rm-empty">${escapeHtml(err.message)}</div>`;
  }
}

function renderBrowseResults() {
  const container = $("rmBrowseResults");
  if (browseResults.length === 0) {
    container.innerHTML = '<div class="rm-repo-row rm-empty">No matching repositories.</div>';
    return;
  }
  const savedIds = new Set((repoRegistry?.list || []).map((r) => r.id));
  container.innerHTML = "";
  for (const r of browseResults) {
    const id = `${r.owner}/${r.repo}`;
    const alreadySaved = savedIds.has(id);
    const row = document.createElement("div");
    row.className = "rm-browse-row";
    row.innerHTML = `
      <div class="rm-repo-info">
        <div class="rm-repo-name">${escapeHtml(r.owner)}/${escapeHtml(r.repo)}${r.private ? " 🔒" : ""}</div>
        <div class="rm-repo-desc">${escapeHtml(r.description || r.defaultBranch || "")}</div>
      </div>
      <button class="btn ${alreadySaved ? "secondary" : "accent"} sm" ${alreadySaved ? "disabled" : ""}>${alreadySaved ? "Added" : "+ Add"}</button>
    `;
    if (!alreadySaved) {
      row.querySelector("button").addEventListener("click", () => addRepo(r.owner, r.repo, r.defaultBranch));
    }
    container.appendChild(row);
  }
}

// ---- manual tab ----
$("rmManualVerifyBtn").addEventListener("click", () => {
  const owner = $("rmManualOwner").value.trim();
  const repo = $("rmManualRepo").value.trim();
  const branch = $("rmManualBranch").value.trim();
  if (!owner || !repo) return toast("Owner and repo are both required.");
  addRepo(owner, repo, branch || undefined);
});

async function addRepo(owner, repo, branch) {
  try {
    repoRegistry = await api("/api/repos", { method: "POST", body: JSON.stringify({ owner, repo, branch }) });
    renderRepoList();
    renderBrowseResults();
    toast(`Added <b>${escapeHtml(owner)}/${escapeHtml(repo)}</b>`, "ok");
    $("rmManualOwner").value = "";
    $("rmManualRepo").value = "";
    $("rmManualBranch").value = "";
  } catch (err) {
    toast("Couldn't add repo: " + err.message, "err");
  }
}

// ---- show-repo-on-login toggle ----
function renderShowOnLoginToggle() {
  const on = repoRegistry ? repoRegistry.showRepoOnLogin !== false : true;
  $("rmShowOnLoginToggle").classList.toggle("on", on);
  $("rmShowOnLoginToggle").setAttribute("aria-checked", String(on));
}
$("rmShowOnLoginToggle").addEventListener("click", async () => {
  const next = !$("rmShowOnLoginToggle").classList.contains("on");
  $("rmShowOnLoginToggle").classList.toggle("on", next); // optimistic
  $("rmShowOnLoginToggle").setAttribute("aria-checked", String(next));
  try {
    repoRegistry = await api("/api/settings", { method: "PUT", body: JSON.stringify({ showRepoOnLogin: next }) });
  } catch (err) {
    renderShowOnLoginToggle(); // revert on failure
    toast("Couldn't save setting: " + err.message, "err");
  }
});

// ---------------- resizable panels (desktop) ----------------
const PANEL_WIDTH_KEY = "rm_panel_widths";
function loadPanelWidths() {
  try { return JSON.parse(localStorage.getItem(PANEL_WIDTH_KEY)) || {}; }
  catch { return {}; }
}
function savePanelWidths(widths) {
  try { localStorage.setItem(PANEL_WIDTH_KEY, JSON.stringify(widths)); } catch { /* ignore quota errors */ }
}
function applyStoredPanelWidths() {
  if (window.innerWidth <= 900) return; // resizing is desktop-only; mobile/tablet use fixed/full-width panels
  const widths = loadPanelWidths();
  if (widths.sidebar) $("treeSidebar").style.width = widths.sidebar + "px";
  if (widths.editor) $("editorPanel").style.width = widths.editor + "px";
}

function makeResizable(handle, panel, { min, max, invert }) {
  let dragging = false;
  let startX = 0;
  let startWidth = 0;
  handle.addEventListener("mousedown", (e) => {
    if (window.innerWidth <= 900) return; // handles are hidden here anyway, but guard regardless
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
makeResizable($("sidebarResizeHandle"), $("treeSidebar"), { min: 160, max: 480, invert: false });
makeResizable($("editorResizeHandle"), $("editorPanel"), { min: 320, max: 900, invert: true });
applyStoredPanelWidths();
window.addEventListener("resize", () => { if (window.innerWidth > 900) applyStoredPanelWidths(); });

// ---------------- refresh ----------------
async function doRefresh() {
  try { await loadTree(); toast("Refreshed."); }
  catch (err) { toast("Couldn't refresh: " + err.message, "err"); }
}
$("refreshBtn").addEventListener("click", doRefresh);

$("search").addEventListener("input", renderFileList);

// ---------------- mobile drawer (tree sidebar) ----------------
function openDrawer() {
  $("treeSidebar").classList.add("mobile-open");
  $("sidebarBackdrop").classList.add("open");
  // Push a history entry so the Android/iOS back gesture closes the
  // drawer instead of leaving the page.
  history.pushState({ rmDrawer: true }, "");
}
function closeDrawer() {
  $("treeSidebar").classList.remove("mobile-open");
  $("sidebarBackdrop").classList.remove("open");
}
$("hamburgerBtn").addEventListener("click", openDrawer);
$("treeSidebarClose").addEventListener("click", closeDrawer);
$("sidebarBackdrop").addEventListener("click", closeDrawer);
window.addEventListener("popstate", () => {
  if ($("treeSidebar").classList.contains("mobile-open")) closeDrawer();
});

// simple edge-swipe: swipe right from near the left edge to open,
// swipe left anywhere in the open drawer to close.
let touchStartX = null;
document.addEventListener("touchstart", (e) => {
  if (window.innerWidth > 760) return;
  touchStartX = e.touches[0].clientX;
}, { passive: true });
document.addEventListener("touchend", (e) => {
  if (window.innerWidth > 760 || touchStartX === null) return;
  const dx = e.changedTouches[0].clientX - touchStartX;
  const drawerOpen = $("treeSidebar").classList.contains("mobile-open");
  if (!drawerOpen && touchStartX < 24 && dx > 60) openDrawer();
  else if (drawerOpen && dx < -60) closeDrawer();
  touchStartX = null;
}, { passive: true });

// ---------------- header overflow menu (mobile) ----------------
$("headerOverflowBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  $("headerOverflowMenu").classList.toggle("open");
});
document.addEventListener("click", () => $("headerOverflowMenu").classList.remove("open"));
$("overflowRefreshBtn").addEventListener("click", () => { $("headerOverflowMenu").classList.remove("open"); doRefresh(); });
$("overflowSignoutBtn").addEventListener("click", () => { $("headerOverflowMenu").classList.remove("open"); $("logoutBtn").click(); });

// ---------------- login/logout ----------------
$("loginForm").addEventListener("submit", (e) => { e.preventDefault(); doLogin(); });

// password visibility toggle
$("pwToggle").addEventListener("click", () => {
  const input = $("pw");
  const showing = input.type === "text";
  input.type = showing ? "password" : "text";
  $("pwToggle").title = showing ? "Show password" : "Hide password";
  $("pwToggle").setAttribute("aria-label", showing ? "Show password" : "Hide password");
  $("pwToggleIcon").innerHTML = showing
    ? '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.6"/>'
    : '<path d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.24 4.24M9.9 5.1A11 11 0 0 1 12 5c7 0 11 7 11 7a13.5 13.5 0 0 1-3.15 3.9M6.5 6.5C3.7 8.3 2 12 2 12s2.5 4.5 7 6.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>';
});

// remember-me note only shows once the box is checked, so it doesn't
// clutter the form for people leaving it unchecked (the default)
$("rememberMe").addEventListener("change", (e) => {
  $("rememberNote").style.display = e.target.checked ? "block" : "none";
});

// Caps Lock hint — only meaningful while typing in the password field
$("pw").addEventListener("keydown", (e) => {
  if (typeof e.getModifierState === "function") {
    $("capsHint").textContent = e.getModifierState("CapsLock") ? "Caps Lock is on" : "";
  }
});
$("pw").addEventListener("keyup", (e) => {
  if (typeof e.getModifierState === "function") {
    $("capsHint").textContent = e.getModifierState("CapsLock") ? "Caps Lock is on" : "";
  }
});

let lockTimer = null;
function updateLockoutUI() {
  const remaining = lockRemainingMs();
  const box = $("loginLockout");
  const btn = $("loginBtn");
  const input = $("pw");
  clearInterval(lockTimer);
  if (remaining <= 0) {
    box.style.display = "none";
    btn.disabled = false;
    input.disabled = false;
    return;
  }
  btn.disabled = true;
  input.disabled = true;
  box.style.display = "block";
  const tick = () => {
    const ms = lockRemainingMs();
    if (ms <= 0) { updateLockoutUI(); return; }
    box.textContent = `Too many failed attempts — try again in ${Math.ceil(ms / 1000)}s`;
  };
  tick();
  lockTimer = setInterval(tick, 1000);
}

async function doLogin() {
  if (lockRemainingMs() > 0) return;
  const pw = $("pw").value;
  if (!pw) return;
  PW = pw;
  const btn = $("loginBtn");
  btn.disabled = true;
  btn.textContent = "Logging in…";
  try {
    await api("/api/tree");
    if ($("rememberMe").checked) {
      localStorage.setItem(REMEMBER_KEY, pw);
      sessionStorage.removeItem("rm_pw");
    } else {
      sessionStorage.setItem("rm_pw", pw);
      localStorage.removeItem(REMEMBER_KEY);
    }
    clearLockState();
    $("loginErr").textContent = "";
    await showApp();
  } catch (err) {
    registerFailedAttempt();
    $("loginErr").textContent = "Wrong password, or the repo/token isn't configured.";
    updateLockoutUI();
  } finally {
    btn.textContent = "Login";
    if (lockRemainingMs() <= 0) btn.disabled = false;
  }
}

$("logoutBtn").addEventListener("click", () => {
  sessionStorage.removeItem("rm_pw");
  localStorage.removeItem(REMEMBER_KEY);
  PW = "";
  showLogin();
});

// ---------------- utils ----------------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
function formatSize(n) {
  if (!n) return "0 B";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / (1024 * 1024)).toFixed(1) + " MB";
}

// keyboard: Escape closes find-bar / settings modal / editor, in that priority
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if ($("findBar").classList.contains("open")) closeFindBar();
    else if ($("settingsBackdrop").classList.contains("open")) $("settingsBackdrop").classList.remove("open");
    else if (openFile) closeEditor();
  }
});

// ---------------- PWA install ----------------
// Standard installable-web-app flow: the browser fires beforeinstallprompt
// when it decides the app qualifies (manifest + service worker present,
// HTTPS, etc). Chrome/Edge on desktop and Android support this. iOS Safari
// never fires this event — it only supports "Add to Home Screen" from the
// share sheet, so that platform gets a one-time text hint instead.
let deferredInstallPrompt = null;
let isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;

function setInstallButtonsVisible(visible) {
  $("installBtn").style.display = visible ? "inline-flex" : "none";
  $("loginInstallBtn").style.display = visible ? "inline-flex" : "none";
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  if (!isStandalone) setInstallButtonsVisible(true);
});

async function triggerInstall() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  setInstallButtonsVisible(false);
  if (outcome === "accepted") toast("Installed — find Repo Manager on your home screen or app list.", "ok");
}
$("installBtn").addEventListener("click", triggerInstall);
$("loginInstallBtn").addEventListener("click", triggerInstall);

window.addEventListener("appinstalled", () => {
  setInstallButtonsVisible(false);
  isStandalone = true;
});

function updateInstallSettingsRow() {
  const el = $("setInstallStatus");
  if (!el) return;
  if (isStandalone) el.textContent = "Installed — running as an app";
  else if (deferredInstallPrompt) el.textContent = "Available (see Install button above)";
  else el.textContent = /iPhone|iPad|iPod/.test(navigator.userAgent)
    ? "Share ↗ → Add to Home Screen"
    : "Not available in this browser";
}
$("settingsBtn").addEventListener("click", updateInstallSettingsRow);

// iOS Safari has no install prompt API — show a one-time dismissible hint
// instead, since "Add to Home Screen" only lives in the native share sheet.
function maybeShowIosHint() {
  const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isSafari = /Safari/.test(navigator.userAgent) && !/CriOS|FxiOS/.test(navigator.userAgent);
  if (isIos && isSafari && !isStandalone && !localStorage.getItem("rm_ios_install_hint_seen")) {
    setTimeout(() => {
      toast('Add this to your home screen: tap <b>Share</b> ↗ then <b>"Add to Home Screen"</b>.');
      localStorage.setItem("rm_ios_install_hint_seen", "1");
    }, 1200);
  }
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Non-fatal — the app still works fully online without the service
      // worker, it just won't get instant shell loads or the install prompt
      // in browsers that require one for installability.
    });
  });
}

maybeShowIosHint();

// ---------------- boot ----------------
updateLockoutUI();
if (PW && lockRemainingMs() <= 0) showApp().catch(() => showLogin());
else showLogin();
