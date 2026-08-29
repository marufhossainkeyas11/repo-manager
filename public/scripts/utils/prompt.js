import { $ } from "../utils/dom.js";

let promptState = null;

export function openPrompt({ title, hint, initial, confirmLabel, onConfirm, onCancel, hideInput }) {
  $("promptTitle").textContent = title;
  $("promptHint").textContent = hint || "";
  $("promptInput").value = initial || "";
  $("promptInput").style.display = hideInput ? "none" : "";
  $("promptConfirm").textContent = confirmLabel || "Create";
  promptState = { onConfirm, onCancel, hideInput };
  $("promptBackdrop").classList.add("open");
  if (!hideInput) setTimeout(() => { $("promptInput").focus(); $("promptInput").select(); }, 30);
}
function closePrompt(cancelled) {
  if (cancelled && promptState && promptState.onCancel) promptState.onCancel();
  $("promptBackdrop").classList.remove("open");
  $("promptInput").style.display = "";
  promptState = null;
}
$("promptCancel").addEventListener("click", () => closePrompt(true));
$("promptBackdrop").addEventListener("click", (e) => { if (e.target === $("promptBackdrop")) closePrompt(true); });
$("promptConfirm").addEventListener("click", () => {
  const v = $("promptInput").value;
  if (promptState) promptState.onConfirm(v);
  closePrompt(false);
});
$("promptInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { $("promptConfirm").click(); }
  if (e.key === "Escape") closePrompt(true);
});
