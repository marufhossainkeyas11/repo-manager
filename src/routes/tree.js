import { json } from "../lib/json.js";
import { getTree } from "../lib/github.js";
import { getActiveRepo } from "../lib/config.js";

export async function handleTree(request, env) {
  const repoCfg = await getActiveRepo(env);
  const tree = await getTree(env, repoCfg);
  return json(tree);
}
