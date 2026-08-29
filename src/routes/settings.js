import { json } from "../lib/json.js";
import { getRepoRegistry, saveRepoRegistry } from "../lib/config.js";

export async function handleSettingsPut(request, env) {
  const body = await request.json();
  const registry = await getRepoRegistry(env);
  if (typeof body.showRepoOnLogin === "boolean") {
    registry.showRepoOnLogin = body.showRepoOnLogin;
  }
  const saved = await saveRepoRegistry(env, registry);
  return json(saved);
}
