import { $, escapeHtml } from "../utils/dom.js";
import { state } from "../state.js";
import { toast } from "../utils/toast.js";
import { bytesToBase64 } from "../utils/base64.js";
import { stageAdd } from "../staging/stagedChanges.js";
import { formatSize } from "../utils/format.js";
import { checkFileSize, summarizeBatch } from "./fileLimitCheck.js";
import { preScanZip, extractAndStage } from "./zipExtract.js";

// Shows the "what do you want to do with this .zip?" dialog (section 5.2):
// extract-and-merge into the current folder, or keep it as a single raw
// .zip file (staged like any other binary). Returns nothing — both paths
// stage directly.
export function handleZipFile(file, buf) {
  const scan = preScanZip(buf);
  if (scan.error) {
    // Not a valid zip, or fflate couldn't parse it — fall back to staging
    // it as a raw file rather than blocking the upload entirely.
    stageRawZip(file, buf);
    return;
  }

  $("zipDecisionName").textContent = file.name;
  $("zipDecisionMeta").textContent = `${scan.entries.length} file${scan.entries.length === 1 ? "" : "s"} · ${formatSize(scan.totalBytes)}`;
  $("zipDecisionBackdrop").classList.add("open");

  const onExtract = () => {
    close();
    extractAndStage(scan.entries, state.currentFolder, (done, total) => {
      if (done === total) toast(`Extracted ${total} file(s) from <b>${escapeHtml(file.name)}</b>`);
    });
  };
  const onKeepZip = () => {
    close();
    stageRawZip(file, buf);
  };
  const onCancel = () => close();

  function close() {
    $("zipDecisionBackdrop").classList.remove("open");
    $("zipDecisionExtract").removeEventListener("click", onExtract);
    $("zipDecisionKeep").removeEventListener("click", onKeepZip);
    $("zipDecisionCancel").removeEventListener("click", onCancel);
  }
  $("zipDecisionExtract").addEventListener("click", onExtract);
  $("zipDecisionKeep").addEventListener("click", onKeepZip);
  $("zipDecisionCancel").addEventListener("click", onCancel);
}

function stageRawZip(file, buf) {
  const path = state.currentFolder ? `${state.currentFolder}/${file.name}` : file.name;
  if (!checkFileSize(path, buf.byteLength)) return;
  stageAdd(path, { content: bytesToBase64(new Uint8Array(buf)), encoding: "base64" });
  toast(`Staged <b>${escapeHtml(file.name)}</b>`);
}

// Entry point called by dragdrop/fileDrop.js and the file-input change
// handler for any .zip file (upload path only — downloads are
// zip/zipDownload.js). Detection is by extension, matching the rest of
// this project's extension-based file typing (utils/format.js).
export function isZipFile(file) { return file.name.toLowerCase().endsWith(".zip"); }
