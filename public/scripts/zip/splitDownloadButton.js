import { $ } from "../utils/dom.js";
import { downloadSelectionAsZip, downloadSelectionIndividually } from "./zipDownload.js";

function setBusy(btn, menuBtn) {
  return (busy, label) => {
    btn.disabled = busy;
    menuBtn.disabled = busy;
    if (label) btn.textContent = label;
    else btn.textContent = "Download as .zip";
  };
}

export function initSplitDownloadButton() {
  const zipBtn = $("downloadZipBtn");
  const toggleBtn = $("downloadSplitToggle");
  const menu = $("downloadSplitMenu");

  zipBtn.addEventListener("click", () => downloadSelectionAsZip(setBusy(zipBtn, toggleBtn)));
  // selection-bar's "Zip" button triggers the same download logic
  $("selBarZipBtn")?.addEventListener("click", () => downloadSelectionAsZip(setBusy(zipBtn, toggleBtn)));

  toggleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.classList.toggle("open");
  });
  document.addEventListener("click", () => menu.classList.remove("open"));

  $("downloadIndividuallyBtn").addEventListener("click", () => {
    menu.classList.remove("open");
    downloadSelectionIndividually(setBusy(zipBtn, toggleBtn));
  });
}
