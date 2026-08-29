import { $ } from "./utils/dom.js";
import { toast } from "./utils/toast.js";
import { state } from "./state.js";
import { api } from "./api.js";

import { buildTreeIndex } from "./tree/treeIndex.js";
import { renderSidebar } from "./tree/sidebar.js";
import { renderBreadcrumb, setRenderFileList, navigateTo } from "./tree/breadcrumb.js";

import { renderFileList, setOpenFileInEditor } from "./file-list/fileList.js";
import { setEditorFns } from "./file-list/fileActions.js";
import { updateSelectionToolbar } from "./file-list/selection.js";
import "./file-list/downloadActions.js";

import { setStagingRenderers } from "./staging/stagedChanges.js";
import { renderStage } from "./staging/stageDrawer.js";
import { setCommitDeps } from "./staging/commit.js";

import { openFileInEditor, closeEditor } from "./editor/editor.js";
import { closeFindBar } from "./editor/findInFile.js";

import { showLogin, setShowApp } from "./auth/login.js";
import "./auth/logout.js";

import { setSettingsDeps } from "./repoManager/settingsModal.js";
import { maybeShowIosHint } from "./pwa/install.js";

import "./layout/mobileDrawer.js";
import "./layout/resizablePanels.js";
import "./layout/overflowMenu.js";
import "./layout/bottomNav.js";
import { updateNavBadge, updateNavActiveStates } from "./layout/bottomNav.js";

import "./dragdrop/fileDrop.js";
import "./pwa/serviceWorkerRegister.js";

// ---------------- wire up circular-dependency callbacks ----------------
// Every module above is self-contained and registers its own DOM
// listeners on import; these setters just hand over the handful of
// functions that would otherwise create import cycles (see each module's
// own comments for why).
setRenderFileList(renderFileList);
setOpenFileInEditor(openFileInEditor);
setEditorFns({ closeEditor, openFileInEditor });
setStagingRenderers({ renderFileList, renderStage: renderStageAndBadge });
setShowApp(showApp);
setCommitDeps({ loadTree, closeEditor });
setSettingsDeps({ closeEditor, loadTree, loadRepoInfo });

function renderStageAndBadge() {
  renderStage();
  updateNavBadge(state.staged.add.size + state.staged.del.size);
  updateNavActiveStates();
}

// ---------------- data loading ----------------
export async function loadTree() {
  const data = await api("/api/tree");
  state.tree = data.files;
  $("branchName").textContent = data.branch;
  buildTreeIndex();
  renderSidebar();
  renderFileList();
  renderBreadcrumb();
  renderStageAndBadge();
}

export async function loadRepoInfo() {
  try {
    state.repoInfo = await api("/api/repo");
    $("repoName").textContent = `${state.repoInfo.owner}/${state.repoInfo.repo}`;
    $("repoLink").href = state.repoInfo.htmlUrl;
    renderBreadcrumb();
  } catch {
    // non-fatal — tree already loaded, repo metadata is just cosmetic
  }
}

async function doRefresh() {
  try { await loadTree(); toast("Refreshed."); }
  catch (err) { toast("Couldn't refresh: " + err.message, "err"); }
}
$("refreshBtn").addEventListener("click", doRefresh);

$("search").addEventListener("input", renderFileList);

// ---------------- show app / boot ----------------
export async function showApp() {
  $("login").style.display = "none";
  $("app").style.display = "flex";
  await loadTree();
  await loadRepoInfo();
}

// ---------------- global keyboard shortcuts ----------------
// Escape closes find-bar / settings modal / editor, in that priority.
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if ($("findBar").classList.contains("open")) closeFindBar();
    else if ($("settingsBackdrop").classList.contains("open")) $("settingsBackdrop").classList.remove("open");
    else if (state.openFile) closeEditor();
  }
});

maybeShowIosHint();

// ---------------- boot ----------------
import { updateLockoutUI, lockRemainingMs } from "./auth/lockout.js";
updateLockoutUI();
if (state.PW && lockRemainingMs() <= 0) showApp().catch(() => showLogin());
else showLogin();
