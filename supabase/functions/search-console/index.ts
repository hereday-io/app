// POST /search-console — Google Search Console metrics for /admin.
//
// Admin-only. Returns clicks / impressions / CTR / average position for
// the window, the same for the preceding window (so the UI can show a
// delta), a daily series, and the top queries and pages.
//
// Body: { days?: 7 | 28 | 90, mode?: "metrics" | "sites" }
//   mode "sites" lists the properties the service account can actually
//   read — the fastest way to diagnose "I get zeros", which is almost
//   always the service account not being added to the property, or
//   GSC_SITE_URL naming a property that doesn't exist.
//
// Property: GSC_SITE_URL, default the apex URL-prefix property. The www
// property on this account reports zero for everything (apex is
// canonical, www only redirects), so pointing this at www yields a
// dashboard of zeros that looks like a bug.

import { corsHeaders, json } from "../_shared/http.ts";
import { requireAdmin } from "../_shared/adminAuth.ts";
import { getGoogleAccessToken, getServiceAccount } from "../_shared/googleAuth.ts";

const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
// The live property is a DOMAIN property, whose API identifier is
// `sc-domain:hereday.io` — not the URL-prefix form `https://hereday.io/`.
// Asking for the wrong one returns "User does not have sufficient
// permission for site", which reads like a permissions problem and
// isn't. GSC_SITE_URL overrides this; POST {"mode":"sites"} prints the
// exact strings the service account can read.
const DEFAULT_SITE_URL = "sc-domain:hereday.io";

// Search Console finalises data on a ~2 day lag. Ending the window at
// today would show two empty days and read as a traffic collapse.
const DATA_LAG_DAYS = 2;

interface GscRow {
  keys?: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface Totals {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

/**
 * Roll rows up into one total. CTR and position cannot be averaged
 * naively: CTR is clicks/impressions over the whole set, and position is
 * weighted by impressions — an unweighted mean lets a one-impression day
 * at position 90 swamp a thousand impressions at position 4.
 */
function rollup(rows: GscRow[]): Totals {
  let clicks = 0;
  let impressions = 0;
  let positionWeighted = 0;
  for (const r of rows) {
    clicks += r.clicks;
    impressions += r.impressions;
    positionWeighted += r.position * r.impressions;
  }
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: impressions > 0 ? positionWeighted / impressions : 0,
  };
}

async function gscQuery(
  token: string,
  siteUrl: string,
  body: Record<string, unknown>,
): Promise<GscRow[]> {
  const res = await fetch(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  const payload = await res.json();
  if (!res.ok) {
    const message = payload?.error?.message ?? `Search Console API returned ${res.status}`;
    throw new Error(message);
  }
  return (payload.rows ?? []) as GscRow[];
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

  let body: { days?: number; mode?: string } = {};
  try {
    body = await req.json();
  } catch {
    // Empty body is fine — defaults below.
  }

  const siteUrl = Deno.env.get("GSC_SITE_URL") ?? DEFAULT_SITE_URL;
  const days = Math.max(1, Math.min(Number(body.days) || 28, 480));

  let token: string;
  let serviceAccountEmail: string;
  try {
    serviceAccountEmail = getServiceAccount().client_email;
    token = await getGoogleAccessToken(SCOPE);
  } catch (err) {
    // Not configured is an expected state, not a crash: the UI renders a
    // setup card instead of an error when it sees `configured: false`.
    const message = err instanceof Error ? err.message : String(err);
    const missing = message.includes("not configured");
    console.warn("[search-console] credentials unavailable:", message);
    return json({ configured: false, error: message }, missing ? 200 : 500, req);
  }

  // Diagnostic mode — which properties can this service account read?
  if (body.mode === "sites") {
    const res = await fetch("https://searchconsole.googleapis.com/webmasters/v3/sites", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = await res.json();
    return json(
      {
        configured: true,
        service_account: serviceAccountEmail,
        configured_site_url: siteUrl,
        sites: payload?.siteEntry ?? [],
      },
      res.ok ? 200 : 502,
      req,
    );
  }

  const end = daysAgo(DATA_LAG_DAYS);
  const start = daysAgo(DATA_LAG_DAYS + days - 1);
  const prevEnd = daysAgo(DATA_LAG_DAYS + days);
  const prevStart = daysAgo(DATA_LAG_DAYS + days * 2 - 1);

  try {
    const [byDayRows, prevRows, queryRows, pageRows] = await Promise.all([
      gscQuery(token, siteUrl, {
        startDate: isoDate(start),
        endDate: isoDate(end),
        dimensions: ["date"],
        rowLimit: 500,
      }),
      gscQuery(token, siteUrl, {
        startDate: isoDate(prevStart),
        endDate: isoDate(prevEnd),
        rowLimit: 1,
      }),
      gscQuery(token, siteUrl, {
        startDate: isoDate(start),
        endDate: isoDate(end),
        dimensions: ["query"],
        rowLimit: 20,
      }),
      gscQuery(token, siteUrl, {
        startDate: isoDate(start),
        endDate: isoDate(end),
        dimensions: ["page"],
        rowLimit: 20,
      }),
    ]);

    return json(
      {
        configured: true,
        site_url: siteUrl,
        range: { start: isoDate(start), end: isoDate(end), days, lag_days: DATA_LAG_DAYS },
        totals: rollup(byDayRows),
        prev_totals: rollup(prevRows),
        by_day: byDayRows.map((r) => ({
          day: r.keys?.[0] ?? "",
          clicks: r.clicks,
          impressions: r.impressions,
          ctr: r.ctr,
          position: r.position,
        })),
        top_queries: queryRows.map((r) => ({
          query: r.keys?.[0] ?? "",
          clicks: r.clicks,
          impressions: r.impressions,
          ctr: r.ctr,
          position: r.position,
        })),
        top_pages: pageRows.map((r) => ({
          page: r.keys?.[0] ?? "",
          clicks: r.clicks,
          impressions: r.impressions,
          ctr: r.ctr,
          position: r.position,
        })),
      },
      200,
      req,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[search-console] query failed:", message);
    // 403 from Google here means the service account isn't on the
    // property — the single most common setup mistake, so say so.
    return json(
      {
        configured: true,
        error: message,
        hint: `If this mentions permission, add ${serviceAccountEmail} as a user on the ${siteUrl} property in Search Console, or POST {"mode":"sites"} to see what it can read.`,
      },
      502,
      req,
    );
  }
});
