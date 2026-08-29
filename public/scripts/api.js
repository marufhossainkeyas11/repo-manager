import { state, REMEMBER_KEY } from "./state.js";

// Set by main.js at boot to avoid a circular import with auth/login.js
// (api() needs to trigger showLogin() on 401; login.js needs api()).
let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

export async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: {
      "Authorization": "Bearer " + state.PW,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  if (res.status === 401) {
    sessionStorage.removeItem("rm_pw");
    localStorage.removeItem(REMEMBER_KEY);
    onUnauthorized();
    throw new Error("Unauthorized");
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}
