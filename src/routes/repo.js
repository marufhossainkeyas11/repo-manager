import { json } from "../lib/json.js";
import { getRepoInfo } from "../lib/github.js";
import { getActiveRepo } from "../lib/config.js";

export async function handleRepo(request, env) {
  const repoCfg = await getActiveRepo(env);
  const info = await getRepoInfo(env, repoCfg);
  return json({
    owner: repoCfg.owner,
    repo: repoCfg.repo,
    branch: repoCfg.branch,
    defaultBranch: info.default_branch,
    private: info.private,
    htmlUrl: info.html_url,
  });
}
