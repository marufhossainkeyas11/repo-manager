import { state } from "../state.js";
import { api } from "../api.js";
import { base64ToUtf8 } from "../utils/base64.js";

// Retrieves a file's content as base64, either from an already-staged
// addition (fast path — no network call) or by fetching the blob from
// GitHub via its sha (used for rename/duplicate/move of unmodified files).
export async function getFileContentForStaging(path) {
  const staged = state.staged.add.get(path);
  if (staged) return { content: staged.content, encoding: staged.encoding || "base64" };
  const meta = state.tree.find((f) => f.path === path);
  if (!meta) throw new Error(`File not found: ${path}`);
  const blob = await api(`/api/blob?sha=${meta.sha}`);
  return { content: blob.content, encoding: blob.encoding || "base64" };
}

export function stageAdd(path, content, encoding = "base64") {
  state.staged.del.delete(path);
  state.staged.add.set(path, { content, encoding });
}

export function stageDelete(path) {
  state.staged.add.delete(path);
  if (state.tree.find((f) => f.path === path)) state.staged.del.add(path);
}

// Rename = stage a delete of the old path + an add of the new path,
// reusing the existing blob sha when the content hasn't changed (avoids
// re-uploading identical bytes as a new blob).
export function stageRename(oldPath, newPath) {
  const existing = state.tree.find((f) => f.path === oldPath);
  const stagedExisting = state.staged.add.get(oldPath);
  state.staged.add.delete(oldPath);
  if (existing) state.staged.del.add(oldPath);
  if (stagedExisting) {
    state.staged.add.set(newPath, stagedExisting);
  } else if (existing) {
    state.staged.add.set(newPath, { sha: existing.sha });
  }
}

export async function stageDuplicate(path) {
  const { content, encoding } = await getFileContentForStaging(path);
  const dot = path.lastIndexOf(".");
  const slash = path.lastIndexOf("/");
  const dir = slash >= 0 ? path.slice(0, slash + 1) : "";
  const base = slash >= 0 ? path.slice(slash + 1) : path;
  const baseDot = base.lastIndexOf(".");
  let newBase = baseDot > 0 ? `${base.slice(0, baseDot)} copy${base.slice(baseDot)}` : `${base} copy`;
  let newPath = dir + newBase;
  let n = 2;
  while (state.tree.find((f) => f.path === newPath) || state.staged.add.has(newPath)) {
    newBase = baseDot > 0 ? `${base.slice(0, baseDot)} copy ${n}${base.slice(baseDot)}` : `${base} copy ${n}`;
    newPath = dir + newBase;
    n++;
  }
  stageAdd(newPath, content, encoding);
  return newPath;
}

// Unstages a single row from the drawer. `path` is always the "add" side
// (for a move, that's the new path); `fromPath`, if present, is the "del"
// side of a move pair that also needs to be unstaged together.
export function unstageRow(path, fromPath) {
  state.staged.add.delete(path);
  if (fromPath) state.staged.del.delete(fromPath);
  else state.staged.del.delete(path);
}

export function stagedCount() { return state.staged.add.size + state.staged.del.size; }

export function clearStaged() {
  state.staged.add.clear();
  state.staged.del.clear();
}

// Returns [{type: 'add'|'del'|'move', path, fromPath?}], collapsing a
// del+add pair on paths that share a blob sha into a single "move" row for
// the staged-changes drawer UI.
export function computeDiffRows() {
  const rows = [];
  const delBySha = new Map();
  for (const delPath of state.staged.del) {
    const meta = state.tree.find((f) => f.path === delPath);
    if (meta) delBySha.set(meta.sha, delPath);
  }
  const consumedDels = new Set();
  for (const [path, entry] of state.staged.add) {
    if (entry.sha && delBySha.has(entry.sha) && !consumedDels.has(delBySha.get(entry.sha))) {
      const fromPath = delBySha.get(entry.sha);
      rows.push({ type: "move", path, fromPath });
      consumedDels.add(fromPath);
    } else {
      rows.push({ type: "add", path });
    }
  }
  for (const delPath of state.staged.del) {
    if (!consumedDels.has(delPath)) rows.push({ type: "del", path: delPath });
  }
  return rows;
}

export async function commitStaged(message) {
  const additions = [...state.staged.add].map(([path, entry]) => ({
    path,
    content: entry.content,
    encoding: entry.encoding,
    sha: entry.sha,
  }));
  const deletions = [...state.staged.del];
  const result = await api("/api/commit", {
    method: "POST",
    body: JSON.stringify({ message, additions, deletions }),
  });
  clearStaged();
  return result;
}
