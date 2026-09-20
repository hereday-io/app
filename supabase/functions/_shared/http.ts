// CORS + JSON response helpers, shared by every edge function.
//
// Lifted out of billing.ts so functions that have nothing to do with
// Stripe (search-console, and whatever admin tooling comes next) can
// reuse the origin allowlist without importing the Stripe SDK — that
// import is ~1MB of cold start for a function that never calls it.
// billing.ts re-exports these, so existing importers didn't move.

// Allowlist of origins that may invoke our endpoints. Anything else
// gets the canonical production origin in the ACAO header — browsers will
// reject the response, blocking third-party sites from issuing XHR with
// stolen tokens. Vercel preview deployments are matched by suffix.
const ALLOWED_ORIGINS = [
  "https://hereday.io",
  "https://www.hereday.io",
  "http://localhost:8080",
  "http://localhost:5173",
];

function pickAllowedOrigin(origin: string | null): string {
  if (!origin) return ALLOWED_ORIGINS[0];
  if (ALLOWED_ORIGINS.includes(origin)) return origin;
  if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)) return origin;
  return ALLOWED_ORIGINS[0];
}

export function corsHeaders(req?: Request): Record<string, string> {
  const origin = req?.headers.get("origin") ?? null;
  return {
    "Access-Control-Allow-Origin": pickAllowedOrigin(origin),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}

export function json(body: unknown, status = 200, req?: Request): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}
