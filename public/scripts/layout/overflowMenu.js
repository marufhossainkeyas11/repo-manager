import { $ } from "../utils/dom.js";

const toggle = $("headerOverflowBtn");
const menu = $("headerOverflowMenu");

toggle.addEventListener("click", (e) => {
  e.stopPropagation();
  menu.classList.toggle("open");
});
document.addEventListener("click", (e) => {
  if (!menu.contains(e.target) && e.target !== toggle) menu.classList.remove("open");
});

// Forward taps on the overflow-menu copies of Refresh/Sign out/Install to
// the same buttons the desktop header already has listeners on, instead of
// duplicating that logic here.
$("headerOverflowRefresh").addEventListener("click", () => { menu.classList.remove("open"); $("refreshBtn").click(); });
$("headerOverflowLogout").addEventListener("click", () => { menu.classList.remove("open"); $("logoutBtn").click(); });
$("headerOverflowInstall").addEventListener("click", () => { menu.classList.remove("open"); $("installBtn").click(); });
