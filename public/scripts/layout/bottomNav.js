import { $ } from "../utils/dom.js";
import { state, selectionCount } from "../state.js";
import { navigateTo } from "../tree/breadcrumb.js";
import { enterSelectionMode, exitSelectionMode, updateSelectionToolbar } from "../file-list/selection.js";

// Mobile-only (display:none above 640px via responsive.css). Left to
// right: Home, New, Select, Search, Staged — mirrors a native file
// manager's bottom bar rather than reusing the desktop top toolbar, which
// doesn't fit in thumb reach on a phone.
$("navHomeBtn").addEventListener("click", () => navigateTo(""));

$("navNewBtn").addEventListener("click", () => {
  $("newSheetBackdrop").classList.add("open");
});
$("newSheetBackdrop").addEventListener("click", (e) => { if (e.target === $("newSheetBackdrop")) closeNewSheet(); });
function closeNewSheet() { $("newSheetBackdrop").classList.remove("open"); }
$("newSheetFolder").addEventListener("click", () => { closeNewSheet(); $("newFolderBtn").click(); });
$("newSheetFile").addEventListener("click", () => { closeNewSheet(); $("newFileBtn").click(); });
$("newSheetUpload").addEventListener("click", () => { closeNewSheet(); $("fileInput").click(); });

$("navSelectBtn").addEventListener("click", () => {
  if (state.selectionMode || selectionCount() > 0) {
    exitSelectionMode();
  } else {
    enterSelectionMode();
  }
  updateNavActiveStates();
});

$("navSearchBtn").addEventListener("click", () => {
  // Search lives in the (normally desktop-only) top toolbar — bring it
  // into view and focus it rather than duplicating a second search input.
  $("toolbar").classList.remove("selection-hidden");
  $("toolbar").style.display = "flex";
  $("search").focus();
});

$("navStagedBtn").addEventListener("click", () => {
  $("stageList").classList.remove("collapsed");
  $("stageChev").classList.remove("collapsed");
  $("stageDrawer").scrollIntoView({ behavior: "smooth", block: "end" });
});

export function updateNavBadge(count) {
  const badge = $("navStagedBadge");
  badge.textContent = String(count);
  badge.classList.toggle("show", count > 0);
}

export function updateNavActiveStates() {
  $("navSelectBtn").classList.toggle("active", state.selectionMode || selectionCount() > 0);
}
