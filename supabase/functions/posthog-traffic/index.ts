// POST /posthog-traffic — site traffic from PostHog for /admin.
//
// Admin-only. Returns visitors / pageviews / sessions for the window and
// the window before it, a daily series, and the top pages and referrers.
// Supabase `product_events` only sees signed-in actions and a couple of
// page types; this is the anonymous top of the funnel.
//
// Body: { days?: number }
//
// Secrets:
//   POSTHOG_PERSONAL_API_KEY  phx_… personal key with the Query Read scope.
//                             NOT the phc_ project key, which can only
//                             send events.
//   POSTHOG_PROJECT_ID        numeric, from PostHog → Project settings.
//   POSTHOG_APP_HOST          optional, default https://us.posthog.com.
//                             The app host, not the us.i.posthog.com
//                             ingestion host the browser sends to.

import { corsHeaders, json } from "../_shared/http.ts";
import { requireAdmin } from "../_shared/adminAuth.ts";
import {
  clampDays,
  errorHint,
  shapeTraffic,
  trafficQueries,
  type TrafficQueryName,
} from "./traffic.ts";

const DEFAULT_APP_HOST = "https://us.posthog.com";

class PostHogQueryError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function hogql(
  host: string,
  projectId: string,
  key: string,
  name: string,
  query: string,
): Promise<unknown[][]> {
  const res = await fetch(`${host}/api/projects/${encodeURIComponent(projectId)}/query/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    // `name` lands in PostHog's query_log, so these are findable there.
    body: JSON.stringify({ query: { kind: "HogQLQuery", query }, name: `admin-traffic-${name}` }),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const message = payload?.detail ?? payload?.error ?? `PostHog query API returned ${res.status}`;
    throw new PostHogQueryError(String(message), res.status);
  }
  return (payload?.results ?? []) as unknown[][];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(req) });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, req);
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  let body: { days?: number } = {};
  try {
    body = await req.json();
  } catch {
    // Empty body is fine — defaults below.
  }

  const key = Deno.env.get("POSTHOG_PERSONAL_API_KEY");
  const projectId = Deno.env.get("POSTHOG_PROJECT_ID");
  const host = (Deno.env.get("POSTHOG_APP_HOST") ?? DEFAULT_APP_HOST).replace(/\/+$/, "");

  // Not configured is an expected state, not a crash: the UI renders a
  // setup card when it sees `configured: false`.
  if (!key || !projectId) {
    return json(
      {
        configured: false,
        error: "PostHog query access not configured: set POSTHOG_PERSONAL_API_KEY and POSTHOG_PROJECT_ID.",
      },
      200,
      req,
    );
  }

  const days = clampDays(body.days);
  const queries = trafficQueries(days);
  const names = Object.keys(queries) as TrafficQueryName[];

  try {
    const rows = await Promise.all(
      names.map((name) => hogql(host, projectId, key, name, queries[name])),
    );
    const results = Object.fromEntries(names.map((name, i) => [name, rows[i]])) as Record<
      TrafficQueryName,
      unknown[][]
    >;

    return json(
      {
        configured: true,
        days,
        app_url: `${host}/project/${projectId}/web`,
        ...shapeTraffic(results),
      },
      200,
      req,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = err instanceof PostHogQueryError ? err.status : 0;
    console.error("[posthog-traffic] query failed:", status, message);
    return json({ configured: true, error: message, hint: errorHint(status) }, 502, req);
  }
});
