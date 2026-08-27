const API = "https://api.github.com";

async function ghFetch(env, path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "repo-manager-worker",
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

function repoPath(owner, repo) {
  return `/repos/${owner}/${repo}`;
}

async function getBranchRef(env, owner, repo, branch) {
  return ghFetch(env, `${repoPath(owner, repo)}/git/ref/heads/${encodeURIComponent(branch)}`);
}

// Fetches a single blob's content by its sha (used for opening files in the editor/preview).
export async function getBlob(env, owner, repo, sha) {
  return ghFetch(env, `${repoPath(owner, repo)}/git/blobs/${sha}`);
}

export async function getRepoInfo(env, owner, repo) {
  return ghFetch(env, repoPath(owner, repo));
}

// Confirms the token works and identifies the account it belongs to.
export async function getViewer(env) {
  return ghFetch(env, "/user");
}

// Lists repos visible to the token, most-recently-pushed first. Paginates
// up to `maxPages` pages of 100 (plenty for personal/small-org accounts).
export async function listRepos(env, { maxPages = 3 } = {}) {
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const batch = await ghFetch(
      env,
      `/user/repos?per_page=100&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`
    );
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all.map(toRepoSummary);
}

// Search-as-you-type over repos the token can see.
export async function searchRepos(env, query) {
  const viewer = await getViewer(env);
  const q = `${query} in:name user:${viewer.login} fork:true`;
  const result = await ghFetch(env, `/search/repositories?q=${encodeURIComponent(q)}&per_page=30`);
  return (result.items || []).map(toRepoSummary);
}

function toRepoSummary(r) {
  return {
    owner: r.owner.login,
    repo: r.name,
    fullName: r.full_name,
    defaultBranch: r.default_branch,
    private: r.private,
    pushedAt: r.pushed_at,
    description: r.description,
  };
}

// Returns every branch name for a repo (for the branch picker).
export async function listBranches(env, owner, repo) {
  const branches = await ghFetch(env, `${repoPath(owner, repo)}/branches?per_page=100`);
  return branches.map((b) => b.name);
}

// Returns a flat list of every file (blob) currently in the repo tree.
export async function getTree(env, owner, repo, branch) {
  const ref = await getBranchRef(env, owner, repo, branch);
  const commitSha = ref.object.sha;
  const commit = await ghFetch(env, `${repoPath(owner, repo)}/git/commits/${commitSha}`);
  const tree = await ghFetch(env, `${repoPath(owner, repo)}/git/trees/${commit.tree.sha}?recursive=1`);
  if (tree.truncated) {
    // Extremely large repos: GitHub truncates recursive listings. Not expected for typical use.
    console.warn("Tree listing was truncated by GitHub API (repo very large).");
  }
  return {
    branch,
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
export async function commitChanges(env, owner, repo, branch, { message, additions = [], deletions = [] }) {
  if (additions.length === 0 && deletions.length === 0) {
    throw new Error("Nothing to commit.");
  }

  const ref = await getBranchRef(env, owner, repo, branch);
  const latestCommitSha = ref.object.sha;
  const latestCommit = await ghFetch(env, `${repoPath(owner, repo)}/git/commits/${latestCommitSha}`);
  const baseTreeSha = latestCommit.tree.sha;

  // Create blobs only for additions that don't already carry a sha (renames reuse the existing blob sha).
  const additionEntries = await mapWithConcurrency(additions, 5, async (file) => {
    let sha = file.sha;
    if (!sha) {
      const blob = await ghFetch(env, `${repoPath(owner, repo)}/git/blobs`, {
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

  const newTree = await ghFetch(env, `${repoPath(owner, repo)}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: baseTreeSha, tree: [...additionEntries, ...deletionEntries] }),
  });

  const newCommit = await ghFetch(env, `${repoPath(owner, repo)}/git/commits`, {
    method: "POST",
    body: JSON.stringify({ message, tree: newTree.sha, parents: [latestCommitSha] }),
  });

  await ghFetch(env, `${repoPath(owner, repo)}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: newCommit.sha }),
  });

  return {
    commitSha: newCommit.sha,
    url: `https://github.com/${owner}/${repo}/commit/${newCommit.sha}`,
  };
}
