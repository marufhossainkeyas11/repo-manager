import { state } from "../state.js";
import { approxSize } from "../utils/base64.js";

export function findFolder(path) {
  if (!path) return state.treeIndex;
  const parts = path.split("/");
  let node = state.treeIndex;
  for (const seg of parts) {
    if (!node.folders.has(seg)) return null;
    node = node.folders.get(seg);
  }
  return node;
}

export function buildTreeIndex() {
  const root = { path: "", folders: new Map(), files: [] };
  for (const f of state.tree) {
    if (state.staged.del.has(f.path)) continue;
    const parts = f.path.split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      const p = parts.slice(0, i + 1).join("/");
      if (!node.folders.has(seg)) node.folders.set(seg, { path: p, folders: new Map(), files: [] });
      node = node.folders.get(seg);
    }
    node.files.push(f);
  }
  // fold in staged additions so new/renamed/moved files show up before commit
  for (const [path, entry] of state.staged.add) {
    const parts = path.split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      const p = parts.slice(0, i + 1).join("/");
      if (!node.folders.has(seg)) node.folders.set(seg, { path: p, folders: new Map(), files: [] });
      node = node.folders.get(seg);
    }
    if (!node.files.find((x) => x.path === path)) {
      node.files.push({ path, sha: entry.sha || null, size: entry.content ? approxSize(entry.content) : 0, staged: true });
    }
  }
  state.treeIndex = root;
}

// Total file count under a folder node, recursive — used for the sidebar
// drawer's file-count badge (section 4.2).
export function countFilesUnder(node) {
  let count = node.files.length;
  for (const child of node.folders.values()) count += countFilesUnder(child);
  return count;
}
