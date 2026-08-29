import { $ } from "../utils/dom.js";

// Opening the drawer pushes a history entry so the phone/browser back
// button closes it instead of navigating away from the app (section 4.1
// mobile-nav requirement). popstate then closes it without pushing again.
export function openDrawer() {
  $("treeSidebar").classList.add("mobile-open");
  $("sidebarBackdrop").classList.add("open");
  history.pushState({ drawer: true }, "");
}
export function closeDrawer() {
  $("treeSidebar").classList.remove("mobile-open");
  $("sidebarBackdrop").classList.remove("open");
}

$("sidebarBackdrop").addEventListener("click", () => history.back());

window.addEventListener("popstate", () => {
  if ($("treeSidebar").classList.contains("mobile-open")) closeDrawer();
});

// Simple edge-swipe: swipe right from near the left edge to open, swipe
// left anywhere in the open drawer to close. Mirrors the original app's
// gesture threshold (760px width cutoff, 24px edge zone, 60px swipe).
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
  else if (drawerOpen && dx < -60) history.back();
  touchStartX = null;
}, { passive: true });
