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
  // dist/index.html is the Vite build output. We include it in the function
  // bundle via vercel.json `includeFiles`. Vercel's runtime cwd varies, so
  // we try a few likely paths before giving up.
  const candidates = [
    join(process.cwd(), 'dist', 'index.html'),
    join(__dirname, '..', '..', 'dist', 'index.html'),
    join(__dirname, '..', '..', '..', 'dist', 'index.html'),
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
    `Could not locate dist/index.html. Tried: ${candidates.join(', ')}`
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

function buildMapboxImage(routes: unknown): string {
  if (!MAPBOX_TOKEN) return DEFAULT_OG_IMAGE;
  const routeList = Array.isArray(routes) ? (routes as Array<Record<string, unknown>>) : [];
  const firstRoute = routeList[0];
  if (!firstRoute) return DEFAULT_OG_IMAGE;

  const coords =
    (firstRoute.routeCoords as [number, number][] | undefined) ??
    (firstRoute.waypoints as [number, number][] | undefined) ??
    [];
  const firstCoord = coords[0];
  if (!firstCoord || firstCoord.length < 2) return DEFAULT_OG_IMAGE;

  const [lon, lat] = firstCoord;
  const pin = `pin-l+ef4444(${lon},${lat})`;
  return `https://api.mapbox.com/styles/v1/mapbox/outdoors-v12/static/${pin}/${lon},${lat},12/1200x630@2x?access_token=${MAPBOX_TOKEN}`;
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
  ].join('\n    ');

  let out = html;

  // Replace <title>
  out = out.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`);

  // Replace description
  out = out.replace(
    /<meta name="description"[^>]*\/?>/,
    `<meta name="description" content="${escapeHtml(description)}" />`
  );

  // Strip existing og:* and twitter:* tags from the shell
  out = out.replace(/\s*<meta\s+(property="og:[^"]*"|name="twitter:[^"]*")[^>]*\/?>/g, '');

  // Inject event-specific block right after the description tag
  out = out.replace(
    /(<meta name="description"[^>]*\/?>)/,
    `$1\n    ${metaBlock}`
  );

  return out;
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
    console.error('[og] failed to read dist/index.html', err);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(500).send('Server error');
    return;
  }

  if (!slug || typeof slug !== 'string') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(html);
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
      res.status(200).send(html);
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
    res.status(200).send(html);
  }
}
