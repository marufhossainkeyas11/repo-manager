import { $, escapeHtml } from "../utils/dom.js";
import { state } from "../state.js";
import { api } from "../api.js";
import { toast } from "../utils/toast.js";
import { openPrompt } from "../utils/prompt.js";
import { iconTrash } from "../utils/icons.js";
import { clearStaged, stagedCount } from "../staging/stage.js";
import { clearSelection } from "../file-list/selection.js";

let browseResults = [];
let browseDebounceTimer = null;

let onRepoSwitched = () => {};
export function setRepoSwitchedHandler(fn) { onRepoSwitched = fn; }

export function openSettingsModal() {
  $("settingsBackdrop").classList.add("open");
  $("settingsBackdrop").classList.add("wide-backdrop");
  loadRepoManager();
}

export function initRepoManager() {
  $("settingsBtn").addEventListener("click", openSettingsModal);
  $("settingsClose").addEventListener("click", () => $("settingsBackdrop").classList.remove("open"));
  $("settingsBackdrop").addEventListener("click", (e) => { if (e.target === $("settingsBackdrop")) $("settingsBackdrop").classList.remove("open"); });

  $("rmAddToggle").addEventListener("click", () => {
    const panel = $("rmAddPanel");
    panel.classList.toggle("open");
    if (panel.classList.contains("open")) $("rmBrowseSearch").focus();
  });
  $("rmTabBrowseBtn").addEventListener("click", () => setRmTab("browse"));
  $("rmTabManualBtn").addEventListener("click", () => setRmTab("manual"));
  $("rmBrowseSearch").addEventListener("input", (e) => {
    clearTimeout(browseDebounceTimer);
    const q = e.target.value.trim();
    browseDebounceTimer = setTimeout(() => runBrowseSearch(q), 300);
  });
  $("rmManualVerifyBtn").addEventListener("click", () => {
    const owner = $("rmManualOwner").value.trim();
    const repo = $("rmManualRepo").value.trim();
    const branch = $("rmManualBranch").value.trim();
    if (!owner || !repo) return toast("Owner and repo are both required.", "err");
    addRepo(owner, repo, branch || undefined);
  });
  $("rmShowOnLoginToggle").addEventListener("click", async () => {
    const next = !$("rmShowOnLoginToggle").classList.contains("on");
    $("rmShowOnLoginToggle").classList.toggle("on", next); // optimistic
    $("rmShowOnLoginToggle").setAttribute("aria-checked", String(next));
    try {
      state.repoRegistry = await api("/api/settings", { method: "PUT", body: JSON.stringify({ showRepoOnLogin: next }) });
    } catch (err) {
      renderShowOnLoginToggle();
      toast("Couldn't save setting: " + err.message, "err");
    }
  });
}

async function loadRepoManager() {
  try {
    state.repoRegistry = await api("/api/repos");
    renderRepoList();
    renderShowOnLoginToggle();
  } catch (err) {
    $("rmRepoList").innerHTML = `<div class="rm-repo-row rm-empty">Couldn't load repositories: ${escapeHtml(err.message)}</div>`;
  }
}

function renderRepoList() {
  const list = $("rmRepoList");
  const registry = state.repoRegistry;
  if (!registry || registry.list.length === 0) {
    list.innerHTML = '<div class="rm-repo-row rm-empty">No repositories saved yet — add one below.</div>';
    return;
  }
  const activeId = registry.active ? `${registry.active.owner}/${registry.active.repo}` : null;
  list.innerHTML = "";
  for (const r of registry.list) {
    const isActive = r.id === activeId;
    const row = document.createElement("div");
    row.className = "rm-repo-row";
    row.innerHTML = `
      <div class="rm-repo-info">
        <div class="rm-repo-name">${escapeHtml(r.owner)}/${escapeHtml(r.repo)}</div>
        <div class="rm-repo-branch">⎇ ${escapeHtml(r.branch)}${r.private ? " · Private" : ""}</div>
      </div>
      ${isActive
        ? '<span class="rm-active-pill">● Active</span>'
        : `<button class="btn secondary sm rm-switch-btn">Switch</button>`}
      <button class="rm-remove" title="Remove" ${isActive ? "disabled" : ""}>${iconTrash()}</button>
    `;
    if (!isActive) {
      row.querySelector(".rm-switch-btn").addEventListener("click", () => switchActiveRepo(r.owner, r.repo));
    }
    row.querySelector(".rm-remove").addEventListener("click", () => removeRepo(r.owner, r.repo, isActive));
    list.appendChild(row);
  }
}

async function switchActiveRepo(owner, repo) {
  const pendingCount = stagedCount();
  if (pendingCount > 0) {
    const ok = await new Promise((resolve) => {
      openPrompt({
        title: "Discard uncommitted changes?",
        hint: `${pendingCount} uncommitted change(s) will be discarded (nothing has happened on GitHub — none of this was committed). Continue?`,
        confirmLabel: "Switch repo",
        hideInput: true,
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
    if (!ok) return;
  }
  try {
    state.repoRegistry = await api("/api/repos/active", { method: "PUT", body: JSON.stringify({ owner, repo }) });
    clearStaged();
    clearSelection();
    renderRepoList();
    await onRepoSwitched();
    toast(`Switched to <b>${escapeHtml(owner)}/${escapeHtml(repo)}</b>`, "ok");
  } catch (err) {
    toast("Couldn't switch repo: " + err.message, "err");
  }
}

async function removeRepo(owner, repo, isActive) {
  if (isActive) return;
  try {
    state.repoRegistry = await api(`/api/repos?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`, { method: "DELETE" });
    renderRepoList();
    toast(`Removed <b>${escapeHtml(owner)}/${escapeHtml(repo)}</b> from your list`, "ok");
  } catch (err) {
    toast("Couldn't remove repo: " + err.message, "err");
  }
}

function setRmTab(tab) {
  $("rmTabBrowseBtn").classList.toggle("active", tab === "browse");
  $("rmTabManualBtn").classList.toggle("active", tab === "manual");
  $("rmTabBrowse").classList.toggle("active", tab === "browse");
  $("rmTabManual").classList.toggle("active", tab === "manual");
  if (tab === "browse" && browseResults.length === 0) runBrowseSearch("");
}

async function runBrowseSearch(q) {
  $("rmBrowseResults").innerHTML = '<div class="rm-repo-row rm-empty">Searching…</div>';
  try {
    browseResults = await api(`/api/repos/discover?q=${encodeURIComponent(q)}`);
    renderBrowseResults();
  } catch (err) {
    $("rmBrowseResults").innerHTML = `<div class="rm-repo-row rm-empty">${escapeHtml(err.message)}</div>`;
  }
}

function renderBrowseResults() {
  const container = $("rmBrowseResults");
  if (browseResults.length === 0) {
    container.innerHTML = '<div class="rm-repo-row rm-empty">No matching repositories.</div>';
    return;
  }
  const savedIds = new Set((state.repoRegistry?.list || []).map((r) => r.id));
  container.innerHTML = "";
  for (const r of browseResults) {
    const id = `${r.owner}/${r.repo}`;
    const alreadySaved = savedIds.has(id);
    const row = document.createElement("div");
    row.className = "rm-browse-row";
    row.innerHTML = `
      <div class="rm-repo-info">
        <div class="rm-repo-name">${escapeHtml(r.owner)}/${escapeHtml(r.repo)}${r.private ? " 🔒" : ""}</div>
        <div class="rm-repo-desc">${escapeHtml(r.description || r.defaultBranch || "")}</div>
      </div>
      <button class="btn ${alreadySaved ? "secondary" : "accent"} sm" ${alreadySaved ? "disabled" : ""}>${alreadySaved ? "Added" : "+ Add"}</button>
    `;
    if (!alreadySaved) {
      row.querySelector("button").addEventListener("click", () => addRepo(r.owner, r.repo, r.defaultBranch));
    }
    container.appendChild(row);
  }
}

async function addRepo(owner, repo, branch) {
  try {
    state.repoRegistry = await api("/api/repos", { method: "POST", body: JSON.stringify({ owner, repo, branch }) });
    renderRepoList();
    renderBrowseResults();
    toast(`Added <b>${escapeHtml(owner)}/${escapeHtml(repo)}</b>`, "ok");
    $("rmManualOwner").value = "";
    $("rmManualRepo").value = "";
    $("rmManualBranch").value = "";
  } catch (err) {
    toast("Couldn't add repo: " + err.message, "err");
  }
}

function renderShowOnLoginToggle() {
  const on = state.repoRegistry ? state.repoRegistry.showRepoOnLogin !== false : true;
  $("rmShowOnLoginToggle").classList.toggle("on", on);
  $("rmShowOnLoginToggle").setAttribute("aria-checked", String(on));
}
