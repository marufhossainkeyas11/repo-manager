// Centralized app state. Other modules import and mutate these directly
// (same pattern as the original monolithic app.js used with module-level
// `let`s) — there's no framework/store here, just one shared source of
// truth so every module reads/writes the same objects instead of drifting
// out of sync copies.

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
  repoRegistry: null,       // {active, list, showRepoOnLogin} from /api/repos
};
