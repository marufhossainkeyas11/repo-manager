import { $ } from "../utils/dom.js";
import { state, REMEMBER_KEY } from "../state.js";
import { showLogin } from "./login.js";

$("logoutBtn").addEventListener("click", () => {
  sessionStorage.removeItem("rm_pw");
  localStorage.removeItem(REMEMBER_KEY);
  state.PW = "";
  showLogin();
});
