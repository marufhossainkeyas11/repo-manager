import { $, escapeHtml } from "../utils/dom.js";
import { state } from "../state.js";
import { stageAdd } from "../staging/stage.js";
import { toast } from "../utils/toast.js";
import { openPrompt } from "../utils/prompt.js";

let onCreated = () => {};
export function setCreatedHandler(fn) { onCreated = fn; }
let onNavigate = () => {};
export function setNavigateHandler(fn) { onNavigate = fn; }
let onOpenFile = () => {};
export function setOpenFileHandler(fn) { onOpenFile = fn; }

export function createNewFolder() {
  openPrompt({
    title: "New folder",
    hint: "Git doesn't track empty folders — a small .gitkeep file is added so it shows up after committing.",
    initial: state.currentFolder ? state.currentFolder + "/" : "",
    confirmLabel: "Create",
    onConfirm: (v) => {
      let path = v.trim().replace(/^\/+/, "").replace(/\/+$/, "");
      if (!path) return;
      stageAdd(path + "/.gitkeep", "", "base64");
      toast(`Staged new folder <b>${escapeHtml(path)}</b>`, "ok");
      onCreated();
      onNavigate(path);
    },
  });
}

export function createNewFile() {
  openPrompt({
    title: "New file",
    hint: "Give it a full path and name — it opens in the editor right away.",
    initial: state.currentFolder ? state.currentFolder + "/" : "",
    confirmLabel: "Create",
    onConfirm: (v) => {
      let path = v.trim().replace(/^\/+/, "");
      if (!path) return;
      if (state.tree.find((x) => x.path === path) || state.staged.add.has(path)) {
        toast("A file already exists at that path.", "err");
        return;
      }
      stageAdd(path, "", "base64");
      toast(`Created <b>${escapeHtml(path.split("/").pop())}</b>`, "ok");
      onCreated();
      onOpenFile({ path, staged: true });
    },
  });
}

function closeMenu() { $("newMenu").classList.remove("open"); }

export function initNewMenu() {
  $("newFolderBtn").addEventListener("click", () => { closeMenu(); createNewFolder(); });
  $("newFileBtn").addEventListener("click", () => { closeMenu(); createNewFile(); });
  $("uploadFilesBtn").addEventListener("click", () => { closeMenu(); $("fileInput").click(); });
  $("newMenuBtn").addEventListener("click", (e) => { e.stopPropagation(); $("newMenu").classList.toggle("open"); });
  document.addEventListener("click", (e) => { if (!e.target.closest(".toolbar-menu-wrap")) closeMenu(); });
}

// mobile bottom sheet variant — same three actions, sheet UI
export function openNewBottomSheet() {
  const backdrop = $("newSheetBackdrop");
  $("newSheetBackdrop").classList.add("open");
}
export function initNewBottomSheet() {
  $("newSheetFolderBtn")?.addEventListener("click", () => { $("newSheetBackdrop").classList.remove("open"); createNewFolder(); });
  $("newSheetFileBtn")?.addEventListener("click", () => { $("newSheetBackdrop").classList.remove("open"); createNewFile(); });
  $("newSheetUploadBtn")?.addEventListener("click", () => { $("newSheetBackdrop").classList.remove("open"); $("fileInput").click(); });
  $("newSheetBackdrop")?.addEventListener("click", (e) => { if (e.target === $("newSheetBackdrop")) $("newSheetBackdrop").classList.remove("open"); });
}
