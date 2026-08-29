import { $, escapeHtml } from "../utils/dom.js";
import { state } from "../state.js";
import { toast } from "../utils/toast.js";
import { bytesToBase64 } from "../utils/base64.js";
import { stageAdd } from "../staging/stagedChanges.js";
import { checkFileSize, summarizeBatch } from "../zip/fileLimitCheck.js";
import { handleZipFile, isZipFile } from "../zip/zipUpload.js";

async function handleFiles(fileList) {
  const files = [...fileList];
  let staged = 0, skipped = 0;
  for (const file of files) {
    const buf = await file.arrayBuffer();
    if (isZipFile(file)) {
      // Zips get their own decision dialog (section 5.2) rather than being
      // staged directly — handled one at a time so each gets its own choice.
      handleZipFile(file, buf);
      continue;
    }
    const path = state.currentFolder ? `${state.currentFolder}/${file.name}` : file.name;
    if (!checkFileSize(path, buf.byteLength)) { skipped++; continue; }
    stageAdd(path, { content: bytesToBase64(new Uint8Array(buf)), encoding: "base64" });
    staged++;
  }
  if (staged > 0) {
    toast(staged === 1 ? `Staged <b>${escapeHtml(files.find((f) => !isZipFile(f))?.name || "")}</b>` : `Staged ${staged} file(s)`);
  }
  summarizeBatch(staged, skipped);
}

const dropzone = $("dropzone");
const fileInput = $("fileInput");

dropzone.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", (e) => { handleFiles(e.target.files); fileInput.value = ""; });

["dragenter", "dragover"].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.add("drag"); });
});
["dragleave", "drop"].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.remove("drag"); });
});
dropzone.addEventListener("drop", (e) => {
  if (e.dataTransfer.files && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
});

// Whole-window drag-over expands the dropzone from its slim "click or drag"
// strip into the full-size target, and works anywhere over the file list —
// not just when hovering the strip itself.
let dragDepth = 0;
window.addEventListener("dragenter", (e) => {
  if (![...e.dataTransfer.types].includes("Files")) return;
  dragDepth++;
  dropzone.classList.add("expanded");
});
window.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropzone.classList.remove("expanded", "drag");
});
window.addEventListener("drop", () => { dragDepth = 0; dropzone.classList.remove("expanded"); });
window.addEventListener("dragover", (e) => e.preventDefault());

export { handleFiles };
