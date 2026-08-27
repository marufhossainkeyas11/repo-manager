import { unzipSync, zipSync } from "https://cdn.jsdelivr.net/npm/fflate@0.8.2/+esm";

// ============================================================
// State
// ============================================================
let PW = sessionStorage.getItem("rm_pw") || "";
let activeRepo = null;        // { owner, repo, branch }
let repoInfo = null;          // full /api/repo response
let tree = { files: [] };     // flat file list from GitHub tree
let treeIndex = null;         // folder tree built from flat files
let currentPath = "";         // current folder being viewed
let selected = new Set();     // selected file paths in current folder view
let staged = { add: new Map(), del: new Set(), move: [] }; // path -> {content/sha}, path set, [{from,to,sha}]
let openFile = null;          // { path, sha, content, isImage, dirty }
let promptState = null;
let repoSwitchState = { picking: null, branches: [] }; // picking: {owner,repo,defaultBranch,...} while choosing branch

const TEXT_EXT = new Set(["js","jsx","ts","tsx","json","jsonc","md","markdown","txt","css","scss","html","htm","xml","yml","yaml","toml","ini","env","sh","bash","py","rb","go","rs","c","h","cpp","hpp","java","kt","swift","php","sql","graphql","vue","svelte","lock","gitignore","gitattributes","editorconfig","csv","log"]);
const IMAGE_EXT = new Set(["png","jpg","jpeg","gif","webp","svg","bmp","ico"]);

function extOf(path) {
  const base = path.split("/").pop() || "";
  const dot = base.lastIndexOf(".");
  return dot === -1 ? "" : base.slice(dot + 1).toLowerCase();
}
function isTextFile(path) { return TEXT_EXT.has(extOf(path)); }
function isImageFile(path) { return IMAGE_EXT.has(extOf(path)); }

function $(id) { return document.getElementById(id); }

// ============================================================
// Login lockout (client-side UX layer; server enforces the real limit)
// ============================================================
const LOCK_KEY = "rm_lock";
function getLockState() {
  try { return JSON.parse(localStorage.getItem(LOCK_KEY) || "null") || { fails: 0, until: 0 }; }
  catch { return { fails: 0, until: 0 }; }
}
function setLockState(s) { localStorage.setItem(LOCK_KEY, JSON.stringify(s)); }
function registerFailedAttempt() {
  const s = getLockState();
  s.fails += 1;
  if (s.fails >= 5) {
    const lockSeconds = Math.min(30 * 2 ** (s.fails - 5), 15 * 60);
    s.until = Date.now() + lockSeconds * 1000;
  }
  setLockState(s);
}
function clearLockState() { setLockState({ fails: 0, until: 0 }); }
function lockRemainingMs() { return Math.max(0, getLockState().until - Date.now()); }

// ============================================================
// Toasts
// ============================================================
function toast(msg, kind = "") {
  const wrap = $("status");
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  const iconOk = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M20 6 9 17l-5-5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const iconErr = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M12 8v5M12 16h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
  const iconInfo = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M12 11v5M12 8h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
  const icon = kind === "ok" ? iconOk : kind === "err" ? iconErr : iconInfo;
  el.innerHTML = `<span class="toast-icon">${icon}</span><span class="toast-body">${msg}</span><button class="toast-close">${iconX()}</button>`;
  el.querySelector(".toast-close").onclick = (e) => { e.stopPropagation(); el.remove(); };
  wrap.appendChild(el);
  const life = kind === "err" ? 7000 : 4200;
  setTimeout(() => { el.classList.add("collapsed"); }, life);
  setTimeout(() => { el.remove(); }, life + 4000);
}
function iconX() { return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`; }

// ============================================================
// API helper
// ============================================================
async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { Authorization: `Bearer ${PW}`, ...(opts.headers || {}) },
  });
  if (res.status === 401) {
    sessionStorage.removeItem("rm_pw");
    showLogin();
    throw new Error("Session expired. Please sign in again.");
  }
  if (res.status === 429) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Too many attempts. Please wait.");
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return res.status === 204 ? null : res.json();
}

function repoQuery() {
  if (!activeRepo) return "";
  return `owner=${encodeURIComponent(activeRepo.owner)}&repo=${encodeURIComponent(activeRepo.repo)}&branch=${encodeURIComponent(activeRepo.branch)}`;
}

// ============================================================
// Boot / login / app show
// ============================================================
function showLogin() {
  $("app").style.display = "none";
  $("login").style.display = "flex";
  updateLockoutUI();
}

async function showApp() {
  $("login").style.display = "none";
  $("app").style.display = "flex";
  try {
    await loadActiveRepoAndTree();
  } catch (err) {
    toast(escapeHtml(err.message), "err");
    if (!activeRepo) openRepoSwitcher(true);
  }
}

// Loads whichever repo the server currently has as "active" (KV-persisted,
// synced across devices). If none is set yet, opens the repo switcher so
// the person can pick one.
async function loadActiveRepoAndTree() {
  const data = await api(`/api/repos`);
  if (data.active && data.active.owner && data.active.repo) {
    activeRepo = data.active;
    await loadRepoInfo();
    await loadTree();
    renderRepoPill();
  } else {
    renderRepoPill();
    openRepoSwitcher(true);
  }
}

async function loadRepoInfo() {
  const info = await api(`/api/repo?${repoQuery()}`);
  repoInfo = info;
  activeRepo.branch = info.branch || activeRepo.branch;
  renderRepoPill();
  updateSettingsPanel();
}

async function loadTree() {
  const data = await api(`/api/tree?${repoQuery()}`);
  tree = data;
  buildTreeIndex();
  currentPath = "";
  selected.clear();
  renderSidebar();
  renderBreadcrumb();
  renderFileList();
}

function renderRepoPill() {
  const nameEl = $("repoPillName");
  const branchEl = $("repoPillBranch");
  if (!activeRepo) {
    nameEl.textContent = "Select a repository";
    branchEl.innerHTML = "";
    return;
  }
  nameEl.textContent = `${activeRepo.owner}/${activeRepo.repo}`;
  branchEl.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none"><path d="M6 3v12M18 9v9M6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM18 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM6 15a9 9 0 0 0 9-9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>${escapeHtml(activeRepo.branch)}`;
}

// ============================================================
// Repo switcher
// ============================================================
let repoSearchDebounce = null;

function openRepoSwitcher(forced = false) {
  $("repoSwitchBackdrop").classList.add("open");
  $("repoSwitchBackdrop").dataset.forced = forced ? "1" : "";
  $("repoSwitchClose").style.display = forced ? "none" : "inline-flex";
  $("branchPicker").style.display = "none";
  $("repoSearchInput").value = "";
  $("repoSearchInput").focus();
  loadRepoDirectory("");
}

function closeRepoSwitcher() {
  if ($("repoSwitchBackdrop").dataset.forced === "1" && !activeRepo) return; // must pick one first time
  $("repoSwitchBackdrop").classList.remove("open");
  repoSwitchState.picking = null;
}

async function loadRepoDirectory(query) {
  const listEl = $("repoResultsList");
  const recentsEl = $("repoRecentsList");
  const recentsLabel = $("repoRecentsLabel");
  listEl.innerHTML = `<div class="empty-state">Searching…</div>`;
  try {
    const q = query ? `&q=${encodeURIComponent(query)}` : "";
    const data = await api(`/api/repos?_=${Date.now()}${q}`);
    $("repoAllLabel").textContent = query ? "Results" : "Your repositories";
    listEl.innerHTML = "";
    if (!data.repos.length) {
      listEl.innerHTML = `<div class="empty-state">No repositories found.</div>`;
    } else {
      data.repos.forEach((r) => listEl.appendChild(renderRepoRow(r)));
    }
    if (!query && data.recents && data.recents.length) {
      recentsLabel.style.display = "block";
      recentsEl.innerHTML = "";
      data.recents.forEach((r) => recentsEl.appendChild(renderRepoRow(r)));
    } else {
      recentsLabel.style.display = "none";
      recentsEl.innerHTML = "";
    }
  } catch (err) {
    listEl.innerHTML = `<div class="empty-state">${escapeHtml(err.message)}</div>`;
  }
}

function renderRepoRow(r) {
  const row = document.createElement("div");
  const isActive = activeRepo && activeRepo.owner === r.owner && activeRepo.repo === r.repo;
  row.className = "repo-row" + (isActive ? " active" : "");
  row.innerHTML = `
    <svg class="repo-ic" width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
    <div class="repo-meta">
      <div class="repo-name">${escapeHtml(r.fullName || `${r.owner}/${r.repo}`)}</div>
      ${r.description ? `<div class="repo-desc">${escapeHtml(r.description)}</div>` : ""}
    </div>
    ${r.private ? `<span class="repo-badge">Private</span>` : ""}
  `;
  row.onclick = () => pickRepoForBranch(r);
  return row;
}

async function pickRepoForBranch(r) {
  repoSwitchState.picking = r;
  const sel = $("branchSelect");
  sel.innerHTML = `<option>Loading…</option>`;
  $("branchPicker").style.display = "flex";
  try {
    const data = await api(`/api/repos/branches?owner=${encodeURIComponent(r.owner)}&repo=${encodeURIComponent(r.repo)}`);
    sel.innerHTML = "";
    const branches = data.branches.length ? data.branches : [r.defaultBranch || "main"];
    branches.forEach((b) => {
      const opt = document.createElement("option");
      opt.value = b;
      opt.textContent = b;
      if (b === r.defaultBranch) opt.selected = true;
      sel.appendChild(opt);
    });
  } catch (err) {
    sel.innerHTML = `<option value="${escapeAttr(r.defaultBranch || "main")}">${escapeHtml(r.defaultBranch || "main")}</option>`;
    toast(escapeHtml(err.message), "err");
  }
}

async function confirmRepoSelect() {
  const r = repoSwitchState.picking;
  if (!r) return;
  const branch = $("branchSelect").value || r.defaultBranch || "main";
  if (staged.add.size || staged.del.size || staged.move.length) {
    if (!confirm("Switching repos will discard your staged (uncommitted) changes. Continue?")) return;
  }
  try {
    const data = await api(`/api/repos/select`, {
      method: "POST",
      body: JSON.stringify({ owner: r.owner, repo: r.repo, branch }),
    });
    activeRepo = data.active;
    staged = { add: new Map(), del: new Set(), move: [] };
    closeEditor();
    $("repoSwitchBackdrop").dataset.forced = "";
    $("repoSwitchBackdrop").classList.remove("open");
    toast(`Switched to ${activeRepo.owner}/${activeRepo.repo}`, "ok");
    await loadRepoInfo();
    await loadTree();
    renderStage();
    closeSidebarMobile();
  } catch (err) {
    toast(escapeHtml(err.message), "err");
  }
}

// ============================================================
// Tree index (folders) built from the flat file list
// ============================================================
function buildTreeIndex() {
  const root = { path: "", name: "", folders: new Map(), files: [], expanded: true };
  for (const f of tree.files) {
    if (staged.del.has(f.path)) continue;
    const parts = f.path.split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const name = parts[i];
      const p = parts.slice(0, i + 1).join("/");
      if (!node.folders.has(name)) {
        node.folders.set(name, { path: p, name, folders: new Map(), files: [], expanded: currentPath.startsWith(p) });
      }
      node = node.folders.get(name);
    }
    node.files.push(f);
  }
  // fold in staged additions so new folders show up before commit
  for (const path of staged.add.keys()) {
    const parts = path.split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const name = parts[i];
      const p = parts.slice(0, i + 1).join("/");
      if (!node.folders.has(name)) {
        node.folders.set(name, { path: p, name, folders: new Map(), files: [], expanded: true });
      }
      node = node.folders.get(name);
    }
    if (!node.files.find((x) => x.path === path)) node.files.push({ path, sha: "staged", size: 0, staged: true });
  }
  treeIndex = root;
}

function approxSize(base64) { return Math.floor((base64.length * 3) / 4); }

function findFolder(path) {
  if (!path) return treeIndex;
  const parts = path.split("/");
  let node = treeIndex;
  for (const p of parts) {
    node = node.folders.get(p);
    if (!node) return null;
  }
  return node;
}

// True if `path` is a folder that's a direct child of `parentPath` in the
// current tree — used to tell folder selections apart from file selections
// (selections only ever contain entries from one folder view at a time).
function isFolderPath(path, parentPath) {
  const parent = findFolder(parentPath);
  if (!parent) return false;
  return parent.folders.has(path.slice(parentPath ? parentPath.length + 1 : 0));
}

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
    row.className = "tnode-row" + (currentPath === node.path ? " active" : "");
    row.dataset.path = node.path;
    const hasKids = folderHasChildren(node);
    row.innerHTML = `
      <svg class="chev ${node.expanded ? "open" : ""} ${hasKids ? "" : "spacer"}" width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <svg class="folder-ic" width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
      <span class="name">${escapeHtml(node.name)}</span>
    `;
    row.onclick = (e) => {
      e.stopPropagation();
      navigateTo(node.path);
      if (hasKids) toggleExpand(node.path);
      closeSidebarMobile();
    };
    row.ondragover = (e) => { e.preventDefault(); row.classList.add("drop-target"); };
    row.ondragleave = () => row.classList.remove("drop-target");
    row.ondrop = (e) => {
      e.preventDefault();
      row.classList.remove("drop-target");
      handleDropOnFolder(node.path, e.dataTransfer.getData("text/plain"));
    };
    wrap.appendChild(row);
  }

  const childrenWrap = document.createElement("div");
  childrenWrap.className = "tnode-children" + (isRoot || node.expanded ? "" : " collapsed");
  const sortedFolders = [...node.folders.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const child of sortedFolders) {
    childrenWrap.appendChild(renderFolderNode(child, depth + 1, false));
  }
  wrap.appendChild(childrenWrap);
  return wrap;
}

function toggleExpand(path) {
  const node = findFolder(path);
  if (!node) return;
  node.expanded = !node.expanded;
  renderSidebar();
}

function renderBreadcrumb() {
  const bar = $("breadcrumbBar");
  bar.innerHTML = "";
  const rootCrumb = document.createElement("span");
  rootCrumb.className = "crumb" + (currentPath === "" ? " current" : "");
  rootCrumb.textContent = activeRepo ? activeRepo.repo : "root";
  rootCrumb.onclick = () => navigateTo("");
  bar.appendChild(rootCrumb);

  if (currentPath) {
    const parts = currentPath.split("/");
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
      const p = acc;
      crumb.onclick = () => navigateTo(p);
      bar.appendChild(crumb);
    });
  }
}

function navigateTo(path) {
  currentPath = path;
  selected.clear();
  renderBreadcrumb();
  renderFileList();
  const activeRow = document.querySelector(`.tnode-row[data-path="${CSS.escape(path)}"]`);
  document.querySelectorAll(".tnode-row.active").forEach((el) => el.classList.remove("active"));
  if (activeRow) activeRow.classList.add("active");
  showMobileScreen("files");
}

// ============================================================
// Mobile screen navigation (sidebar / files / editor act like separate
// screens on narrow viewports; all three stay simultaneously visible on
// desktop via CSS, so these are no-ops there).
// ============================================================
function isMobileViewport() { return window.matchMedia("(max-width: 760px)").matches; }

function openSidebarMobile() {
  $("treeSidebar").classList.add("mobile-open");
  $("sidebarBackdrop").classList.add("mobile-open");
}
function closeSidebarMobile() {
  $("treeSidebar").classList.remove("mobile-open");
  $("sidebarBackdrop").classList.remove("mobile-open");
}
function showMobileScreen(which) {
  if (!isMobileViewport()) return;
  if (which === "editor") {
    $("editorPanel").classList.add("open");
  }
}

// ============================================================
// File list
// ============================================================
function updateSelectionToolbar() {
  const count = selected.size;
  $("downloadSelectedBtn").style.display = count ? "inline-flex" : "none";
  $("deleteSelectedBtn").style.display = count ? "inline-flex" : "none";
  const countEl = $("selectionCount");
  if (count) {
    countEl.textContent = `${count} selected`;
    countEl.style.display = "inline";
  } else {
    countEl.style.display = "none";
  }
  const node = findFolder(currentPath);
  const total = node ? node.files.length + node.folders.size : 0;
  const cb = $("selectAllCheckbox");
  cb.indeterminate = count > 0 && count < total;
  cb.checked = total > 0 && count === total;
}

function currentFolderEntryPaths() {
  const node = findFolder(currentPath);
  if (!node) return [];
  const folderPaths = [...node.folders.values()].map((f) => f.path);
  const filePaths = node.files.map((f) => f.path);
  return [...folderPaths, ...filePaths];
}

function toggleSelectAll() {
  const all = currentFolderEntryPaths();
  const allSelected = all.length > 0 && all.every((p) => selected.has(p));
  if (allSelected) {
    selected.clear();
  } else {
    selected = new Set(all);
  }
  renderFileList();
}

function fileIcon(path) {
  if (isImageFile(path)) return `<svg class="ftype-ic image" width="15" height="15" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="1.8"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/><path d="m21 15-5-5L5 21" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
  return `<svg class="ftype-ic file" width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-6-5Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M13 3v5h6" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
}
function folderIcon() { return `<svg class="ftype-ic folder" width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`; }
function iconRename() { return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M12 20h9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`; }
function iconDup() { return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" stroke="currentColor" stroke-width="1.8"/></svg>`; }
function iconTrash() { return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6h12Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`; }
function iconZip() { return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M21 8v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 11v6M9.5 13.5 12 11l2.5 2.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`; }

function renderFileList() {
  const node = findFolder(currentPath);
  const listEl = $("fileList");
  listEl.innerHTML = "";
  $("dropzoneTarget").textContent = currentPath ? `/${currentPath}` : "this folder";

  if (!node) { listEl.innerHTML = `<div class="empty-state">Folder not found.</div>`; updateSelectionToolbar(); return; }

  const filterVal = ($("search").value || "").toLowerCase();
  const folders = [...node.folders.values()]
    .filter((f) => !filterVal || f.name.toLowerCase().includes(filterVal))
    .sort((a, b) => a.name.localeCompare(b.name));
  const files = node.files
    .filter((f) => !filterVal || f.path.split("/").pop().toLowerCase().includes(filterVal))
    .sort((a, b) => a.path.localeCompare(b.path));

  if (!folders.length && !files.length) {
    listEl.innerHTML = `<div class="empty-state"><div class="big">📂</div>${filterVal ? "No matches in this folder." : "This folder is empty."}</div>`;
    updateSelectionToolbar();
    return;
  }

  for (const f of folders) {
    const row = document.createElement("div");
    row.className = "frow" + (selected.has(f.path) ? " selected" : "");
    row.draggable = true;
    row.innerHTML = `
      <input type="checkbox" data-path="${escapeAttr(f.path)}" ${selected.has(f.path) ? "checked" : ""} />
      ${folderIcon()}
      <span class="name">${escapeHtml(f.name)}</span>
      <span class="row-actions">
        <button class="rename" title="Rename">${iconRename()}</button>
        <button class="zip" title="Download as .zip">${iconZip()}</button>
        <button class="danger delete" title="Delete folder">${iconTrash()}</button>
      </span>
    `;
    row.querySelector('input[type="checkbox"]').onchange = (e) => {
      if (e.target.checked) selected.add(f.path); else selected.delete(f.path);
      row.classList.toggle("selected", e.target.checked);
      updateSelectionToolbar();
    };
    row.querySelector(".rename").onclick = (e) => { e.stopPropagation(); promptRenameFolder(f.path); };
    row.querySelector(".zip").onclick = (e) => { e.stopPropagation(); downloadFolderAsZip(f.path); };
    row.querySelector(".delete").onclick = (e) => { e.stopPropagation(); deleteFolder(f.path); };
    row.addEventListener("click", (e) => {
      if (e.target.closest("input,.row-actions")) return;
      navigateTo(f.path);
    });
    row.addEventListener("dragstart", (e) => {
      row.classList.add("dragging");
      e.dataTransfer.setData("text/plain", JSON.stringify({ type: "folder", path: f.path }));
    });
    row.addEventListener("dragend", () => row.classList.remove("dragging"));
    row.addEventListener("dragover", (e) => { e.preventDefault(); row.classList.add("drop-target"); });
    row.addEventListener("dragleave", () => row.classList.remove("drop-target"));
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      row.classList.remove("drop-target");
      handleDropOnFolder(f.path, e.dataTransfer.getData("text/plain"));
    });
    listEl.appendChild(row);
  }

  for (const f of files) {
    const name = f.path.split("/").pop();
    const row = document.createElement("div");
    const isStagedAdd = staged.add.has(f.path);
    row.className = "frow" + (selected.has(f.path) ? " selected" : "") + (isStagedAdd ? " staged-add" : "");
    row.draggable = true;
    row.innerHTML = `
      <input type="checkbox" data-path="${escapeAttr(f.path)}" ${selected.has(f.path) ? "checked" : ""} />
      ${fileIcon(f.path)}
      <span class="name">${escapeHtml(name)}</span>
      <span class="size">${f.size != null ? formatSize(f.size) : ""}</span>
      <span class="row-actions">
        <button class="rename" title="Rename">${iconRename()}</button>
        <button class="dup" title="Duplicate">${iconDup()}</button>
        <button class="danger delete" title="Delete">${iconTrash()}</button>
      </span>
    `;
    row.querySelector('input[type="checkbox"]').onchange = (e) => {
      if (e.target.checked) selected.add(f.path); else selected.delete(f.path);
      row.classList.toggle("selected", e.target.checked);
      updateSelectionToolbar();
    };
    row.querySelector(".rename").onclick = (e) => { e.stopPropagation(); promptRenameFile(f.path); };
    row.querySelector(".dup").onclick = (e) => { e.stopPropagation(); duplicateFile(f); };
    row.querySelector(".delete").onclick = (e) => { e.stopPropagation(); stageDelete(f.path); renderFileList(); renderStage(); };
    row.addEventListener("click", (e) => {
      if (e.target.closest("input,.row-actions")) return;
      openFileInEditor(f);
    });
    row.addEventListener("dragstart", (e) => {
      row.classList.add("dragging");
      e.dataTransfer.setData("text/plain", JSON.stringify({ type: "file", path: f.path, sha: f.sha }));
    });
    row.addEventListener("dragend", () => row.classList.remove("dragging"));
    listEl.appendChild(row);
  }
  updateSelectionToolbar();
}

// ============================================================
// Staging
// ============================================================
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
  const moves = new Map();
  const shaToDel = new Map();
  for (const p of staged.del) {
    const orig = tree.files.find((x) => x.path === p);
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

// ============================================================
// Rename / duplicate / delete-folder
// ============================================================
function promptRenameFile(oldPath) {
  openPrompt({
    title: "Rename file",
    hint: "Full path within the repo. Moving to a different folder also works — just change the path.",
    initial: oldPath,
    confirmLabel: "Rename",
    onConfirm: (newPath) => {
      newPath = newPath.trim().replace(/^\/+/, "");
      if (!newPath || newPath === oldPath) return;
      const f = tree.files.find((x) => x.path === oldPath) || { sha: staged.add.get(oldPath)?.sha };
      if (f.sha) {
        stageMove(oldPath, newPath, f.sha);
      } else {
        const entry = staged.add.get(oldPath);
        staged.add.delete(oldPath);
        staged.add.set(newPath, entry);
        buildTreeIndex(); renderSidebar(); renderFileList(); renderStage();
      }
      toast(`Staged rename: <b>${escapeHtml(oldPath.split("/").pop())}</b> → <b>${escapeHtml(newPath)}</b>`);
      if (openFile && openFile.path === oldPath) closeEditor();
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
      const affected = tree.files.filter((f) => f.path === oldPath || f.path.startsWith(oldPath + "/"));
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
      if (currentPath === oldPath || currentPath.startsWith(oldPath + "/")) navigateTo(newPath + currentPath.slice(oldPath.length));
    },
  });
}

function deleteFolder(path) {
  const affected = tree.files.filter((f) => f.path === path || f.path.startsWith(path + "/"));
  const stagedAffected = [...staged.add.keys()].filter((p) => p === path || p.startsWith(path + "/"));
  if (affected.length === 0 && stagedAffected.length === 0) {
    toast("Folder is empty — nothing to stage.");
    return;
  }
  if (!confirm(`Delete folder "${path}" and all ${affected.length + stagedAffected.length} file(s) inside it? This stages the delete — nothing happens until you commit.`)) return;
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
  while (tree.files.find((x) => x.path === newPath) || staged.add.has(newPath)) {
    newPath = `${dir}${stem} copy ${n}${ext}`;
    n++;
  }
  try {
    if (f.staged) {
      const entry = staged.add.get(f.path);
      stageAdd(newPath, { ...entry });
    } else {
      const blob = await api(`/api/blob?${repoQuery()}&sha=${encodeURIComponent(f.sha)}`);
      stageAdd(newPath, { content: blob.content, encoding: blob.encoding || "base64" });
    }
    toast(`Duplicated as <b>${escapeHtml(newPath.split("/").pop())}</b>`);
  } catch (err) {
    toast("Couldn't duplicate: " + escapeHtml(err.message), "err");
  }
}

function appendSuffix(name, n) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
}

// ============================================================
// Zip download: selected items (files/folders mixed) or a whole folder
// ============================================================
async function resolveFileBytes(path) {
  const staged_ = staged.add.get(path);
  if (staged_) {
    if (staged_.content) return base64ToBytes(staged_.content);
    if (staged_.sha) {
      const blob = await api(`/api/blob?${repoQuery()}&sha=${encodeURIComponent(staged_.sha)}`);
      return base64ToBytes(blob.content.replace(/\n/g, ""));
    }
  }
  const f = tree.files.find((x) => x.path === path);
  if (!f) return null;
  const blob = await api(`/api/blob?${repoQuery()}&sha=${encodeURIComponent(f.sha)}`);
  return base64ToBytes(blob.content.replace(/\n/g, ""));
}

// Expands a mixed selection of file paths and folder paths into a flat
// list of { zipPath, sourcePath } pairs. Folders keep their internal
// structure (relative to the folder itself); files sit at the zip root.
function expandSelectionForZip(paths) {
  const entries = [];
  const usedNames = new Set();
  for (const path of paths) {
    if (isFolderPath(path, currentPath)) {
      const allInFolder = [
        ...tree.files.filter((f) => f.path === path || f.path.startsWith(path + "/")).map((f) => f.path),
        ...[...staged.add.keys()].filter((p) => p.startsWith(path + "/")),
      ].filter((p) => !staged.del.has(p));
      const uniquePaths = [...new Set(allInFolder)];
      const folderName = path.split("/").pop();
      for (const p of uniquePaths) {
        entries.push({ zipPath: `${folderName}${p.slice(path.length)}`, sourcePath: p });
      }
    } else {
      const name = path.split("/").pop();
      let finalName = name, n = 2;
      while (usedNames.has(finalName)) { finalName = appendSuffix(name, n); n++; }
      usedNames.add(finalName);
      entries.push({ zipPath: finalName, sourcePath: path });
    }
  }
  return entries;
}

async function buildAndDownloadZip(entries, zipFileName) {
  const zipEntries = {};
  for (const { zipPath, sourcePath } of entries) {
    const bytes = await resolveFileBytes(sourcePath);
    if (bytes) zipEntries[zipPath] = bytes;
  }
  const zipped = zipSync(zipEntries);
  const blob = new Blob([zipped], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = zipFileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function downloadFolderAsZip(path) {
  const allInFolder = [
    ...tree.files.filter((f) => f.path === path || f.path.startsWith(path + "/")).map((f) => f.path),
    ...[...staged.add.keys()].filter((p) => p.startsWith(path + "/")),
  ].filter((p) => !staged.del.has(p));
  const uniquePaths = [...new Set(allInFolder)];
  if (!uniquePaths.length) return toast("This folder is empty.");
  const folderName = path.split("/").pop();
  const entries = uniquePaths.map((p) => ({ zipPath: `${folderName}${p.slice(path.length)}`, sourcePath: p }));
  toast(`Zipping <b>${escapeHtml(folderName)}</b>…`);
  try {
    await buildAndDownloadZip(entries, `${folderName}.zip`);
    toast(`Downloaded <b>${escapeHtml(folderName)}.zip</b>`, "ok");
  } catch (err) {
    toast("Couldn't build the zip: " + escapeHtml(err.message), "err");
  }
}

// ============================================================
// Drag & drop move
// ============================================================
function handleDropOnFolder(targetFolder, dataStr) {
  if (!dataStr) return;
  let data;
  try { data = JSON.parse(dataStr); } catch { return; }
  if (data.type === "file") {
    const oldPath = data.path;
    const name = oldPath.split("/").pop();
    const newPath = targetFolder ? `${targetFolder}/${name}` : name;
    if (newPath === oldPath) return;
    const f = tree.files.find((x) => x.path === oldPath) || {};
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
  } else if (data.type === "folder") {
    const oldPath = data.path;
    if (targetFolder === oldPath || targetFolder.startsWith(oldPath + "/")) {
      toast("Can't move a folder into itself.", "err");
      return;
    }
    const name = oldPath.split("/").pop();
    const newPath = targetFolder ? `${targetFolder}/${name}` : name;
    const affected = tree.files.filter((f) => f.path === oldPath || f.path.startsWith(oldPath + "/"));
    affected.forEach((f) => { if (!staged.del.has(f.path)) stageMove(f.path, newPath + f.path.slice(oldPath.length), f.sha); });
    toast(`Moved folder <b>${escapeHtml(name)}</b> → <b>${escapeHtml(targetFolder || "/")}</b>`);
  }
}

// ============================================================
// New file / folder prompt modal
// ============================================================
function openPrompt({ title, hint, initial, confirmLabel, onConfirm }) {
  $("promptTitle").textContent = title;
  $("promptHint").textContent = hint || "";
  $("promptInput").value = initial || "";
  $("promptConfirm").textContent = confirmLabel || "Create";
  promptState = { onConfirm };
  $("promptBackdrop").classList.add("open");
  setTimeout(() => { $("promptInput").focus(); $("promptInput").select(); }, 30);
}
function closePrompt() { $("promptBackdrop").classList.remove("open"); promptState = null; }

// ============================================================
// Upload / zip drop -> stage as additions
// ============================================================
function joinPath(dir, name) { return dir ? `${dir}/${name}` : name; }

async function handleFiles(fileList) {
  for (const file of fileList) {
    if (file.name.toLowerCase().endsWith(".zip")) {
      await handleZip(file);
    } else {
      const buf = new Uint8Array(await file.arrayBuffer());
      const path = joinPath(currentPath, file.name);
      stageAdd(path, { content: bytesToBase64(buf), encoding: "base64" });
      toast(`Staged: <b>${escapeHtml(path)}</b>`);
    }
  }
}

function stripCommonWrapper(paths) {
  if (paths.length === 0) return null;
  const firstSegs = paths[0].split("/");
  if (firstSegs.length < 2) return null;
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
    return toast("Couldn't extract zip: " + escapeHtml(err.message), "err");
  }
  let entries = Object.entries(unzipped).filter(([path, data]) => !path.endsWith("/") && data.length >= 0);
  if (entries.length === 0) return toast("No files found in that zip.", "err");

  const wrapper = stripCommonWrapper(entries.map(([p]) => p));
  if (wrapper) {
    entries = entries.map(([path, data]) => [path.slice(wrapper.length + 1), data]);
  }

  for (const [path, data] of entries) {
    const targetPath = joinPath(currentPath, path);
    stageAdd(targetPath, { content: bytesToBase64(data), encoding: "base64" });
  }
  const into = currentPath || "the repo root";
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

// ============================================================
// Editor / preview — now with find-in-file, select all, copy all
// ============================================================
async function openFileInEditor(f) {
  openFile = { path: f.path, sha: f.sha, staged: !!f.staged, size: f.size };
  $("editorPanel").classList.add("open");
  showMobileScreen("editor");
  $("editorName").textContent = f.path;
  $("editorMeta").textContent = formatSize(f.size || 0);
  $("editorStatus").textContent = "";
  $("editorSaveBtn").style.display = "none";
  $("editorFindBtn").style.display = "none";
  $("editorMoreBtn").style.display = "none";
  closeFindBar();
  const body = $("editorBody");
  body.innerHTML = `<div class="no-preview">Loading…</div>`;

  try {
    let base64content;
    if (f.staged) {
      const entry = staged.add.get(f.path);
      base64content = entry.content;
    } else {
      const blob = await api(`/api/blob?${repoQuery()}&sha=${encodeURIComponent(f.sha)}`);
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
      $("editorFindBtn").style.display = "inline-flex";
      $("editorMoreBtn").style.display = "inline-flex";
      if (!isMobileViewport()) ta.focus();
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
  $("editorBody").innerHTML = "";
  closeFindBar();
}

// ---- select all / copy all ----
function editorSelectAll() {
  const ta = $("editorBody").querySelector("textarea");
  if (!ta) return;
  ta.focus();
  ta.select();
}
async function editorCopyAll() {
  const ta = $("editorBody").querySelector("textarea");
  if (!ta) return;
  try {
    await navigator.clipboard.writeText(ta.value);
    toast("Copied file contents to clipboard.", "ok");
  } catch {
    // Clipboard API can fail without a secure context/permission — fall back
    // to the classic select+execCommand path so copy still works.
    ta.focus();
    ta.select();
    try { document.execCommand("copy"); toast("Copied file contents to clipboard.", "ok"); }
    catch { toast("Couldn't copy automatically — text is selected, use your device's copy action.", "err"); }
  }
}

// ---- find in file ----
let findState = { matches: [], current: -1 };
function openFindBar() {
  const ta = $("editorBody").querySelector("textarea");
  if (!ta) return;
  $("editorFindBar").classList.add("open");
  $("editorFindInput").value = "";
  $("editorFindInput").focus();
  $("editorFindCount").textContent = "";
}
function closeFindBar() {
  $("editorFindBar").classList.remove("open");
  findState = { matches: [], current: -1 };
}
function runFind(query) {
  const ta = $("editorBody").querySelector("textarea");
  if (!ta || !query) { findState = { matches: [], current: -1 }; $("editorFindCount").textContent = ""; return; }
  const text = ta.value;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const matches = [];
  let idx = 0;
  while (true) {
    const found = lower.indexOf(q, idx);
    if (found === -1) break;
    matches.push(found);
    idx = found + q.length;
  }
  findState.matches = matches;
  findState.current = matches.length ? 0 : -1;
  findState.queryLen = query.length;
  updateFindUI(ta);
}
function updateFindUI(ta) {
  const { matches, current, queryLen } = findState;
  if (!matches.length) {
    $("editorFindCount").textContent = $("editorFindInput").value ? "0 / 0" : "";
    return;
  }
  $("editorFindCount").textContent = `${current + 1} / ${matches.length}`;
  const pos = matches[current];
  ta.focus();
  ta.setSelectionRange(pos, pos + queryLen);
  // scroll the match into view within the textarea
  const before = ta.value.slice(0, pos);
  const lineNum = before.split("\n").length;
  const totalLines = ta.value.split("\n").length;
  const lineHeight = ta.scrollHeight / totalLines;
  ta.scrollTop = Math.max(0, lineHeight * (lineNum - 4));
}
function findNext() {
  if (!findState.matches.length) return;
  findState.current = (findState.current + 1) % findState.matches.length;
  updateFindUI($("editorBody").querySelector("textarea"));
}
function findPrev() {
  if (!findState.matches.length) return;
  findState.current = (findState.current - 1 + findState.matches.length) % findState.matches.length;
  updateFindUI($("editorBody").querySelector("textarea"));
}

// ============================================================
// Commit
// ============================================================
async function doCommit() {
  const additions = [...staged.add.entries()].map(([path, v]) => ({ path, ...v }));
  const deletions = [...staged.del];
  if (additions.length === 0 && deletions.length === 0) return toast("Nothing staged to commit.");
  const message = $("commitMsg").value.trim() || `Update ${additions.length} file(s), delete ${deletions.length} file(s)`;
  $("commitBtn").disabled = true;
  try {
    const result = await api("/api/commit", {
      method: "POST",
      body: JSON.stringify({ owner: activeRepo.owner, repo: activeRepo.repo, branch: activeRepo.branch, message, additions, deletions }),
    });
    toast(`Committed: <a href="${result.url}" target="_blank">${result.commitSha.slice(0, 7)}</a>`, "ok");
    staged = { add: new Map(), del: new Set(), move: [] };
    $("commitMsg").value = "";
    closeEditor();
    await loadTree();
  } catch (err) {
    toast("Commit failed: " + escapeHtml(err.message), "err");
  } finally {
    $("commitBtn").disabled = false;
  }
}

// ============================================================
// Settings modal
// ============================================================
async function updateSettingsPanel() {
  if (!activeRepo || !repoInfo) return;
  $("setRepo").textContent = `${activeRepo.owner}/${activeRepo.repo}`;
  $("setBranch").textContent = activeRepo.branch;
  $("setVisibility").textContent = repoInfo.private ? "Private" : "Public";
  $("setGhLink").href = repoInfo.htmlUrl || `https://github.com/${activeRepo.owner}/${activeRepo.repo}`;
  try {
    const who = await api("/api/whoami");
    $("setWhoami").textContent = who.login;
  } catch {
    $("setWhoami").textContent = "—";
  }
}

// ============================================================
// Utils
// ============================================================
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

// ============================================================
// Login — password show/hide, plain "Login" labeling, autofill-friendly
// ============================================================
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
    btn.textContent = "Login";
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
    await api("/api/whoami");
    sessionStorage.setItem("rm_pw", pw);
    clearLockState();
    $("loginErr").textContent = "";
    await showApp();
  } catch (err) {
    registerFailedAttempt();
    $("loginErr").textContent = "Incorrect password. Please try again.";
    updateLockoutUI();
  } finally {
    btn.textContent = "Login";
    if (lockRemainingMs() <= 0) btn.disabled = false;
  }
}

function doLogout() {
  sessionStorage.removeItem("rm_pw");
  PW = "";
  activeRepo = null;
  repoInfo = null;
  staged = { add: new Map(), del: new Set(), move: [] };
  showLogin();
}

// ============================================================
// PWA install
// ============================================================
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
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

// ============================================================
// Event wiring
// ============================================================

// -- login --
$("loginForm").addEventListener("submit", (e) => { e.preventDefault(); doLogin(); });
$("pwToggle").addEventListener("click", () => {
  const pw = $("pw");
  const showing = pw.type === "text";
  pw.type = showing ? "password" : "text";
  $("pwToggle").querySelector(".eye-on").style.display = showing ? "block" : "none";
  $("pwToggle").querySelector(".eye-off").style.display = showing ? "none" : "block";
  $("pwToggle").setAttribute("aria-label", showing ? "Show password" : "Hide password");
  pw.focus();
});
$("loginInstallBtn").addEventListener("click", triggerInstall);

// -- header / mobile nav --
$("mobileMenuBtn").addEventListener("click", openSidebarMobile);
$("closeSidebarBtn").addEventListener("click", closeSidebarMobile);
$("sidebarBackdrop").addEventListener("click", closeSidebarMobile);
$("repoPill").addEventListener("click", () => openRepoSwitcher(false));
$("installBtn").addEventListener("click", triggerInstall);
$("refreshBtn").addEventListener("click", async () => {
  try { await loadTree(); toast("Refreshed."); }
  catch (err) { toast("Couldn't refresh: " + escapeHtml(err.message), "err"); }
});
$("refreshBtnMobile").addEventListener("click", async () => {
  try { await loadTree(); toast("Refreshed."); }
  catch (err) { toast("Couldn't refresh: " + escapeHtml(err.message), "err"); }
});
$("logoutBtn").addEventListener("click", doLogout);

// -- select all --
$("selectAllCheckbox").addEventListener("change", toggleSelectAll);
$("selectAllWrap").addEventListener("click", (e) => { if (e.target.tagName !== "INPUT") $("selectAllCheckbox").click(); });

// -- toolbar: search, new menu --
$("search").addEventListener("input", renderFileList);
function closeMenu() { $("newMenu").classList.remove("open"); }
$("newMenuBtn").addEventListener("click", (e) => { e.stopPropagation(); $("newMenu").classList.toggle("open"); });
document.addEventListener("click", (e) => {
  if (!e.target.closest(".toolbar-menu-wrap")) closeMenu();
  if (!e.target.closest(".editor-menu-wrap")) $("editorMoreMenu").classList.remove("open");
});

$("newFolderBtn").addEventListener("click", () => {
  closeMenu();
  openPrompt({
    title: "New folder",
    hint: "Git doesn't track empty folders — a small .gitkeep file is added so it shows up after committing.",
    initial: currentPath ? currentPath + "/" : "",
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
    initial: currentPath ? currentPath + "/" : "",
    confirmLabel: "Create",
    onConfirm: (v) => {
      let path = v.trim().replace(/^\/+/, "");
      if (!path) return;
      if (tree.files.find((x) => x.path === path) || staged.add.has(path)) {
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
$("zipFolderBtn").addEventListener("click", () => {
  closeMenu();
  const label = currentPath || (repoInfo ? repoInfo.repo : "root");
  if (!currentPath) {
    // zipping the whole repo root
    const allPaths = [
      ...tree.files.map((f) => f.path),
      ...[...staged.add.keys()],
    ].filter((p, i, arr) => !staged.del.has(p) && arr.indexOf(p) === i);
    if (!allPaths.length) return toast("Nothing to zip yet.");
    toast(`Zipping <b>${escapeHtml(label)}</b>…`);
    buildAndDownloadZip(allPaths.map((p) => ({ zipPath: p, sourcePath: p })), `${repoInfo ? repoInfo.repo : "repo"}.zip`)
      .then(() => toast("Downloaded .zip", "ok"))
      .catch((err) => toast("Couldn't build the zip: " + escapeHtml(err.message), "err"));
  } else {
    downloadFolderAsZip(currentPath);
  }
});

// -- selection toolbar actions --
$("deleteSelectedBtn").addEventListener("click", () => {
  if (selected.size === 0) return toast("Select some files first.");
  const paths = [...selected];
  if (!confirm(`Stage delete for ${paths.length} selected item(s)? Folders are expanded to every file inside them. Nothing happens until you commit.`)) return;
  for (const path of paths) {
    if (isFolderPath(path, currentPath)) {
      const affected = tree.files.filter((f) => f.path === path || f.path.startsWith(path + "/"));
      const stagedAffected = [...staged.add.keys()].filter((p) => p === path || p.startsWith(path + "/"));
      affected.forEach((f) => stageDelete(f.path));
      stagedAffected.forEach((p) => staged.add.delete(p));
    } else {
      stageDelete(path);
    }
  }
  selected.clear();
  buildTreeIndex(); renderSidebar(); renderFileList(); renderStage();
  toast(`Staged delete of ${paths.length} item(s).`);
});

$("downloadSelectedBtn").addEventListener("click", async () => {
  if (selected.size === 0) return toast("Select some files first.");
  const btn = $("downloadSelectedBtn");
  const original = btn.querySelector(".btn-txt").textContent;
  btn.disabled = true;
  btn.querySelector(".btn-txt").textContent = "Zipping…";
  try {
    const entries = expandSelectionForZip([...selected]);
    const folderName = currentPath ? currentPath.split("/").pop() : (repoInfo ? repoInfo.repo : "files");
    await buildAndDownloadZip(entries, `${folderName}.zip`);
    toast(`Downloaded <b>${selected.size}</b> item(s) as <b>${escapeHtml(folderName)}.zip</b>`, "ok");
  } catch (err) {
    toast("Couldn't build the zip: " + escapeHtml(err.message), "err");
  } finally {
    btn.disabled = false;
    btn.querySelector(".btn-txt").textContent = original;
  }
});

// -- prompt modal --
$("promptCancel").addEventListener("click", closePrompt);
$("promptBackdrop").addEventListener("click", (e) => { if (e.target === $("promptBackdrop")) closePrompt(); });
$("promptConfirm").addEventListener("click", () => {
  const v = $("promptInput").value;
  if (promptState) promptState.onConfirm(v);
  closePrompt();
});
$("promptInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { $("promptConfirm").click(); }
  if (e.key === "Escape") closePrompt();
});

// -- dropzone / upload --
const dz = $("dropzone");
dz.addEventListener("click", (e) => {
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

// -- editor --
$("editorBackBtn").addEventListener("click", closeEditor);
$("editorCloseBtn").addEventListener("click", closeEditor);
$("editorSaveBtn").addEventListener("click", () => {
  if (!openFile) return;
  const ta = $("editorBody").querySelector("textarea");
  if (!ta) return;
  const content = utf8ToBase64(ta.value);
  stageAdd(openFile.path, { content, encoding: "base64" });
  ta.dataset.original = ta.value;
  $("editorSaveBtn").style.display = "none";
  $("editorStatus").textContent = "Staged — commit to save to GitHub";
  toast(`Staged edit: <b>${escapeHtml(openFile.path.split("/").pop())}</b>`);
});
$("editorFindBtn").addEventListener("click", () => {
  if ($("editorFindBar").classList.contains("open")) closeFindBar();
  else openFindBar();
});
$("editorFindClose").addEventListener("click", closeFindBar);
$("editorFindInput").addEventListener("input", (e) => runFind(e.target.value));
$("editorFindInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.shiftKey ? findPrev() : findNext(); }
  if (e.key === "Escape") closeFindBar();
});
$("editorFindNext").addEventListener("click", findNext);
$("editorFindPrev").addEventListener("click", findPrev);
$("editorMoreBtn").addEventListener("click", (e) => { e.stopPropagation(); $("editorMoreMenu").classList.toggle("open"); });
$("editorSelectAllBtn").addEventListener("click", () => { $("editorMoreMenu").classList.remove("open"); editorSelectAll(); });
$("editorCopyAllBtn").addEventListener("click", () => { $("editorMoreMenu").classList.remove("open"); editorCopyAll(); });

// -- commit --
$("commitBtn").addEventListener("click", doCommit);

// -- stage drawer collapse --
let stageCollapsed = false;
$("stageDrawerHeader").addEventListener("click", () => {
  stageCollapsed = !stageCollapsed;
  $("stageList").classList.toggle("collapsed", stageCollapsed);
  $("stageChev").classList.toggle("collapsed", stageCollapsed);
});

// -- settings modal --
$("settingsBtn").addEventListener("click", () => {
  updateInstallSettingsRow();
  updateSettingsPanel();
  $("settingsBackdrop").classList.add("open");
});
$("settingsClose").addEventListener("click", () => $("settingsBackdrop").classList.remove("open"));
$("settingsBackdrop").addEventListener("click", (e) => { if (e.target === $("settingsBackdrop")) $("settingsBackdrop").classList.remove("open"); });
$("settingsSwitchRepoBtn").addEventListener("click", () => {
  $("settingsBackdrop").classList.remove("open");
  openRepoSwitcher(false);
});
$("settingsLogoutBtn").addEventListener("click", () => {
  $("settingsBackdrop").classList.remove("open");
  doLogout();
});

// -- repo switcher --
$("repoSwitchClose").addEventListener("click", closeRepoSwitcher);
$("repoSwitchBackdrop").addEventListener("click", (e) => { if (e.target === $("repoSwitchBackdrop")) closeRepoSwitcher(); });
$("repoSearchInput").addEventListener("input", (e) => {
  clearTimeout(repoSearchDebounce);
  const q = e.target.value.trim();
  repoSearchDebounce = setTimeout(() => loadRepoDirectory(q), 280);
});
$("confirmRepoSelectBtn").addEventListener("click", confirmRepoSelect);
$("cancelRepoSelectBtn").addEventListener("click", () => {
  $("branchPicker").style.display = "none";
  repoSwitchState.picking = null;
});

// -- keyboard shortcuts --
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if ($("editorFindBar").classList.contains("open")) closeFindBar();
    else if ($("repoSwitchBackdrop").classList.contains("open")) closeRepoSwitcher();
    else if ($("settingsBackdrop").classList.contains("open")) $("settingsBackdrop").classList.remove("open");
    else if (openFile) closeEditor();
    return;
  }
  const meta = e.ctrlKey || e.metaKey;
  const inEditor = $("editorBody").contains(document.activeElement) && document.activeElement.tagName === "TEXTAREA";
  if (meta && e.key.toLowerCase() === "f" && inEditor) {
    e.preventDefault();
    openFindBar();
  }
  if (meta && e.key.toLowerCase() === "s" && openFile) {
    e.preventDefault();
    $("editorSaveBtn").click();
  }
});

// ============================================================
// Boot
// ============================================================
maybeShowIosHint();
updateLockoutUI();
if (PW && lockRemainingMs() <= 0) showApp().catch(() => showLogin());
else showLogin();
