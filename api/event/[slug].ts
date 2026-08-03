// Vercel Serverless Function: dynamic Open Graph / Twitter meta tags for
// public event pages. Scrapers like iMessage, Slack, Facebook, Twitter do
// not execute JavaScript, so we inject per-event tags into the built HTML
// shell before returning it. Real users receive the same HTML and the
// Vite-bundled React app then takes over client-side — EventPublic.tsx
// reads the slug from the URL exactly as before.

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
const MAPBOX_TOKEN = process.env.VITE_MAPBOX_TOKEN || '';
const SITE_URL = 'https://hereday.io';
const DEFAULT_OG_IMAGE = `${SITE_URL}/og-default.png`;

// __dirname isn't defined when the function runs as ESM (package.json has
// "type": "module"). Derive it from import.meta.url which is always set.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Cache the HTML shell in memory per warm invocation — avoids repeated disk
// reads on subsequent scrapes of the same function instance.
let cachedHtml: string | null = null;
function getHtmlTemplate(): string {
  if (cachedHtml) return cachedHtml;
  // prerendered/shell.html is the un-prerendered SPA shell, written by
  // scripts/prerender.mjs and pulled into the function bundle via
  // vercel.json `includeFiles`.
  //
  // Deliberately NOT dist/index.html: that file now holds the *prerendered
  // homepage*, so reading it here would serve Hereday's marketing copy as
  // the body of every shared event link. Vercel's runtime cwd varies, so
  // try a few likely paths before giving up.
  const candidates = [
    join(process.cwd(), 'prerendered', 'shell.html'),
    join(__dirname, '..', '..', 'prerendered', 'shell.html'),
    join(__dirname, '..', '..', '..', 'prerendered', 'shell.html'),
  ];
  for (const p of candidates) {
    try {
      cachedHtml = readFileSync(p, 'utf8');
      return cachedHtml;
    } catch {
      // try next
    }
  }
  throw new Error(
    `Could not locate prerendered/shell.html. Tried: ${candidates.join(', ')}`
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return null;
  }
}

interface PublicEventRow {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  event_date: string | null;
  routes: unknown;
  route_count: number;
  poi_count: number;
  logo_url: string | null;
  has_ended: boolean | null;
}

// Google Encoded Polyline Algorithm (precision 5). Lets us stuff a full
// route into a Mapbox static image URL without blowing past the ~8k URL
// limit. Mirrors what google.maps.geometry.encoding.encodePath does.
function encodePolyline(coords: Array<[number, number]>): string {
  let output = '';
  let prevLat = 0;
  let prevLng = 0;
  for (const [lng, lat] of coords) {
    const latE5 = Math.round(lat * 1e5);
    const lngE5 = Math.round(lng * 1e5);
    const dLat = latE5 - prevLat;
    const dLng = lngE5 - prevLng;
    prevLat = latE5;
    prevLng = lngE5;
    for (let v of [dLat, dLng]) {
      v = v < 0 ? ~(v << 1) : v << 1;
      while (v >= 0x20) {
        output += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
        v >>= 5;
      }
      output += String.fromCharCode(v + 63);
    }
  }
  return output;
}

// Downsample a coord array to at most `maxPoints` by even-interval
// picking. Keeps first and last (start/finish) unconditionally.
function downsample(coords: Array<[number, number]>, maxPoints: number): Array<[number, number]> {
  if (coords.length <= maxPoints) return coords;
  const out: Array<[number, number]> = [];
  const step = (coords.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i++) {
    out.push(coords[Math.min(coords.length - 1, Math.round(i * step))]);
  }
  return out;
}

function buildMapboxImage(routes: unknown): string {
  if (!MAPBOX_TOKEN) return DEFAULT_OG_IMAGE;
  const routeList = Array.isArray(routes) ? (routes as Array<Record<string, unknown>>) : [];
  const firstRoute = routeList[0];
  if (!firstRoute) return DEFAULT_OG_IMAGE;

  // Prefer the snapped routeCoords (dense, follows roads); fall back to
  // the raw waypoints if the snap never ran.
  const rawCoords =
    (firstRoute.routeCoords as [number, number][] | undefined) ??
    (firstRoute.waypoints as [number, number][] | undefined) ??
    [];
  const coords = rawCoords.filter(
    (c) => Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]),
  );
  if (coords.length === 0) return DEFAULT_OG_IMAGE;

  // Single-point route (pathological) — just drop a pin and call it done.
  if (coords.length === 1) {
    const [lon, lat] = coords[0];
    const pin = `pin-l+ef4444(${lon},${lat})`;
    return `https://api.mapbox.com/styles/v1/mapbox/outdoors-v12/static/${pin}/${lon},${lat},13/1200x630@2x?access_token=${MAPBOX_TOKEN}`;
  }

  // Draw the polyline + start/finish pins, with the map auto-fitting
  // to the route bounds. Downsample to keep the encoded URL well under
  // Mapbox's 8192-char limit even for courses with thousands of points.
  const sampled = downsample(coords, 120);
  const encoded = encodePolyline(sampled);
  // Mapbox expects the encoded polyline percent-encoded within the URL.
  const path = `path-5+ef4444-0.9(${encodeURIComponent(encoded)})`;
  const [startLng, startLat] = coords[0];
  const [endLng, endLat] = coords[coords.length - 1];
  const startPin = `pin-s-a+22c55e(${startLng},${startLat})`;
  const finishPin = `pin-s-b+0ea5e9(${endLng},${endLat})`;
  const overlays = `${path},${startPin},${finishPin}`;
  const url = `https://api.mapbox.com/styles/v1/mapbox/outdoors-v12/static/${overlays}/auto/1200x630@2x?access_token=${MAPBOX_TOKEN}&padding=80`;

  // Belt-and-suspenders: if we somehow blew through Mapbox's URL limit,
  // fall back to the default image rather than surfacing a broken tag.
  if (url.length > 8100) return DEFAULT_OG_IMAGE;
  return url;
}

function buildDescription(row: PublicEventRow): string {
  // Ended events get a different framing — scrapers (and search engines)
  // should see "this event is over, sign up for updates" instead of
  // "join the race" copy.
  if (row.has_ended) {
    const dateStr = formatDate(row.event_date);
    const when = dateStr ? `on ${dateStr}` : '';
    return `This event has concluded${when ? ` ${when}` : ''}. Subscribe to be notified when it runs again.`;
  }
  const parts: string[] = [];
  const dateStr = formatDate(row.event_date);
  if (dateStr) parts.push(dateStr);
  if (row.city) parts.push(row.city);
  const routes = `${row.route_count} route${row.route_count !== 1 ? 's' : ''}`;
  const pois = `${row.poi_count} point${row.poi_count !== 1 ? 's' : ''} of interest`;
  parts.push(`${routes} · ${pois}`);
  return parts.join(' · ');
}

function injectMetaTags(html: string, row: PublicEventRow, slug: string): string {
  const url = `${SITE_URL}/event/${slug}`;
  const title = row.has_ended ? `${row.name} — Event Ended` : `${row.name} — Hereday`;
  const description = buildDescription(row);
  // Don't burn Mapbox static image quota on a course that's no longer
  // relevant — the default OG image is fine for the ended state.
  const ogImage = row.has_ended ? DEFAULT_OG_IMAGE : buildMapboxImage(row.routes);

  const metaBlock = [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Hereday" />`,
    `<meta property="og:url" content="${escapeHtml(url)}" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    `<meta property="og:image" content="${escapeHtml(ogImage)}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(description)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(ogImage)}" />`,
    // Event pages are deliberately kept out of search results — only the
    // pre-login marketing pages are meant to rank. `noindex` (not a
    // robots.txt Disallow) is the right lever here: the page must stay
    // crawlable so Googlebot can actually read this tag, and so link
    // scrapers keep working. `follow` is the harmless default.
    `<meta name="robots" content="noindex, follow" />`,
    // Self-canonical, and it must NOT point at the homepage. Google can
    // propagate a `noindex` across a cross-domain/cross-page canonical to
    // the target — with the shell's `canonical -> https://hereday.io/`
    // still in place, the noindex above would risk deindexing the
    // homepage itself.
    `<link rel="canonical" href="${escapeHtml(url)}" />`,
  ].join('\n    ');

  let out = html;

  // Replace <title>
  out = out.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`);

  // Replace description
  out = out.replace(
    /<meta name="description"[^>]*\/?>/,
    `<meta name="description" content="${escapeHtml(description)}" />`
  );

  // Strip existing og:*, twitter:*, robots, and canonical tags from the shell
  out = out.replace(/\s*<meta\s+(property="og:[^"]*"|name="twitter:[^"]*")[^>]*\/?>/g, '');
  out = out.replace(/\s*<meta\s+name="robots"[^>]*\/?>/g, '');
  out = out.replace(/\s*<link\s+rel="canonical"[^>]*\/?>/g, '');
  // The shell carries the homepage's Organization / SoftwareApplication /
  // FAQPage blocks, baked in at build time by the homepageJsonLd plugin in
  // vite.config.ts. Left in place, every event page would claim to be the
  // Hereday homepage with its pricing FAQ attached.
  out = out.replace(
    /\s*<script\s+type="application\/ld\+json"[\s\S]*?<\/script>/g,
    '',
  );

  // Inject event-specific block right after the description tag
  out = out.replace(
    /(<meta name="description"[^>]*\/?>)/,
    `$1\n    ${metaBlock}`
  );

  return out;
}

// Fallback responses (missing slug, unknown event, upstream error) serve the
// raw shell, which carries `canonical -> https://hereday.io/`. Left alone,
// a bogus /event/... URL reads to Google as a duplicate of the homepage.
// Strip the canonical and mark it noindex so these never enter the index.
function noindexShell(html: string): string {
  let out = html.replace(/\s*<link\s+rel="canonical"[^>]*\/?>/g, '');
  out = out.replace(/\s*<meta\s+name="robots"[^>]*\/?>/g, '');
  // Same reason as injectMetaTags: don't let a bogus /event/... URL carry
  // the homepage schema baked into the shell.
  out = out.replace(
    /\s*<script\s+type="application\/ld\+json"[\s\S]*?<\/script>/g,
    '',
  );
  return out.replace(
    /(<meta name="description"[^>]*\/?>)/,
    `$1\n    <meta name="robots" content="noindex, follow" />`
  );
}

export default async function handler(req: { query: Record<string, string | string[] | undefined> }, res: {
  setHeader: (k: string, v: string) => void;
  status: (n: number) => { send: (body: string) => void };
}) {
  const slugRaw = req.query?.slug;
  const slug = Array.isArray(slugRaw) ? slugRaw[0] : slugRaw;

  // Always serve the SPA shell — even on missing slug or errors, the React
  // app will handle the "not found" state. OG tags just won't be overridden.
  let html: string;
  try {
    html = getHtmlTemplate();
  } catch (err) {
    console.error('[og] failed to read prerendered/shell.html', err);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(500).send('Server error');
    return;
  }

  if (!slug || typeof slug !== 'string') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(noindexShell(html));
    return;
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data, error } = await supabase
      .from('public_events')
      .select('id, name, slug, city, event_date, routes, route_count, poi_count, logo_url, has_ended')
      .eq('slug', slug)
      .maybeSingle();

    if (error || !data) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      // Cache 404s briefly so unpublished-event scrapes don't hammer the DB
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
      res.status(200).send(noindexShell(html));
      return;
    }

    const modified = injectMetaTags(html, data as PublicEventRow, slug);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // Edge-cache event HTML so scrapers don't re-hit Supabase on every preview
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
    res.status(200).send(modified);
  } catch (err) {
    console.error('[og] handler error', err);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(noindexShell(html));
  }
}
