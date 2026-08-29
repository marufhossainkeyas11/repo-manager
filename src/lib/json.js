// Small helper so every route returns a consistently-shaped JSON Response
// with the security headers baked in (see index.js for why these headers
// matter — clickjacking / MIME-sniffing protection on a tool that holds a
// GitHub token's worth of write access).
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "frame-ancestors 'none'",
};

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...SECURITY_HEADERS, ...extraHeaders },
  });
}

export { SECURITY_HEADERS };
