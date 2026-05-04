// Sitemap for published events.
//
// Emits an XML sitemap listing every row in `public_events` plus a few
// top-level static URLs (landing page, login, signup). Crawlers pick up
// new events automatically as soon as they're published.
//
// Deployed at:
//   https://<project-ref>.supabase.co/functions/v1/sitemap
//
// For production, point search consoles at a domain-level alias —
// typically `/sitemap.xml` on the marketing site — via a CDN rewrite
// (Netlify/Vercel/Cloudflare Workers). The edge function itself is the
// source of truth; the rewrite is just URL aesthetics.
//
// Design notes:
// - Uses the service-role key because even though `public_events` is
//   readable by `anon`, going through the service role avoids an
//   extra RLS evaluation per row on large tables. This function
//   returns only columns that the view already exposes publicly, so
//   the elevated privilege never leaks anything.
// - Edge-cached via `Cache-Control: public, max-age=3600` (1h). Event
//   publishes can take up to an hour to show up in the sitemap; that's
//   fine — Google re-crawls on its own schedule and an hour is well
//   under the crawl cadence.
// - No pagination. Sitemaps support up to 50k URLs per file; we're
//   nowhere near that. When we are, split into a sitemap index.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// The public-facing origin used to build absolute URLs in the sitemap.
// Hardcoded rather than env-driven because a stale PUBLIC_SITE_ORIGIN
// secret previously pointed this at the pre-rebrand domain and broke
// Search Console indexing. If the canonical host ever changes, edit
// this constant in code so the change is reviewed in a PR.
const PUBLIC_SITE_ORIGIN = "https://hereday.io";

interface PublicEventRow {
  slug: string;
  updated_at: string;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function urlEntry(loc: string, lastmod?: string, changefreq = "weekly", priority = "0.7"): string {
  const lastmodTag = lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : "";
  return `  <url>
    <loc>${escapeXml(loc)}</loc>${lastmodTag}
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      return new Response("Server misconfigured", { status: 500 });
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    const { data, error } = await supabase
      .from("public_events")
      .select("slug, updated_at")
      .order("updated_at", { ascending: false })
      .limit(50000);

    if (error) {
      console.error("[sitemap] query failed", error);
      return new Response("Failed to generate sitemap", { status: 500 });
    }

    const rows = (data ?? []) as PublicEventRow[];

    // Static top-level pages. Landing is highest priority; the
    // marketing/help pages get medium priority. /signup is the only
    // auth page worth indexing — it's a conversion endpoint. /login
    // and dashboard pages are intentionally omitted (and disallowed
    // in robots.txt) to avoid wasting crawl budget on private routes.
    const staticUrls = [
      urlEntry(`${PUBLIC_SITE_ORIGIN}/`, undefined, "weekly", "1.0"),
      urlEntry(`${PUBLIC_SITE_ORIGIN}/getting-started`, undefined, "monthly", "0.8"),
      urlEntry(`${PUBLIC_SITE_ORIGIN}/faq`, undefined, "monthly", "0.7"),
      urlEntry(`${PUBLIC_SITE_ORIGIN}/signup`, undefined, "monthly", "0.5"),
      urlEntry(`${PUBLIC_SITE_ORIGIN}/refund`, undefined, "yearly", "0.3"),
      urlEntry(`${PUBLIC_SITE_ORIGIN}/terms`, undefined, "yearly", "0.3"),
      urlEntry(`${PUBLIC_SITE_ORIGIN}/privacy`, undefined, "yearly", "0.3"),
    ];

    const eventUrls = rows.map((row) => {
      // `updated_at` is ISO-8601 from Postgres timestamptz; sitemaps
      // prefer YYYY-MM-DD but accept full W3C datetime. Use the date
      // portion for compatibility with older crawlers.
      const lastmod = row.updated_at?.slice(0, 10);
      return urlEntry(
        `${PUBLIC_SITE_ORIGIN}/event/${row.slug}`,
        lastmod,
        "weekly",
        "0.8",
      );
    });

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...staticUrls, ...eventUrls].join("\n")}
</urlset>`;

    return new Response(xml, {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/xml; charset=utf-8",
        // Edge + browser cache. 1h is a sensible floor for a sitemap —
        // longer and newly-published events take too long to show up,
        // shorter and we're hitting the DB more than necessary.
        "Cache-Control": "public, max-age=3600, s-maxage=3600",
      },
    });
  } catch (err) {
    console.error("[sitemap] unhandled error", err);
    return new Response("Internal error", { status: 500 });
  }
});
