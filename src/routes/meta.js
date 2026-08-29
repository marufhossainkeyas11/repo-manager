import { json } from "../lib/json.js";
import { getRepoRegistry } from "../lib/config.js";

// /api/meta is intentionally NOT auth-gated: the login screen needs to show
// which repo it's connecting to before the user has typed a password. It
// only ever exposes owner/repo/branch (or {hidden:true} if the admin has
// turned that off in Settings) — nothing sensitive.
export async function handleMeta(request, env) {
  try {
    const registry = await getRepoRegistry(env);
    if (!registry.showRepoOnLogin || !registry.active) {
      return json({ hidden: true });
    }
    return json({
      owner: registry.active.owner,
      repo: registry.active.repo,
      branch: registry.active.branch || "main",
    });
  } catch {
    return json({ hidden: true });
  }
}
