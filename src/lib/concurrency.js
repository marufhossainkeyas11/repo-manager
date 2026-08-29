// Runs a small worker-pool over `items`, respecting a max concurrency.
// Used on the server because Cloudflare Workers cap simultaneous outgoing
// connections per request at 6 (see commit.js's blob-creation loop). The
// exact same pattern is duplicated client-side in
// public/scripts/utils/concurrency.js for the same reason (browsers also
// throttle concurrent requests, and we want live "3/12…" progress UI) —
// it's not imported across the client/server boundary since the frontend
// is plain static assets with no bundler, but the logic is intentionally
// identical and documented in both places.
export async function mapWithConcurrency(items, limit, fn) {
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
