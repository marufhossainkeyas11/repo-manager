import { $ } from "../utils/dom.js";
import { currentEditorTextarea } from "./editor.js";

// Deliberately simple: case-insensitive substring only, no regex. Matches
// are recomputed on every input change; next/prev just walks the list.
let findMatches = [];   // array of start indices into ta.value
let findActiveIdx = -1;

export function openFindBar() {
  const ta = currentEditorTextarea();
  if (!ta) return; // no find inside non-text previews (image/binary)
  $("findBar").classList.add("open");
  $("editorFindBtn").classList.add("active");
  $("findInput").focus();
  $("findInput").select();
  runFindSearch();
}
export function closeFindBar() {
  $("findBar").classList.remove("open");
  $("editorFindBtn").classList.remove("active");
  $("findInput").value = "";
  findMatches = [];
  findActiveIdx = -1;
  $("findCount").textContent = "";
}
$("editorFindBtn").addEventListener("click", () => {
  if ($("findBar").classList.contains("open")) closeFindBar();
  else openFindBar();
});
$("findCloseBtn").addEventListener("click", closeFindBar);

function runFindSearch() {
  const ta = currentEditorTextarea();
  const q = $("findInput").value;
  findMatches = [];
  findActiveIdx = -1;
  if (!ta || !q) { $("findCount").textContent = ""; updateFindButtons(); return; }
  const haystack = ta.value.toLowerCase();
  const needle = q.toLowerCase();
  let from = 0;
  while (true) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    findMatches.push(idx);
    from = idx + needle.length;
  }
  if (findMatches.length > 0) {
    findActiveIdx = 0;
    goToMatch(0);
  } else {
    $("findCount").textContent = "0/0";
  }
  updateFindButtons();
}
$("findInput").addEventListener("input", runFindSearch);
$("findInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); e.shiftKey ? findStep(-1) : findStep(1); }
  if (e.key === "Escape") closeFindBar();
});

function updateFindButtons() {
  const has = findMatches.length > 0;
  $("findPrevBtn").disabled = !has;
  $("findNextBtn").disabled = !has;
}

function findStep(dir) {
  if (findMatches.length === 0) return;
  findActiveIdx = (findActiveIdx + dir + findMatches.length) % findMatches.length;
  goToMatch(findActiveIdx);
}
$("findPrevBtn").addEventListener("click", () => findStep(-1));
$("findNextBtn").addEventListener("click", () => findStep(1));

function goToMatch(idx) {
  const ta = currentEditorTextarea();
  const q = $("findInput").value;
  if (!ta || !q || findMatches[idx] === undefined) return;
  const start = findMatches[idx];
  const end = start + q.length;
  ta.focus();
  ta.setSelectionRange(start, end);
  // Modern browsers auto-scroll the caret into view from setSelectionRange
  // in most cases; as a fallback (older WebViews), estimate the line by
  // counting newlines up to the match and scroll manually.
  requestAnimationFrame(() => {
    const stillVisible = ta.selectionStart >= 0; // selection applied
    if (!stillVisible) return;
    const before = ta.value.slice(0, start);
    const line = before.split("\n").length - 1;
    const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 18;
    const approxTop = line * lineHeight;
    if (approxTop < ta.scrollTop || approxTop > ta.scrollTop + ta.clientHeight - lineHeight) {
      ta.scrollTop = Math.max(0, approxTop - ta.clientHeight / 2);
    }
  });
  $("findCount").textContent = `${idx + 1}/${findMatches.length}`;
}

// Ctrl/Cmd+F -> find bar — only while the editor textarea itself is
// focused, never as a global shortcut (Ctrl/Cmd+S is wired in editor.js).
document.addEventListener("keydown", (e) => {
  const ta = currentEditorTextarea();
  if (!ta || document.activeElement !== ta) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === "f") {
    e.preventDefault();
    openFindBar();
  }
});
