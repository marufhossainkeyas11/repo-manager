import { $, escapeHtml } from "./utils/dom.js";
import { state, REMEMBER_KEY } from "./state.js";
import { api } from "./api.js";
import { toast } from "./utils/toast.js";

import { showLogin, setLoginSuccessHandler, initLogin } from "./auth/login.js";
import { lockRemainingMs } from "./auth/lockout.js";

import { buildTreeIndex } from "./tree/treeIndex.js";
import { renderSidebar, setNavigateHandler as setSidebarNavigateHandler, setDropHandler, setCloseDrawerHandler } from "./tree/sidebar.js";
import { renderBreadcrumb, navigateTo, setFolderChangedHandler } from "./tree/breadcrumb.js";

import {
  renderFileList, setOpenFileHandler, setNavigateFolderHandler, setDropMoveHandler,
  setActionDispatcher, setSearchQuery,
} from "./file-list/fileList.js";
import { selectionCount, clearSelection, updateSelectionBar, updateSelectAllCheckbox, toggleSelectAll, setSelectionChangedHandler } from "./file-list/selection.js";
import { setRowActions } from "./file-list/contextMenu.js";
import { rowActions, setAfterChangeHandler, setDownloadHandler, setMoveDialogHandler } from "./file-list/rowActions.js";
import {
  initNewMenu, initNewBottomSheet, openNewBottomSheet,
  setCreatedHandler, setNavigateHandler as setNewItemNavigateHandler, setOpenFileHandler as setNewItemOpenFileHandler,
} from "./file-list/newItem.js";

import { stageDelete, stagedCount, unstageRow } from "./staging/stage.js";
import { renderStageDrawer, setRemoveStagedHandler } from "./staging/stageDrawer.js";
import { initCommitBar, setAfterCommitHandler } from "./staging/commitBar.js";

import { openFileInEditor, closeEditor, setSavedHandler } from "./editor/editor.js";
import { closeFindBar } from "./editor/find.js";

import { initDropzone, setAfterUploadHandler } from "./dragdrop/dropzone.js";
import { openMoveDialog, moveItemToFolder, setAfterMoveHandler } from "./dragdrop/moveDialog.js";

import { downloadSingleFile } from "./zip/zipDownload.js";
import { resolveSelectionToFiles } from "./zip/resolveSelection.js";
import { initSplitDownloadButton } from "./zip/splitDownloadButton.js";

import { initResizablePanels } from "./layout/resizablePanels.js";
import { openDrawer, closeDrawer, initMobileDrawer } from "./layout/mobileDrawer.js";
import { initHeaderOverflow } from "./layout/headerOverflow.js";
import { initBottomNav, updateBottomNavBadge, setOpenNewSheetHandler, setOpenSettingsHandler, setOpenDrawerHandler } from "./layout/bottomNav.js";

import { initRepoManager, openSettingsModal, setRepoSwitchedHandler } from "./repoManager/repoManager.js";
import { initPwa } from "./pwa/install.js";
import { isMobile } from "./utils/breakpoints.js";

// ---------------- data loading ----------------
async function loadTree() {
  const data = await api("/api/tree");
  state.tree = data.files;
  refreshAll();
}

async function loadRepoInfo() {
  try {
    state.repoInfo = await api("/api/repo");
    $("repoPill").innerHTML = `<span class="repo-pill-inner"><b>${escapeHtml(state.repoInfo.repo)}</b></span><span class="branch-badge">⎇ ${escapeHtml(state.repoInfo.branch)}</span>`;
    $("rmActiveName").textContent = `${state.repoInfo.owner}/${state.repoInfo.repo}`;
    $("rmActiveBranch").textContent = `⎇ ${state.repoInfo.branch}`;
    $("rmActiveVisibility").textContent = state.repoInfo.private ? "Private" : "Public";
    $("rmActiveVisibility").classList.toggle("private", Boolean(state.repoInfo.private));
    $("rmActiveLink").href = state.repoInfo.htmlUrl || "#";
  } catch {
    // non-fatal — repo pill just stays blank
  }
}

// Re-renders every view that depends on tree/staged/selection state. Called
// after any mutation (stage, unstage, commit, navigate) instead of each
// module trying to track exactly what changed.
function refreshAll() {
  buildTreeIndex();
  renderSidebar();
  renderFileList();
  renderBreadcrumb();
  renderStageDrawer();
  updateSelectionBar();
  updateBottomNavBadge();
}

async function showApp() {
  $("login").style.display = "none";
  $("app").style.display = "flex";
  await loadTree();
  loadRepoInfo();
}
setLoginSuccessHandler(showApp);

// ---------------- wiring: tree/sidebar/breadcrumb ----------------
setSidebarNavigateHandler((path, opts) => navigateTo(path, opts));
setFolderChangedHandler(() => { renderFileList(); });
setCloseDrawerHandler(closeDrawer);
setDropHandler((destFolder, draggedPath) => {
  if (draggedPath && draggedPath !== destFolder) {
    const isFolder = state.selection.folders.has(draggedPath) || Boolean(findNodeIsFolder(draggedPath));
    moveItemToFolder(draggedPath, destFolder, isFolder);
  }
});
function findNodeIsFolder(path) {
  // cheap check: if it's not in the flat file tree/staged-adds, treat as folder
  return !state.tree.find((f) => f.path === path) && !state.staged.add.has(path);
}

// ---------------- wiring: file list ----------------
setOpenFileHandler((path) => {
  const f = state.tree.find((x) => x.path === path) || { path, sha: null, size: 0, staged: true };
  openFileInEditor(f);
});
setNewItemOpenFileHandler((f) => openFileInEditor(f));
setNavigateFolderHandler((path) => navigateTo(path));
setDropMoveHandler((draggedPath, destFolder) => {
  const isFolder = findNodeIsFolder(draggedPath);
  moveItemToFolder(draggedPath, destFolder, isFolder);
});
setActionDispatcher((act, path, isFolder) => {
  if (act === "download") rowActions.download(path);
  if (act === "rename") rowActions.rename(path, isFolder);
  if (act === "move") rowActions.move(path, isFolder);
  if (act === "duplicate") rowActions.duplicate(path);
  if (act === "delete") rowActions.deleteItem(path, isFolder);
});
setRowActions(rowActions);
setAfterChangeHandler(refreshAll);
setDownloadHandler(downloadSingleFile);
setMoveDialogHandler(openMoveDialog);
setAfterMoveHandler(refreshAll);

$("search").addEventListener("input", (e) => setSearchQuery(e.target.value));

// ---------------- wiring: selection ----------------
function currentVisibleEntries() {
  const node = state.treeIndex ? findFolderForSelection(state.currentFolder) : null;
  if (!node) return { folders: [], files: [] };
  const filter = $("search").value.trim().toLowerCase();
  const folders = [...node.folders.values()].filter((f) => f.path.split("/").pop().toLowerCase().includes(filter));
  const files = node.files.filter((f) => f.path.split("/").pop().toLowerCase().includes(filter));
  return { folders, files };
}
function findFolderForSelection(path) {
  if (!path) return state.treeIndex;
  const parts = path.split("/");
  let node = state.treeIndex;
  for (const seg of parts) {
    if (!node.folders.has(seg)) return null;
    node = node.folders.get(seg);
  }
  return node;
}
function refreshSelectAllCheckbox() {
  const { folders, files } = currentVisibleEntries();
  updateSelectAllCheckbox(folders, files);
}
setSelectionChangedHandler(() => refreshSelectAllCheckbox());

$("selectAllToggle").addEventListener("change", (e) => {
  const { folders, files } = currentVisibleEntries();
  toggleSelectAll(e.target.checked, folders, files);
  renderFileList();
  updateSelectionBar();
});
$("selectionBarAllToggle").addEventListener("change", (e) => {
  const { folders, files } = currentVisibleEntries();
  toggleSelectAll(e.target.checked, folders, files);
  renderFileList();
  updateSelectionBar();
});
$("selBarClearBtn").addEventListener("click", () => { clearSelection(); renderFileList(); updateSelectionBar(); });

async function confirmLargeSelection(count, verb) {
  if (count < 20) return true;
  return confirm(`${count} files affected. ${verb} cannot be easily undone once committed. Continue?`);
}

$("deleteSelectedBtn").addEventListener("click", async () => {
  if (selectionCount() === 0) return toast("Select some files first.", "err");
  const resolved = resolveSelectionToFiles();
  if (resolved.length === 0) return toast("Nothing to delete in the current selection.", "err");
  const ok = await confirmLargeSelection(resolved.length, "Deleting");
  if (!ok) return;
  resolved.forEach((r) => stageDelete(r.path));
  clearSelection();
  refreshAll();
});
$("selBarDeleteBtn").addEventListener("click", () => $("deleteSelectedBtn").click());

// ---------------- wiring: staging / commit ----------------
setRemoveStagedHandler((path, fromPath) => {
  unstageRow(path, fromPath);
  refreshAll();
});
setAfterCommitHandler(async () => {
  closeEditor();
  await loadTree();
});
initCommitBar();

// ---------------- wiring: editor ----------------
setSavedHandler(refreshAll);

// ---------------- wiring: new item / dropzone ----------------
setCreatedHandler(refreshAll);
setNewItemNavigateHandler((path) => navigateTo(path));
initNewMenu();
initNewBottomSheet();

setAfterUploadHandler(refreshAll);
initDropzone();

// ---------------- wiring: zip download split button ----------------
initSplitDownloadButton();

// ---------------- wiring: layout ----------------
initResizablePanels();
initMobileDrawer();
initHeaderOverflow();
setOpenNewSheetHandler(openNewBottomSheet);
setOpenSettingsHandler(openSettingsModal);
setOpenDrawerHandler(openDrawer);
initBottomNav();

$("refreshBtn").addEventListener("click", async () => {
  try { await loadTree(); toast("Refreshed.", "ok"); }
  catch (err) { toast("Couldn't refresh: " + err.message, "err"); }
});

// ---------------- wiring: repo manager ----------------
setRepoSwitchedHandler(async () => {
  closeEditor();
  await loadTree();
  await loadRepoInfo();
});
initRepoManager();

// ---------------- PWA ----------------
initPwa();

// ---------------- global keyboard shortcuts ----------------
// Escape closes find-bar / settings modal / editor, in that priority.
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if ($("findBar").classList.contains("open")) closeFindBar();
    else if ($("settingsBackdrop").classList.contains("open")) $("settingsBackdrop").classList.remove("open");
    else if (state.openFile) closeEditor();
  }
});

// ---------------- boot ----------------
initLogin();
if (state.PW && lockRemainingMs() <= 0) showApp().catch(() => showLogin());
else showLogin();
