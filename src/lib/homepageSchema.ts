// Homepage SEO payload — meta copy + structured data, in one place.
//
// Imported by BOTH `src/pages/Index.tsx` (client render) and
// `api/page/[name].ts` (the Vercel function that injects tags into the
// HTML shell before it ever reaches a crawler). That shared import is
// the point: the previous arrangement had the schema objects defined
// inline in Index.tsx, so they only existed after React hydrated and
// Googlebot's first pass saw a document with zero structured data.
//
// Keep this file dependency-free. It is pulled into a serverless
// function bundle, so no React, no `@/` path aliases, no browser
// globals — plain data and plain functions only.

export const HOMEPAGE_TITLE =
  'Hereday — Event Map Maker for Race Directors & Organizers';

export const HOMEPAGE_DESCRIPTION =
  'Build a shareable event map for your race in minutes. Multi-route courses, water stations, elevation profiles, and a printable race-day checklist. Free to start.';

export interface Faq {
  q: string;
  a: string;
}

// FAQ content distilled from src/pages/Faq.tsx so the landing page
// stays in sync with the source-of-truth answers used on /faq.
export const HOMEPAGE_FAQS: Faq[] = [
  {
    q: 'What is Hereday?',
    a: "Hereday is an event-mapping tool for race organizers. You draw your course, drop points of interest like aid stations and parking, and publish a shareable public page that participants and spectators view on any device — no app install required.",
  },
  {
    q: 'Do my participants need to download anything?',
    a: "No. Hereday is entirely web-based — the editor and the public page both work in a browser. Participants and spectators don't need to install anything either.",
  },
  {
    q: 'Can I edit an event after publishing?',
    a: "Yes. Changes go live instantly on the same share link — no need to unpublish, edit, and republish, and no broken URLs the morning of your event.",
  },
  {
    q: 'What does Pro unlock?',
    a: "Pro is a one-time $49 upgrade per event. It adds unlimited routes & POIs, custom logo and banner branding, live volunteer status reporting, the Event Ops Center for race-day, all branded sponsors on the public map, and removes the Hereday watermark.",
  },
  {
    q: 'Is Pro a subscription?',
    a: "No. Pro is a one-time payment tied to a single event — no monthly fees, no auto-renew, no dead-month charges. If you run another event next year, that's a separate $49 upgrade.",
  },
  {
    q: 'What if my event is cancelled?',
    a: "Full refund within 7 days if you haven't published yet. If your event is cancelled after publishing — weather, venue loss, force majeure — email hello@hereday.io and we'll review case by case. Pro is per-event, so a cancellation never affects your other events.",
  },
];

const organizationSchema = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Hereday',
  url: 'https://hereday.io',
  logo: 'https://hereday.io/hereday-logo.png',
  description:
    'Event map maker for race directors and event organizers. Build shareable course maps with routes, aid stations, and elevation profiles.',
  email: 'hello@hereday.io',
};

const softwareSchema = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Hereday',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web',
  description:
    'Event mapping software for race organizers. Draw race routes, drop aid stations and points of interest, publish a shareable public event page with runner and spectator views.',
  offers: [
    { '@type': 'Offer', name: 'Free', price: '0', priceCurrency: 'USD' },
    {
      '@type': 'Offer',
      name: 'Pro',
      price: '49',
      priceCurrency: 'USD',
      description: 'Per event, one-time',
    },
  ],
};

const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: HOMEPAGE_FAQS.map((f) => ({
    '@type': 'Question',
    name: f.q,
    acceptedAnswer: { '@type': 'Answer', text: f.a },
  })),
};

// Order is not meaningful to crawlers; kept stable for diff readability.
export const HOMEPAGE_SCHEMAS: Record<string, unknown>[] = [
  organizationSchema,
  softwareSchema,
  faqSchema,
];
