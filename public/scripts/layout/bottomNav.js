import { $ } from "../utils/dom.js";
import { stagedCount } from "../staging/stage.js";

let onOpenNewSheet = () => {};
export function setOpenNewSheetHandler(fn) { onOpenNewSheet = fn; }
let onOpenSettings = () => {};
export function setOpenSettingsHandler(fn) { onOpenSettings = fn; }
let onOpenDrawer = () => {};
export function setOpenDrawerHandler(fn) { onOpenDrawer = fn; }

export function updateBottomNavBadge() {
  const badge = $("bottomNavChangesBadge");
  if (!badge) return;
  const count = stagedCount();
  badge.textContent = count > 99 ? "99+" : String(count);
  badge.style.display = count > 0 ? "flex" : "none";
}

function setActiveTab(name) {
  document.querySelectorAll("#bottomNav button[data-tab]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === name);
  });
}

export function initBottomNav() {
  $("navFilesBtn")?.addEventListener("click", () => { setActiveTab("files"); onOpenDrawer(); });
  $("navSearchBtn")?.addEventListener("click", () => {
    setActiveTab("search");
    $("search")?.focus();
    // top toolbar (with search) is hidden on mobile by default via CSS
    // unless actively searching — briefly reveal it for input
    $("toolbar").style.setProperty("display", "flex", "important");
    $("search")?.scrollIntoView({ block: "nearest" });
  });
  $("navNewBtn")?.addEventListener("click", () => { setActiveTab("new"); onOpenNewSheet(); });
  $("navChangesBtn")?.addEventListener("click", () => {
    setActiveTab("changes");
    $("stageList").classList.remove("collapsed");
    $("stageChev").classList.remove("collapsed");
    $("stageDrawer")?.scrollIntoView({ block: "end", behavior: "smooth" });
  });
  $("navSettingsBtn")?.addEventListener("click", () => { setActiveTab("settings"); onOpenSettings(); });
}
