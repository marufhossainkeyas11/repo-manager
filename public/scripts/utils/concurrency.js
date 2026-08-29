// Small concurrency-limited fetch pool, mirroring the server's
// mapWithConcurrency pattern (src/lib/concurrency.js) — keeps zip/download
// operations responsive with live progress instead of firing everything at
// once. Not imported across the client/server boundary (no bundler here),
// but intentionally identical logic — documented in both places.
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
