import { $, escapeHtml } from "../utils/dom.js";
import { prescan, extractAndStage } from "./zipExtract.js";
import { stageAdd } from "../staging/stage.js";
import { bytesToBase64 } from "../utils/base64.js";
import { formatSize } from "../utils/format.js";
import { sizeVerdict } from "../utils/sizeLimits.js";
import { toast } from "../utils/toast.js";

export function isZipFile(file) {
  return file.name.toLowerCase().endsWith(".zip");
}

function joinPath(dir, name) { return dir ? `${dir}/${name}` : name; }

// Shows the zip decision modal for a single zip file and resolves once the
// user has picked (or the extraction has finished). Multiple zips dropped
// together are handled serially by the caller (dropzone.js) — one dialog
// resolves before the next opens, per the plan's "simplest to implement
// first" note.
export function handleZipUpload(file, destFolder) {
  return new Promise(async (resolve) => {
    const buf = new Uint8Array(await file.arrayBuffer());
    let scan;
    try {
      scan = prescan(buf);
    } catch (err) {
      toast(`Couldn't read "${escapeHtml(file.name)}" as a zip: ${escapeHtml(err.message)}`, "err");
      resolve();
      return;
    }
    if (scan.entries.length === 0) {
      toast(`No files found in "${escapeHtml(file.name)}".`, "err");
      resolve();
      return;
    }

    openZipDecisionModal({
      fileName: file.name,
      fileCount: scan.entries.length,
      totalBytes: scan.totalBytes,
      onExtract: async () => {
        closeZipDecisionModal();
        await runExtractWithProgress(scan.entries, destFolder);
        resolve();
      },
      onKeepAsZip: async () => {
        closeZipDecisionModal();
        const verdict = sizeVerdict(file.size);
        if (verdict === "block") {
          toast(`"${escapeHtml(file.name)}" is over GitHub's 100MB per-file limit — skipped.`, "err");
          resolve();
          return;
        }
        if (verdict === "warn") {
          toast(`"${escapeHtml(file.name)}" is large (${(file.size / (1024 * 1024)).toFixed(0)}MB) — staged, but consider Git LFS.`, "warn");
        }
        const b64 = bytesToBase64(buf);
        const path = joinPath(destFolder, file.name);
        stageAdd(path, b64, "base64");
        toast(`Staged "${escapeHtml(path)}" as a .zip file (not extracted).`, "ok");
        resolve();
      },
    });
  });
}

async function runExtractWithProgress(entries, destFolder) {
  const total = entries.length;
  const showProgress = total > 20;
  if (showProgress) showZipProgress(0, total);
  await extractAndStage(entries, destFolder, (done, tot) => {
    if (showProgress) showZipProgress(done, tot);
  });
  if (showProgress) hideZipProgress();
}

function showZipProgress(done, total) {
  let bar = $("zipProgressToast");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "zipProgressToast";
    bar.className = "toast";
    bar.innerHTML = `<div class="toast-body">Extracting <span id="zipProgressText"></span>…</div>`;
    $("status").appendChild(bar);
  }
  $("zipProgressText").textContent = `${done}/${total} files`;
}
function hideZipProgress() {
  $("zipProgressToast")?.remove();
}

let currentDecision = null;

function openZipDecisionModal({ fileName, fileCount, totalBytes, onExtract, onKeepAsZip }) {
  currentDecision = { onExtract, onKeepAsZip };
  $("zipDecisionName").textContent = fileName;
  $("zipDecisionMeta").textContent = `${fileCount} file${fileCount === 1 ? "" : "s"} inside · ${formatSize(totalBytes)}`;
  $("zipDecisionBackdrop").classList.add("open");
}
function closeZipDecisionModal() {
  $("zipDecisionBackdrop").classList.remove("open");
  currentDecision = null;
}

$("zipExtractBtn").addEventListener("click", () => currentDecision?.onExtract());
$("zipKeepBtn").addEventListener("click", () => currentDecision?.onKeepAsZip());
