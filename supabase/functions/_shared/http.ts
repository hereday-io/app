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
// stolen tokens.
const ALLOWED_ORIGINS = [
  "https://hereday.io",
  "https://www.hereday.io",
  "http://localhost:8080",
  "http://localhost:5173",
];

// Vercel previews for this project only (project "app", team
// "kpinkleys-projects"): per-deployment URLs
// (app-<hash>-kpinkleys-projects.vercel.app) and branch aliases
// (app-git-<branch>-kpinkleys-projects.vercel.app). Any other
// *.vercel.app site is someone else's.
const PREVIEW_ORIGIN = /^https:\/\/app-(?:[a-z0-9]{9}|git-[a-z0-9-]+)-kpinkleys-projects\.vercel\.app$/;

function pickAllowedOrigin(origin: string | null): string {
  if (!origin) return ALLOWED_ORIGINS[0];
  if (ALLOWED_ORIGINS.includes(origin)) return origin;
  if (PREVIEW_ORIGIN.test(origin)) return origin;
  return ALLOWED_ORIGINS[0];
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  return {
    "Access-Control-Allow-Origin": pickAllowedOrigin(origin),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}

/**
 * JSON response with the caller's origin echoed back if it's allowed.
 * `req` is required: without it the header falls back to hereday.io and
 * the browser blocks the response on localhost and Vercel previews.
 */
export function json(body: unknown, status: number, req: Request): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

// Wildcard CORS for endpoints any origin may call on purpose: anon
// token-gated volunteer pages, the public Mapbox token, crawlers, and
// Stripe. None of them read cookies, so `*` grants nothing a direct
// request couldn't already do.
export const publicCors: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export function publicJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...publicCors, "Content-Type": "application/json" },
  });
}

/**
 * Wrap a Deno.serve handler so an unexpected throw (a Stripe or network
 * error, say) is logged under the function's name and still reaches the
 * browser as a CORS-readable 500 instead of the runtime's bare error.
 */
export function handler(
  name: string,
  fn: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req) => {
    try {
      return await fn(req);
    } catch (err) {
      const url = new URL(req.url);
      console.error(`[${name}] unhandled error`, { method: req.method, path: url.pathname }, err);
      return json({ error: "Internal error" }, 500, req);
    }
  };
}
