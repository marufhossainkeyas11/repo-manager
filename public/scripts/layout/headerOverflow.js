import { $ } from "../utils/dom.js";

export function initHeaderOverflow() {
  $("headerOverflowBtn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    $("headerOverflowMenu").classList.toggle("open");
  });
  document.addEventListener("click", () => $("headerOverflowMenu")?.classList.remove("open"));

  // proxy clicks through to the real (hidden-on-mobile) buttons so all the
  // actual refresh/logout logic stays in one place (main.js / auth/login.js)
  $("headerOverflowRefresh")?.addEventListener("click", () => {
    $("headerOverflowMenu").classList.remove("open");
    $("refreshBtn").click();
  });
  $("headerOverflowLogout")?.addEventListener("click", () => {
    $("headerOverflowMenu").classList.remove("open");
    $("logoutBtn").click();
  });
}
