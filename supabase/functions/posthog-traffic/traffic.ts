// HogQL for the /admin "Site traffic" panel, and the shaping of PostHog's
// positional result rows into the JSON the panel reads.
//
// Kept free of Deno globals so vitest can cover it (traffic.test.ts);
// index.ts does the auth, env and fetch.

// Production only. Local dev and Vercel previews can carry the same
// VITE_POSTHOG_KEY, and their pageviews aren't visitors.
export const SITE_HOSTS = ["hereday.io", "www.hereday.io"];

// Operator traffic. /admin is only ever Kevin and the reps, and on a
// low-traffic site it would be a visible share of the totals.
export const EXCLUDED_PATH_PREFIX = "/admin";

export const DEFAULT_DAYS = 30;

export function clampDays(value: unknown): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_DAYS;
  return Math.min(n, 365);
}

const BASE_FILTER = [
  `event = '$pageview'`,
  `properties.$host IN (${SITE_HOSTS.map((h) => `'${h}'`).join(", ")})`,
  `NOT startsWith(coalesce(properties.$pathname, ''), '${EXCLUDED_PATH_PREFIX}')`,
].join(" AND ");

export type TrafficQueryName = "totals" | "by_day" | "top_pages" | "top_referrers";

/**
 * The window is rolling (now minus N days), the same as
 * get_admin_overview, so the visitor → signup rate divides like by like.
 * Day buckets are forced to UTC to match the rest of the dashboard;
 * PostHog would otherwise bucket in the project's timezone.
 */
export function trafficQueries(days: number): Record<TrafficQueryName, string> {
  const since = `timestamp >= now() - INTERVAL ${days} DAY`;
  return {
    // One pass over both windows: `current` splits this window from the
    // one before it, for the deltas. `first_seen` says where the data
    // actually starts: PostHog only went live in production on
    // 2026-10-14, and a window reaching back before that would divide a
    // full window of signups by a few hours of visitors.
    totals: `
      SELECT timestamp >= now() - INTERVAL ${days} DAY AS current,
             count() AS pageviews,
             count(DISTINCT person_id) AS visitors,
             count(DISTINCT $session_id) AS sessions,
             min(timestamp) AS first_seen
        FROM events
       WHERE ${BASE_FILTER} AND timestamp >= now() - INTERVAL ${days * 2} DAY
       GROUP BY current`,
    by_day: `
      SELECT toDate(toTimeZone(timestamp, 'UTC')) AS day,
             count() AS pageviews,
             count(DISTINCT person_id) AS visitors
        FROM events
       WHERE ${BASE_FILTER} AND ${since}
       GROUP BY day
       ORDER BY day`,
    top_pages: `
      SELECT properties.$pathname AS path,
             count() AS pageviews,
             count(DISTINCT person_id) AS visitors
        FROM events
       WHERE ${BASE_FILTER} AND ${since}
       GROUP BY path
       ORDER BY pageviews DESC
       LIMIT 10`,
    // posthog-js stamps document.referrer's domain on every event, and
    // an SPA navigation keeps the referrer of the page load, so counting
    // sessions per domain counts arrivals. Our own hosts show up only
    // after a full reload mid-visit; that's not a source.
    top_referrers: `
      SELECT properties.$referring_domain AS domain,
             count(DISTINCT $session_id) AS sessions,
             count(DISTINCT person_id) AS visitors
        FROM events
       WHERE ${BASE_FILTER} AND ${since}
         AND coalesce(properties.$referring_domain, '$direct') NOT IN (${SITE_HOSTS.map((h) => `'${h}'`).join(", ")})
       GROUP BY domain
       ORDER BY sessions DESC
       LIMIT 10`,
  };
}

export interface TrafficTotals {
  pageviews: number;
  visitors: number;
  sessions: number;
}

export interface TrafficData {
  totals: TrafficTotals;
  prev_totals: TrafficTotals;
  /** Earliest pageview across both windows (ISO), or null if none. */
  first_seen: string | null;
  by_day: Array<{ day: string; pageviews: number; visitors: number }>;
  top_pages: Array<{ path: string; pageviews: number; visitors: number }>;
  top_referrers: Array<{ domain: string; sessions: number; visitors: number }>;
}

type Row = unknown[];

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

const ZERO: TrafficTotals = { pageviews: 0, visitors: 0, sessions: 0 };

/** Rows arrive positional, in the SELECT order of trafficQueries. */
export function shapeTraffic(results: Record<TrafficQueryName, Row[]>): TrafficData {
  let totals = ZERO;
  let prev_totals = ZERO;
  let first_seen: string | null = null;
  for (const [current, pageviews, visitors, sessions, firstSeen] of results.totals) {
    const seen = firstSeen == null ? NaN : new Date(String(firstSeen)).getTime();
    if (Number.isFinite(seen) && (first_seen === null || seen < new Date(first_seen).getTime())) {
      first_seen = new Date(seen).toISOString();
    }
    const t = { pageviews: num(pageviews), visitors: num(visitors), sessions: num(sessions) };
    // ClickHouse booleans come back as true/false or 1/0 depending on
    // the client; either way only the truthiness matters.
    if (current === true || current === 1 || current === "1" || current === "true") totals = t;
    else prev_totals = t;
  }

  return {
    totals,
    prev_totals,
    first_seen,
    by_day: results.by_day.map(([day, pageviews, visitors]) => ({
      day: String(day).slice(0, 10),
      pageviews: num(pageviews),
      visitors: num(visitors),
    })),
    top_pages: results.top_pages.map(([path, pageviews, visitors]) => ({
      path: path == null || path === "" ? "/" : String(path),
      pageviews: num(pageviews),
      visitors: num(visitors),
    })),
    top_referrers: results.top_referrers.map(([domain, sessions, visitors]) => ({
      domain: domain == null || domain === "" ? "$direct" : String(domain),
      sessions: num(sessions),
      visitors: num(visitors),
    })),
  };
}

/** What to do about a failed PostHog query, by status. */
export function errorHint(status: number): string {
  if (status === 401 || status === 403) {
    return "PostHog rejected the key. POSTHOG_PERSONAL_API_KEY must be a personal API key (phx_…, not the phc_ project key) with the Query Read scope, and have access to POSTHOG_PROJECT_ID.";
  }
  if (status === 404) {
    return "No such project. POSTHOG_PROJECT_ID is the numeric ID in PostHog → Project settings, and POSTHOG_APP_HOST must match the region (https://us.posthog.com or https://eu.posthog.com).";
  }
  if (status === 429) {
    return "PostHog's query rate budget for this key is used up for the hour. Try again later.";
  }
  return "PostHog's query API failed. Check the posthog-traffic function logs in Supabase.";
}
