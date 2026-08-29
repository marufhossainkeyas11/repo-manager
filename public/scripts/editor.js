import { $, escapeHtml } from "../utils/dom.js";
import { state } from "../state.js";
import { api } from "../api.js";
import { stageAdd } from "../staging/stage.js";
import { base64ToUtf8, utf8ToBase64 } from "../utils/base64.js";
import { formatSize } from "../utils/format.js";
import { isImageFile, isTextFile, extOf } from "../utils/fileTypes.js";
import { fileIcon } from "../utils/icons.js";
import { toast } from "../utils/toast.js";
import { closeFindBar } from "./find.js";

let onSaved = () => {};
export function setSavedHandler(fn) { onSaved = fn; }

export function currentEditorTextarea() {
  return $("editorBody").querySelector("textarea");
}

export async function openFileInEditor(f) {
  state.openFile = f.path;
  closeFindBar();
  $("editorPanel").classList.add("open");
  $("editorResizeHandle").classList.add("visible");
  $("editorName").textContent = f.path;
  $("editorMeta").textContent = formatSize(f.size || 0);
  $("editorStatus").textContent = "";
  $("editorSaveBtn").style.display = "none";
  const body = $("editorBody");
  body.innerHTML = `<div class="no-preview">Loading…</div>`;

  try {
    let base64content;
    if (f.staged) {
      const entry = state.staged.add.get(f.path);
      base64content = entry.content;
    } else {
      const blob = await api(`/api/blob?sha=${encodeURIComponent(f.sha)}`);
      base64content = blob.content.replace(/\n/g, "");
    }

    if (isImageFile(f.path)) {
      const ext = extOf(f.path);
      const mime = ext === "svg" ? "image/svg+xml" : `image/${ext === "jpg" ? "jpeg" : ext}`;
      body.innerHTML = `<div class="img-preview"><img src="data:${mime};base64,${base64content}" /></div>`;
    } else if (isTextFile(f.path) || (f.size || 0) < 200000) {
      let text;
      try { text = base64ToUtf8(base64content); } catch { text = ""; }
      body.innerHTML = "";
      const ta = document.createElement("textarea");
      ta.spellcheck = false;
      ta.value = text;
      ta.dataset.original = text;
      ta.addEventListener("input", () => {
        $("editorSaveBtn").style.display = ta.value !== ta.dataset.original ? "inline-flex" : "none";
      });
      body.appendChild(ta);
      ta.focus();
    } else {
      body.innerHTML = `<div class="no-preview">${fileIcon(false)}<div>No inline preview for this file type.<br/>Download it from GitHub directly, or drag a replacement in to overwrite it.</div></div>`;
    }
  } catch (err) {
    body.innerHTML = `<div class="no-preview">Couldn't load this file: ${escapeHtml(err.message)}</div>`;
  }
}

export function closeEditor() {
  state.openFile = null;
  $("editorPanel").classList.remove("open");
  $("editorResizeHandle").classList.remove("visible");
  $("editorBody").innerHTML = "";
  closeFindBar();
}
$("editorCloseBtn").addEventListener("click", closeEditor);

$("editorSaveBtn").addEventListener("click", () => {
  if (!state.openFile) return;
  const ta = currentEditorTextarea();
  if (!ta) return;
  const content = utf8ToBase64(ta.value);
  stageAdd(state.openFile, content, "base64");
  ta.dataset.original = ta.value;
  $("editorSaveBtn").style.display = "none";
  $("editorStatus").textContent = "Staged — commit to save to GitHub";
  toast(`Staged edit: <b>${escapeHtml(state.openFile.split("/").pop())}</b>`, "ok");
  onSaved();
});

function editorSelectAll() {
  const ta = currentEditorTextarea();
  if (!ta) return;
  ta.focus();
  ta.select();
}
$("editorSelectAllBtn").addEventListener("click", editorSelectAll);
$("editorOverflowSelectAll").addEventListener("click", () => { $("editorOverflowMenu").classList.remove("open"); editorSelectAll(); });

async function editorCopy() {
  const ta = currentEditorTextarea();
  if (!ta) return;
  try {
    await navigator.clipboard.writeText(ta.value);
    toast("Copied file contents.", "ok");
  } catch {
    toast("Couldn't copy — your browser may be blocking clipboard access.", "err");
  }
}
$("editorCopyBtn").addEventListener("click", editorCopy);
$("editorOverflowCopy").addEventListener("click", () => { $("editorOverflowMenu").classList.remove("open"); editorCopy(); });

$("editorOverflowBtn").addEventListener("click", (e) => { e.stopPropagation(); $("editorOverflowMenu").classList.toggle("open"); });
document.addEventListener("click", () => $("editorOverflowMenu").classList.remove("open"));

// Ctrl/Cmd+S -> save; Ctrl/Cmd+F handled in find.js — only while the
// editor textarea itself is focused, never as a global shortcut.
document.addEventListener("keydown", (e) => {
  const ta = currentEditorTextarea();
  if (!ta || document.activeElement !== ta) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === "s") {
    e.preventDefault();
    $("editorSaveBtn").click();
  }
});
