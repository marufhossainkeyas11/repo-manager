import { $ } from "../utils/dom.js";
import { state } from "../state.js";
import { stageAdd } from "../staging/stage.js";
import { bytesToBase64 } from "../utils/base64.js";
import { sizeVerdict, MAX_BYTES } from "../utils/sizeLimits.js";
import { toast } from "../utils/toast.js";
import { isZipFile, handleZipUpload } from "../zip/zipUpload.js";

let onAfterUpload = () => {};
export function setAfterUploadHandler(fn) { onAfterUpload = fn; }

async function uploadOneFile(file, destFolder) {
  const verdict = sizeVerdict(file.size);
  if (verdict === "block") {
    toast(`"${file.name}" is over GitHub's 100MB per-file limit — skipped.`, "err");
    return false;
  }
  if (verdict === "warn") {
    toast(`"${file.name}" is large (${(file.size / (1024 * 1024)).toFixed(0)}MB) — staged, but double-check before committing.`, "warn");
  }
  const buf = await file.arrayBuffer();
  const b64 = bytesToBase64(new Uint8Array(buf));
  const path = destFolder ? `${destFolder}/${file.name}` : file.name;
  stageAdd(path, b64, "base64");
  return true;
}

export async function handleDroppedFiles(fileList, destFolder) {
  const files = [...fileList];
  const zipFiles = files.filter((f) => isZipFile(f));
  const normalFiles = files.filter((f) => !isZipFile(f));

  for (const zip of zipFiles) {
    await handleZipUpload(zip, destFolder);
  }
  let uploaded = 0;
  for (const f of normalFiles) {
    if (await uploadOneFile(f, destFolder)) uploaded++;
  }
  if (uploaded > 0) toast(`Staged ${uploaded} file${uploaded === 1 ? "" : "s"}.`, "ok");
  onAfterUpload();
}

export function initDropzone() {
  const dz = $("dropzone");
  const input = $("fileInput");

  dz.addEventListener("click", (e) => {
    if (e.target.closest("button")) return;
    input.click();
  });
  input.addEventListener("change", () => {
    if (input.files.length) handleDroppedFiles(input.files, state.currentFolder);
    input.value = "";
  });

  let dragCounter = 0;
  dz.addEventListener("dragenter", (e) => { e.preventDefault(); dragCounter++; dz.classList.add("drag"); });
  dz.addEventListener("dragover", (e) => e.preventDefault());
  dz.addEventListener("dragleave", () => { dragCounter--; if (dragCounter <= 0) { dragCounter = 0; dz.classList.remove("drag"); } });
  dz.addEventListener("drop", (e) => {
    e.preventDefault();
    dragCounter = 0;
    dz.classList.remove("drag");
    if (e.dataTransfer.files.length) handleDroppedFiles(e.dataTransfer.files, state.currentFolder);
  });

  // whole-window drag detection to expand the (otherwise slim) dropzone
  let windowDragCounter = 0;
  window.addEventListener("dragenter", (e) => {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    windowDragCounter++;
    dz.classList.add("expanded");
  });
  window.addEventListener("dragleave", () => {
    windowDragCounter--;
    if (windowDragCounter <= 0) { windowDragCounter = 0; dz.classList.remove("expanded"); }
  });
  window.addEventListener("drop", () => { windowDragCounter = 0; dz.classList.remove("expanded"); });
  window.addEventListener("dragover", (e) => e.preventDefault());
}
