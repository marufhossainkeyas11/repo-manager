import { state } from "../state.js";

// Expands the current selection (files + folders) into a flat list of
// {path, zipPath} — folders contribute every file beneath them (tree +
// staged additions, minus staged deletions), with zipPath prefixed by the
// folder's own name so the archive preserves that folder as a wrapper dir.
export function resolveSelectionToFiles() {
  const results = [];
  const seen = new Set();

  function allFilesUnder(folderPath) {
    const out = [];
    for (const f of state.tree) {
      if (state.staged.del.has(f.path)) continue;
      if (f.path === folderPath || f.path.startsWith(folderPath + "/")) out.push(f.path);
    }
    for (const p of state.staged.add.keys()) {
      if (p === folderPath || p.startsWith(folderPath + "/")) out.push(p);
    }
    return [...new Set(out)];
  }

  for (const path of state.selection.files) {
    if (state.staged.del.has(path)) continue;
    if (seen.has(path)) continue;
    seen.add(path);
    const name = path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path;
    results.push({ path, zipPath: name });
  }
  for (const folderPath of state.selection.folders) {
    const folderName = folderPath.split("/").pop();
    for (const filePath of allFilesUnder(folderPath)) {
      if (seen.has(filePath)) continue;
      seen.add(filePath);
      const rest = filePath.slice(folderPath.length); // includes leading "/"
      results.push({ path: filePath, zipPath: folderName + rest });
    }
  }
  return results;
}
