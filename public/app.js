import { unzipSync, zipSync } from "https://cdn.jsdelivr.net/npm/fflate@0.8.2/+esm";

const $ = (id) => document.getElementById(id);

// ---------------- state ----------------
let PW = sessionStorage.getItem("rm_pw") || "";
let tree = [];                 // flat list from /api/tree: [{path, sha, size}]
let treeIndex = null;          // nested folder structure built from `tree`
let staged = { add: new Map(), del: new Set() }; // add: path -> {content?,sha?,encoding}, del: set of paths
let currentFolder = "";        // "" = root
let expanded = new Set([""]);  // expanded folder paths in the sidebar
let openFile = null;           // path of file currently open in the editor
let repoInfo = null;

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
  el.innerHTML = msg;
  $("status").appendChild(el);
  setTimeout(() => el.remove(), 6000);
}

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
    $("repoPill").innerHTML = `<b>${escapeHtml(repoInfo.repo)}</b>&nbsp;·&nbsp;<span class="branch-badge">⎇ ${escapeHtml(repoInfo.branch)}</span>`;
    $("loginRepoTag").textContent = `${repoInfo.owner}/${repoInfo.repo}`;
    $("setRepo").textContent = `${repoInfo.owner}/${repoInfo.repo}`;
    $("setBranch").textContent = repoInfo.branch;
    $("setVisibility").textContent = repoInfo.private ? "Private" : "Public";
    $("setGhLink").href = repoInfo.htmlUrl || "#";
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
    row.addEventListener("click", () => {
      currentFolder = node.path;
      if (hasKids) { toggleExpand(node.path); }
      renderSidebar();
      renderFileList();
      renderBreadcrumb();
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
}

// ---------------- file list ----------------
function renderFileList() {
  const node = findFolder(currentFolder);
  const list = $("fileList");
  list.innerHTML = "";
  $("deleteSelectedBtn").style.display = "none";
  $("downloadSelectedBtn").style.display = "none";

  if (!node) { list.innerHTML = '<div class="empty-state">Folder not found — it may have just been removed.</div>'; return; }

  const filter = $("search").value.trim().toLowerCase();
  const folders = [...node.folders.values()]
    .filter((f) => f.path.split("/").pop().toLowerCase().includes(filter))
    .sort((a, b) => a.path.localeCompare(b.path));
  const files = node.files
    .filter((f) => f.path.split("/").pop().toLowerCase().includes(filter))
    .sort((a, b) => a.path.localeCompare(b.path));

  if (folders.length === 0 && files.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="big">📁</div>${filter ? "No matches in this folder." : "This folder is empty. Create a file or drop something in."}</div>`;
    return;
  }

  for (const f of folders) {
    const row = document.createElement("div");
    row.className = "frow";
    row.draggable = true;
    row.innerHTML = `
      <svg class="ftype-ic folder" width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
      <span class="name">${escapeHtml(f.path.split("/").pop())}</span>
      <span class="size"></span>
      <div class="row-actions">
        <button class="rename-a" title="Rename">${iconRename()}</button>
        <button class="danger delete-a" title="Delete folder">${iconTrash()}</button>
      </div>
    `;
    row.addEventListener("click", (e) => { if (e.target.closest(".row-actions")) return; navigateTo(f.path); });
    row.querySelector(".rename-a").addEventListener("click", (e) => { e.stopPropagation(); promptRenameFolder(f.path); });
    row.querySelector(".delete-a").addEventListener("click", (e) => { e.stopPropagation(); deleteFolder(f.path); });
    row.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", JSON.stringify({ kind: "folder", path: f.path })); row.classList.add("dragging"); });
    row.addEventListener("dragend", () => row.classList.remove("dragging"));
    row.addEventListener("dragover", (e) => { e.preventDefault(); row.classList.add("drop-target"); });
    row.addEventListener("dragleave", () => row.classList.remove("drop-target"));
    row.addEventListener("drop", (e) => {
      e.preventDefault(); e.stopPropagation();
      row.classList.remove("drop-target");
      handleDropOnFolder(f.path, e.dataTransfer.getData("text/plain"));
    });
    list.appendChild(row);
  }

  for (const f of files) {
    const row = document.createElement("div");
    const isStagedAdd = staged.add.has(f.path);
    const isStagedDel = staged.del.has(f.path);
    row.className = "frow" + (isStagedAdd ? " staged-add" : "") + (isStagedDel ? " staged-del" : "");
    row.draggable = true;
    row.innerHTML = `
      <input type="checkbox" data-path="${escapeAttr(f.path)}" class="sel" />
      ${fileIcon(f.path)}
      <span class="name">${escapeHtml(f.path.split("/").pop())}</span>
      <span class="size">${formatSize(f.size)}</span>
      <div class="row-actions">
        <button class="rename-a" title="Rename">${iconRename()}</button>
        <button class="dup-a" title="Duplicate">${iconDup()}</button>
        <button class="danger delete-a" title="Delete">${iconTrash()}</button>
      </div>
    `;
    row.addEventListener("click", (e) => { if (e.target.closest(".row-actions") || e.target.classList.contains("sel")) return; openFileInEditor(f); });
    row.querySelector(".rename-a").addEventListener("click", (e) => { e.stopPropagation(); promptRenameFile(f.path); });
    row.querySelector(".dup-a").addEventListener("click", (e) => { e.stopPropagation(); duplicateFile(f); });
    row.querySelector(".delete-a").addEventListener("click", (e) => { e.stopPropagation(); stageDelete(f.path); toast(`Staged delete: <b>${escapeHtml(f.path.split("/").pop())}</b>`); });
    row.querySelector(".sel").addEventListener("change", updateSelectionToolbar);
    row.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", JSON.stringify({ kind: "file", path: f.path })); row.classList.add("dragging"); });
    row.addEventListener("dragend", () => row.classList.remove("dragging"));
    list.appendChild(row);
  }
}

function updateSelectionToolbar() {
  const any = document.querySelectorAll(".sel:checked").length > 0;
  $("deleteSelectedBtn").style.display = any ? "inline-flex" : "none";
  $("downloadSelectedBtn").style.display = any ? "inline-flex" : "none";
}

function fileIcon(path) {
  if (isImageFile(path)) return `<svg class="ftype-ic image" width="15" height="15" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="1.8"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/><path d="M21 15l-5-5L5 21" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
  return `<svg class="ftype-ic file" width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-6-5Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M13 3v5h6" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
}
function iconRename() { return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M12 20h9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`; }
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

$("deleteSelectedBtn").addEventListener("click", () => {
  const checked = [...document.querySelectorAll(".sel:checked")].map((el) => el.dataset.path);
  if (checked.length === 0) return toast("Select some files first.");
  checked.forEach(stageDelete);
});

$("downloadSelectedBtn").addEventListener("click", async () => {
  const checked = [...document.querySelectorAll(".sel:checked")].map((el) => el.dataset.path);
  if (checked.length === 0) return toast("Select some files first.");
  $("downloadSelectedBtn").disabled = true;
  $("downloadSelectedBtn").textContent = "Zipping…";
  try {
    const zipEntries = {};
    for (const path of checked) {
      const name = path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path;
      const staged_ = staged.add.get(path);
      let bytes;
      if (staged_) {
        bytes = base64ToBytes(staged_.content);
      } else {
        const f = tree.find((x) => x.path === path);
        if (!f) continue;
        const blob = await api(`/api/blob?sha=${encodeURIComponent(f.sha)}`);
        bytes = base64ToBytes(blob.content.replace(/\n/g, ""));
      }
      // flat zip of just the selected files, by filename — folder structure
      // isn't meaningful here since selections can span mixed folders
      let finalName = name, n = 2;
      while (zipEntries[finalName]) { finalName = appendSuffix(name, n); n++; }
      zipEntries[finalName] = bytes;
    }
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
    toast(`Downloaded <b>${checked.length}</b> file(s) as <b>${escapeHtml(folderName)}.zip</b>`, "ok");
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
let promptState = null;
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
dz.addEventListener("click", () => $("fileInput").click());
["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("drag"); }));
["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("drag"); }));
dz.addEventListener("drop", (e) => handleFiles(e.dataTransfer.files));
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
  $("editorPanel").classList.add("open");
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
  $("editorBody").innerHTML = "";
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

// ---------------- settings modal ----------------
$("settingsBtn").addEventListener("click", () => $("settingsBackdrop").classList.add("open"));
$("settingsClose").addEventListener("click", () => $("settingsBackdrop").classList.remove("open"));
$("settingsBackdrop").addEventListener("click", (e) => { if (e.target === $("settingsBackdrop")) $("settingsBackdrop").classList.remove("open"); });

// ---------------- refresh ----------------
$("refreshBtn").addEventListener("click", async () => {
  try { await loadTree(); toast("Refreshed."); }
  catch (err) { toast("Couldn't refresh: " + err.message, "err"); }
});

$("search").addEventListener("input", renderFileList);

// ---------------- login/logout ----------------
$("loginBtn").addEventListener("click", doLogin);
$("pw").addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });

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
  $("loginBtn").disabled = true;
  try {
    await api("/api/tree");
    sessionStorage.setItem("rm_pw", pw);
    clearLockState();
    $("loginErr").textContent = "";
    await showApp();
  } catch (err) {
    registerFailedAttempt();
    $("loginErr").textContent = "Wrong password, or the repo/token isn't configured.";
    updateLockoutUI();
  } finally {
    if (lockRemainingMs() <= 0) $("loginBtn").disabled = false;
  }
}

$("logoutBtn").addEventListener("click", () => {
  sessionStorage.removeItem("rm_pw");
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

// keyboard: Escape closes editor/modals
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if ($("settingsBackdrop").classList.contains("open")) $("settingsBackdrop").classList.remove("open");
    else if (openFile) closeEditor();
  }
});

// ---------------- boot ----------------
updateLockoutUI();
if (PW && lockRemainingMs() <= 0) showApp().catch(() => showLogin());
else showLogin();
