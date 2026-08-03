// Sitemap for the public marketing pages.
//
// Emits an XML sitemap listing only the pre-login marketing surface —
// the landing page, help pages, signup, and the legal pages. These are
// the only URLs we want ranking in search.
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
// - `/event/:slug` pages are deliberately excluded. They're shareable
//   product output, not marketing pages, and are served `noindex` by
//   api/event/[slug].ts. Listing them here would contradict that tag
//   and invite Search Console "indexed though blocked"-class warnings.
//   Because of that exclusion this function no longer reads the DB at
//   all — it used to query `public_events` with the service-role key.
// - Edge-cached via `Cache-Control: public, max-age=3600` (1h). The URL
//   list is static now, so this could become a plain file in public/;
//   kept as a function so the existing vercel.json rewrite still works.
// - No pagination. Sitemaps support up to 50k URLs per file; we're
//   nowhere near that. When we are, split into a sitemap index.

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

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${staticUrls.join("\n")}
</urlset>`;

    return new Response(xml, {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/xml; charset=utf-8",
        // Edge + browser cache. The list is static, so this could be far
        // longer; 1h keeps it cheap to correct a mistake in the URL set.
        "Cache-Control": "public, max-age=3600, s-maxage=3600",
      },
    });
  } catch (err) {
    console.error("[sitemap] unhandled error", err);
    return new Response("Internal error", { status: 500 });
  }
});
