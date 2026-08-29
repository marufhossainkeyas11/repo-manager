// Centralized app state. Every module reads/writes through here instead of
// keeping its own copy, so there's one source of truth for what's on
// screen. Kept intentionally simple (plain mutable object + exported
// getters/setters) rather than a framework store, matching the rest of
// this project's no-framework, no-bundler approach.

export const REMEMBER_KEY = "rm_pw_remember"; // localStorage: password persisted across browser restarts, opt-in

export const state = {
  PW: sessionStorage.getItem("rm_pw") || localStorage.getItem(REMEMBER_KEY) || "",
  tree: [],                 // flat list from /api/tree: [{path, sha, size}]
  treeIndex: null,          // nested folder structure built from `tree`
  staged: { add: new Map(), del: new Set() }, // add: path -> {content?,sha?,encoding}, del: set of paths
  currentFolder: "",        // "" = root
  expanded: new Set([""]),  // expanded folder paths in the sidebar
  openFile: null,           // path of file currently open in the editor
  repoInfo: null,
  selection: { files: new Set(), folders: new Set() }, // persists across folder navigation
  selectionMode: false,     // mobile: explicit selection-mode toggle (section 4.2)
};

export function resetStaged() {
  state.staged = { add: new Map(), del: new Set() };
}

export function resetSelection() {
  state.selection = { files: new Set(), folders: new Set() };
}

export function selectionCount() {
  return state.selection.files.size + state.selection.folders.size;
}
