import { $ } from "../utils/dom.js";
import { MOBILE_MAX } from "../utils/breakpoints.js";

// Note: the original used a single 760px cutoff for the drawer; the new
// 3-tier system also opens the drawer on tablet widths (641-1024px) since
// the sidebar is still off-canvas there (see responsive.css) — so this
// checks against TABLET_MAX-equivalent behavior by reusing the same
// drawer classes for both tiers, only differing in width via CSS.
const DRAWER_ACTIVE_MAX = 1024;

export function openDrawer() {
  $("treeSidebar").classList.add("mobile-open");
  $("sidebarBackdrop").classList.add("open");
  // Push a history entry so the Android/iOS back gesture closes the
  // drawer instead of leaving the page.
  history.pushState({ rmDrawer: true }, "");
}
export function closeDrawer() {
  $("treeSidebar").classList.remove("mobile-open");
  $("sidebarBackdrop").classList.remove("open");
}

export function initMobileDrawer() {
  $("hamburgerBtn").addEventListener("click", openDrawer);
  $("treeSidebarClose")?.addEventListener("click", closeDrawer);
  $("sidebarBackdrop").addEventListener("click", closeDrawer);
  window.addEventListener("popstate", () => {
    if ($("treeSidebar").classList.contains("mobile-open")) closeDrawer();
  });

  // simple edge-swipe: swipe right from near the left edge to open,
  // swipe left anywhere in the open drawer to close.
  let touchStartX = null;
  document.addEventListener("touchstart", (e) => {
    if (window.innerWidth > DRAWER_ACTIVE_MAX) return;
    touchStartX = e.touches[0].clientX;
  }, { passive: true });
  document.addEventListener("touchend", (e) => {
    if (window.innerWidth > DRAWER_ACTIVE_MAX || touchStartX === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const drawerOpen = $("treeSidebar").classList.contains("mobile-open");
    if (!drawerOpen && touchStartX < 24 && dx > 60) openDrawer();
    else if (drawerOpen && dx < -60) closeDrawer();
    touchStartX = null;
  }, { passive: true });
}
