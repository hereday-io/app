// Structured data for marketing routes served by api/page/[name].ts.
//
// Same rationale as api/_shared/homepageSchema.ts: rendering JSON-LD from
// a React component means it only exists after hydration, so the served
// HTML a crawler reads first has none. These are injected into <head>
// server-side instead.
//
// Keep this file dependency-free — it is imported into a serverless
// function bundle. No React, no `@/` aliases, no browser globals.
//
// The homepage is deliberately NOT here: `/` is served straight off the
// filesystem as dist/index.html because Vercel resolves static files
// before applying rewrites, so its schema is baked in at build time by
// the homepageJsonLd plugin in vite.config.ts instead.

// Article rather than HowTo because Google deprecated HowTo rich results
// in September 2023 — HowTo still validates but no longer renders as a
// step preview. Article is the modern rich-result-eligible type for
// tutorial-style pages. (Comment preserved from GettingStarted.tsx,
// which this was lifted out of.)
const gettingStartedArticleSchema = {
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: 'How to Create an Event Map in 5 Minutes',
  description:
    'Step-by-step guide to creating your first event map with Hereday — from signup to a live shareable race-day page in under five minutes.',
  image: 'https://hereday.io/og-default.png',
  datePublished: '2026-04-17',
  dateModified: '2026-04-17',
  author: {
    '@type': 'Organization',
    name: 'Hereday',
    url: 'https://hereday.io',
  },
  publisher: {
    '@type': 'Organization',
    name: 'Hereday',
    logo: {
      '@type': 'ImageObject',
      url: 'https://hereday.io/hereday-logo.png',
    },
  },
};

// Keyed by the same name used in PAGE_META / the vercel.json rewrite.
//
// `/faq` is absent on purpose. Its FAQPage schema is built from answers
// that interpolate PAYWALL_LIMITS (`src/hooks/usePaywall.ts`), so lifting
// it here would mean duplicating the free-tier route/POI limits into a
// second file. Those numbers are enforced in product code; a copy that
// silently drifts would have us publishing wrong limits to Google as
// structured data. It stays client-rendered until prerendering (SEO
// roadmap 1b) can capture it without duplication.
export const PAGE_SCHEMAS: Record<string, Record<string, unknown>[]> = {
  'getting-started': [gettingStartedArticleSchema],
};
