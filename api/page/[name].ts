// Vercel Serverless Function: per-page Open Graph / Twitter / canonical
// meta tags for static marketing pages. Mirrors api/event/[slug].ts but
// for hardcoded marketing routes (no DB lookup needed).
//
// Why this exists: Twitter, iMessage, Slack, Facebook, Discord, and
// LinkedIn scrapers do not execute JavaScript, so they see whatever is
// in dist/index.html as the title/OG for every marketing route. Without
// per-route injection, sharing /faq on Slack shows the homepage preview.
// useSeoMeta covers Googlebot (which runs JS), but JS-less scrapers need
// the meta tags injected server-side.
//
// New marketing routes go in PAGE_META below + a Vercel rewrite in
// vercel.json. No code changes elsewhere.

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
// NOTE: this function deliberately has no relative imports. Vercel
// transpiles it to ESM without bundling, so any relative specifier is
// resolved by Node at runtime and must carry a `.js` extension —
// omitting it deploys cleanly and then crashes every request with
// FUNCTION_INVOCATION_FAILED, which takes all six marketing routes down
// at once because they all run through this one handler. Homepage
// structured data is baked into index.html by a Vite plugin instead;
// see the `homepageJsonLd` plugin in vite.config.ts.

const SITE_URL = 'https://hereday.io';
const DEFAULT_OG_IMAGE = `${SITE_URL}/og-default.png`;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface PageMeta {
  title: string;
  description: string;
}

// No `home` entry: `/` is served straight off the filesystem as
// dist/index.html, because Vercel resolves static files before it applies
// `rewrites`. A `/` rewrite pointing here is silently ignored.
const PAGE_META: Record<string, PageMeta> = {
  faq: {
    title: 'Hereday FAQ — Event Map Maker Help & Pricing Questions',
    description:
      'Answers to common questions about Hereday — the event map maker for race directors. Pricing, live tracking, route editing, refunds, and more.',
  },
  'getting-started': {
    title: 'How to Create an Event Map in 5 Minutes | Hereday Getting Started',
    description:
      'Step-by-step guide to creating your first event map with Hereday. From signup to a live shareable race-day page in under five minutes. No credit card needed.',
  },
  privacy: {
    title: 'Privacy Policy — Hereday',
    description:
      'How Hereday collects, uses, and protects your data. We do not sell user data, run ads, or train AI on your content.',
  },
  terms: {
    title: 'Terms of Service — Hereday',
    description:
      'Terms governing use of Hereday — the event map maker for race directors and event organizers.',
  },
  signup: {
    title: 'Sign Up Free — Hereday Event Map Maker for Race Directors',
    description:
      'Create a free Hereday account and publish a shareable race map in about five minutes. Unlimited free events, pay per event, never a subscription.',
  },
  refund: {
    title: 'Refund Policy — Hereday',
    description:
      'Hereday refund policy. Full refund within 7 days for unpublished events; cancellations after publishing reviewed case by case.',
  },
};

let cachedHtml: string | null = null;
function getHtmlTemplate(): string {
  if (cachedHtml) return cachedHtml;
  // Vercel runtime cwd varies; try a few likely paths before giving up.
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
    `Could not locate dist/index.html. Tried: ${candidates.join(', ')}`,
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

function injectMetaTags(html: string, meta: PageMeta, name: string): string {
  const url = `${SITE_URL}/${name}`;
  const ogImage = DEFAULT_OG_IMAGE;

  const metaBlock = [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Hereday" />`,
    `<meta property="og:url" content="${escapeHtml(url)}" />`,
    `<meta property="og:title" content="${escapeHtml(meta.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(meta.description)}" />`,
    `<meta property="og:image" content="${escapeHtml(ogImage)}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(meta.title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(meta.description)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(ogImage)}" />`,
    `<link rel="canonical" href="${escapeHtml(url)}" />`,
  ].join('\n    ');

  let out = html;

  out = out.replace(
    /<title>[^<]*<\/title>/,
    `<title>${escapeHtml(meta.title)}</title>`,
  );

  out = out.replace(
    /<meta name="description"[^>]*\/?>/,
    `<meta name="description" content="${escapeHtml(meta.description)}" />`,
  );

  out = out.replace(
    /\s*<meta\s+(property="og:[^"]*"|name="twitter:[^"]*")[^>]*\/?>/g,
    '',
  );
  out = out.replace(/\s*<link\s+rel="canonical"[^>]*\/?>/g, '');
  out = out.replace(
    /\s*<script\s+type="application\/ld\+json"[\s\S]*?<\/script>/g,
    '',
  );

  out = out.replace(
    /(<meta name="description"[^>]*\/?>)/,
    `$1\n    ${metaBlock}`,
  );

  return out;
}

export default async function handler(
  req: { query: Record<string, string | string[] | undefined> },
  res: {
    setHeader: (k: string, v: string) => void;
    status: (n: number) => { send: (body: string) => void };
  },
) {
  const nameRaw = req.query?.name;
  const name = Array.isArray(nameRaw) ? nameRaw[0] : nameRaw;

  let html: string;
  try {
    html = getHtmlTemplate();
  } catch (err) {
    console.error('[page] failed to read dist/index.html', err);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(500).send('Server error');
    return;
  }

  if (!name || typeof name !== 'string' || !PAGE_META[name]) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader(
      'Cache-Control',
      'public, s-maxage=300, stale-while-revalidate=3600',
    );
    res.status(200).send(html);
    return;
  }

  // Degrade rather than fail. All six marketing routes run through this
  // one handler, so an exception here is not one broken page — it is the
  // entire marketing site returning 500 at once, which is exactly what
  // happened on 2026-08-03. Serving the un-injected shell costs this
  // request its per-page title, canonical and OG tags (and leaves the
  // homepage's structured data on it), all of which is vastly better than
  // no page at all. Googlebot renders JS, so useSeoMeta still corrects
  // the head client-side.
  let body: string;
  let degraded = false;
  try {
    body = injectMetaTags(html, PAGE_META[name], name);
  } catch (err) {
    console.error('[page] meta injection failed for', name, err);
    body = html;
    degraded = true;
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // Don't cache a degraded response for an hour — a transient fault would
  // pin the wrong tags at the edge long after the cause was gone.
  res.setHeader(
    'Cache-Control',
    degraded
      ? 'public, s-maxage=60, stale-while-revalidate=300'
      : 'public, s-maxage=3600, stale-while-revalidate=86400',
  );
  res.status(200).send(body);
}
