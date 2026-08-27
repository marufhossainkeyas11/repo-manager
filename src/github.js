const API = "https://api.github.com";

async function ghFetch(env, path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "github-file-manager-worker",
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub API ${options.method || "GET"} ${path} -> ${res.status}: ${body}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// repoCfg: { owner, repo, branch }
function repoPath(repoCfg) {
  return `/repos/${repoCfg.owner}/${repoCfg.repo}`;
}

async function getBranchRef(env, repoCfg) {
  const branch = repoCfg.branch || "main";
  return ghFetch(env, `${repoPath(repoCfg)}/git/ref/heads/${encodeURIComponent(branch)}`);
}

// Fetches a single blob's content by its sha (used for opening files in the editor/preview).
export async function getBlob(env, repoCfg, sha) {
  return ghFetch(env, `${repoPath(repoCfg)}/git/blobs/${sha}`);
}

export async function getRepoInfo(env, repoCfg) {
  return ghFetch(env, repoPath(repoCfg));
}

// Returns a flat list of every file (blob) currently in the repo tree.
export async function getTree(env, repoCfg) {
  const ref = await getBranchRef(env, repoCfg);
  const commitSha = ref.object.sha;
  const commit = await ghFetch(env, `${repoPath(repoCfg)}/git/commits/${commitSha}`);
  const tree = await ghFetch(env, `${repoPath(repoCfg)}/git/trees/${commit.tree.sha}?recursive=1`);
  if (tree.truncated) {
    // Extremely large repos: GitHub truncates recursive listings. Not expected for typical use.
    console.warn("Tree listing was truncated by GitHub API (repo very large).");
  }
  return {
    branch: repoCfg.branch || "main",
    commitSha,
    files: tree.tree
      .filter((item) => item.type === "blob")
      .map((item) => ({ path: item.path, sha: item.sha, size: item.size })),
  };
}

// Runs a small worker-pool over `items`, respecting a max concurrency,
// since Workers cap simultaneous outgoing connections per request at 6.
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// additions: [{ path, content?, encoding?, sha? }]  (content -> new blob; sha -> reuse existing blob, e.g. renames)
// deletions: [path, ...]
export async function commitChanges(env, repoCfg, { message, additions = [], deletions = [] }) {
  if (additions.length === 0 && deletions.length === 0) {
    throw new Error("Nothing to commit.");
  }

  const ref = await getBranchRef(env, repoCfg);
  const latestCommitSha = ref.object.sha;
  const latestCommit = await ghFetch(env, `${repoPath(repoCfg)}/git/commits/${latestCommitSha}`);
  const baseTreeSha = latestCommit.tree.sha;

  // Create blobs only for additions that don't already carry a sha (renames reuse the existing blob sha).
  const additionEntries = await mapWithConcurrency(additions, 5, async (file) => {
    let sha = file.sha;
    if (!sha) {
      const blob = await ghFetch(env, `${repoPath(repoCfg)}/git/blobs`, {
        method: "POST",
        body: JSON.stringify({ content: file.content, encoding: file.encoding || "base64" }),
      });
      sha = blob.sha;
    }
    return { path: file.path, mode: file.mode || "100644", type: "blob", sha };
  });

  const deletionEntries = deletions.map((path) => ({
    path,
    mode: "100644",
    type: "blob",
    sha: null,
  }));

  const newTree = await ghFetch(env, `${repoPath(repoCfg)}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: baseTreeSha, tree: [...additionEntries, ...deletionEntries] }),
  });

  const newCommit = await ghFetch(env, `${repoPath(repoCfg)}/git/commits`, {
    method: "POST",
    body: JSON.stringify({ message, tree: newTree.sha, parents: [latestCommitSha] }),
  });

  const branch = repoCfg.branch || "main";
  await ghFetch(env, `${repoPath(repoCfg)}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: newCommit.sha }),
  });

  return {
    commitSha: newCommit.sha,
    url: `https://github.com/${repoCfg.owner}/${repoCfg.repo}/commit/${newCommit.sha}`,
  };
}

// Lists repos the token's owner/collaborator account can see (for the
// "Browse" add-repo tab). Works for classic PATs (repo scope) and
// fine-grained PATs set to "All repositories" or explicit repo access.
export async function discoverRepos(env, query) {
  const perPage = 100;
  const results = await ghFetch(
    env,
    `/user/repos?per_page=${perPage}&sort=updated&affiliation=owner,collaborator,organization_member`
  );
  const mapped = results.map((r) => ({
    owner: r.owner.login,
    repo: r.name,
    private: r.private,
    defaultBranch: r.default_branch,
    description: r.description || "",
    updatedAt: r.updated_at,
  }));
  if (!query) return mapped;
  const q = query.toLowerCase();
  return mapped.filter(
    (r) =>
      r.repo.toLowerCase().includes(q) ||
      r.owner.toLowerCase().includes(q) ||
      (r.description && r.description.toLowerCase().includes(q))
  );
}
