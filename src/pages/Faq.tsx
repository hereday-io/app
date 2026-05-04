import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { PAYWALL_LIMITS } from '@/hooks/usePaywall';
import { useSeoMeta } from '@/hooks/useSeoMeta';
import { JsonLd } from '@/components/JsonLd';

const LAST_UPDATED = 'April 17, 2026';

/* ------------------------------------------------------------------ */
/*  FAQ data                                                           */
/* ------------------------------------------------------------------ */

interface FaqItem {
  q: string;
  a: React.ReactNode;
  aText: string;
}

const generalFaqs: FaqItem[] = [
  {
    q: 'What is Hereday?',
    aText:
      'Hereday is an event-mapping tool for race organizers. You draw your course, drop points of interest (aid stations, parking, medical, etc.), and publish a shareable public page that participants and spectators can view on any device. No app install required.',
    a: (
      <p>
        Hereday is an event-mapping tool for race organizers. You draw your course, drop points
        of interest (aid stations, parking, medical, etc.), and publish a shareable public page
        that participants and spectators can view on any device. No app install required.
      </p>
    ),
  },
  {
    q: 'Do I need to download anything?',
    aText:
      "No. Hereday is entirely web-based — the editor, the public page, and live tracking all work in a browser. Participants and spectators don't need to install anything either.",
    a: (
      <p>
        No. Hereday is entirely web-based — the editor, the public page, and live tracking all
        work in a browser. Participants and spectators don't need to install anything either.
      </p>
    ),
  },
  {
    q: 'Can I edit an event after publishing?',
    aText:
      'Yes. Changes go live instantly — no need to unpublish, edit, and republish. Your share link stays the same regardless of how many edits you make.',
    a: (
      <p>
        Yes. Changes go live instantly — no need to unpublish, edit, and republish. Your share
        link stays the same regardless of how many edits you make.
      </p>
    ),
  },
  {
    q: 'Can multiple people manage the same event?',
    aText:
      'Not yet. Right now each event has a single organizer. Team/multi-admin support is on the roadmap and will come once we see organizations running multiple events per season.',
    a: (
      <p>
        Not yet. Right now each event has a single organizer. Team/multi-admin support is on the
        roadmap and will come once we see organizations running multiple events per season.
      </p>
    ),
  },
];

const planFaqs: FaqItem[] = [
  {
    q: "What's included in the free plan?",
    aText: `Everything you need to publish a race map: up to ${PAYWALL_LIMITS.routes} routes per event, up to ${PAYWALL_LIMITS.pois} points of interest per event, a public event page with runner and spectator views, QR code for race-day signage, email subscriber collection, race-day prep checklist PDF (with Hereday footer), and course elevation profile. Free events display a small "Made with Hereday" footer on the public page.`,
    a: (
      <>
        <p>Everything you need to publish a race map:</p>
        <ul className="list-disc pl-5 space-y-1 mt-2">
          <li>Up to {PAYWALL_LIMITS.routes} routes per event</li>
          <li>Up to {PAYWALL_LIMITS.pois} points of interest per event</li>
          <li>Public event page with runner and spectator views</li>
          <li>QR code for race-day signage</li>
          <li>Email subscriber collection</li>
          <li>Race-day prep checklist PDF (with Hereday footer)</li>
          <li>Course elevation profile</li>
        </ul>
        <p className="mt-2">
          Free events display a small "Made with Hereday" footer on the public page.
        </p>
      </>
    ),
  },
  {
    q: 'What does Pro unlock?',
    aText:
      'Pro is a one-time $49 upgrade per event. It adds unlimited routes (perfect for marathon weekends with 5K/10K/half/full), unlimited points of interest, custom branding (your logo and banner on the public page), live GPS tracking (spectators follow runners in real time), live volunteer status reporting (water station Open/Low/Closed updates), the Event Ops Center for race-day, all branded sponsors visible publicly, no Hereday footer, a clean checklist PDF, and priority support.',
    a: (
      <>
        <p>Pro is a <strong>one-time $49 upgrade per event</strong>. It adds:</p>
        <ul className="list-disc pl-5 space-y-1 mt-2">
          <li><strong>Unlimited routes</strong> — perfect for marathon weekends (5K/10K/half/full)</li>
          <li><strong>Unlimited points of interest</strong></li>
          <li><strong>Custom branding</strong> — your logo and banner on the public page</li>
          <li><strong>Live GPS tracking</strong> — spectators follow runners in real time on the map</li>
          <li><strong>Live volunteer status reporting</strong> — water station Open/Low/Closed updates show as colored dots on the public map</li>
          <li><strong>Event Ops Center</strong> — live volunteer activity, scout review, and analytics dashboard for race day</li>
          <li><strong>All branded sponsors visible publicly</strong> — Free events show one sponsor; Pro shows your full sponsor list with logos and CTAs</li>
          <li><strong>No Hereday footer</strong> on the public page</li>
          <li><strong>Clean checklist PDF</strong> without the Hereday footer</li>
          <li>Priority support</li>
        </ul>
      </>
    ),
  },
  {
    q: 'Is Pro a subscription?',
    aText:
      "No. Pro is a one-time payment tied to a single event. No monthly fees, no auto-renew, no dead-month charges. You pay when you have an event to run, and you're done. If you run another event next year, that's a separate $49 upgrade.",
    a: (
      <p>
        No. Pro is a one-time payment tied to a single event. No monthly fees, no auto-renew,
        no dead-month charges. You pay when you have an event to run, and you're done. If you
        run another event next year, that's a separate $49 upgrade.
      </p>
    ),
  },
  {
    q: 'Can I try Pro features before paying?',
    aText: `The free plan lets you build your entire event — routes, markers, preview, publish, share. You'll only hit the upgrade prompt if you exceed ${PAYWALL_LIMITS.routes} routes or ${PAYWALL_LIMITS.pois} markers, or when you try to add custom branding. Build first, decide later.`,
    a: (
      <p>
        The free plan lets you build your entire event — routes, markers, preview, publish, share.
        You'll only hit the upgrade prompt if you exceed {PAYWALL_LIMITS.routes} routes or{' '}
        {PAYWALL_LIMITS.pois} markers, or when you try to add custom branding. Build first,
        decide later.
      </p>
    ),
  },
  {
    q: 'What if my event is cancelled?',
    aText:
      "Full refund within 7 days if you haven't published yet. If your event has to be cancelled after publishing — weather, venue loss, force majeure — email hello@hereday.io and we'll review it case by case. Pro is per-event, so a cancellation never affects your other events on the platform.",
    a: (
      <p>
        Full refund within 7 days if you haven't published yet. If your event has to be cancelled
        after publishing — weather, venue loss, force majeure — email{' '}
        <a href="mailto:hello@hereday.io" className="text-primary hover:underline">
          hello@hereday.io
        </a>{' '}
        and we'll review it case by case. Pro is per-event, so a cancellation never affects
        your other events on the platform.
      </p>
    ),
  },
  {
    q: 'I run multiple races a year. Do I pay $49 every time?',
    aText:
      'Yes — Pro is one-time per event. Three races a year is three separate $49 upgrades when you publish each one. We deliberately picked per-event pricing over a subscription so you never pay during your off-season. Annual / team plans are on the roadmap once we see organizations regularly running multiple events per season.',
    a: (
      <p>
        Yes — Pro is one-time per event. Three races a year is three separate $49 upgrades when
        you publish each one. We deliberately picked per-event pricing over a subscription so
        you never pay during your off-season. Annual / team plans are on the roadmap once we
        see organizations regularly running multiple events per season.
      </p>
    ),
  },
];

const courseAndMapFaqs: FaqItem[] = [
  {
    q: 'Do routes snap to roads automatically?',
    aText:
      'Yes. When you click to place waypoints, Hereday uses Mapbox turn-by-turn routing to snap them to real roads. The resulting route follows actual streets and trails that your runners will be on.',
    a: (
      <p>
        Yes. When you click to place waypoints, Hereday uses Mapbox turn-by-turn routing to
        snap them to real roads. The resulting route follows actual streets and trails that your
        runners will be on.
      </p>
    ),
  },
  {
    q: 'Can participants download the route?',
    aText:
      'Yes. The public event page includes a GPX export option. Participants can download the route and load it into their GPS watch, phone, or running app.',
    a: (
      <p>
        Yes. The public event page includes a GPX export option. Participants can download the
        route and load it into their GPS watch, phone, or running app.
      </p>
    ),
  },
];

const trackingFaqs: FaqItem[] = [
  {
    q: 'How does live tracking work?',
    aText:
      'Live tracking is a Pro feature. When enabled, runners open your event page on their phone and tap "Share my location." Their GPS coordinates broadcast to a spectator map in real time — spectators see runner dots moving along the course with pace information. Runners can stop sharing at any time. Location is only broadcast during the tracking window you configure, and we don\'t store historical GPS tracks after the session ends.',
    a: (
      <>
        <p>
          Live tracking is a Pro feature. When enabled, runners open your event page on their
          phone and tap "Share my location." Their GPS coordinates broadcast to a spectator
          map in real time — spectators see runner dots moving along the course with pace
          information.
        </p>
        <p className="mt-2">
          Runners can stop sharing at any time. Location is only broadcast during the
          tracking window you configure, and we don't store historical GPS tracks after the
          session ends.
        </p>
      </>
    ),
  },
  {
    q: 'Does live tracking require an app install?',
    aText:
      "No. Runners share location through their browser — no app download needed. The browser asks for GPS permission, and that's it. Works on iPhone and Android.",
    a: (
      <p>
        No. Runners share location through their browser — no app download needed. The
        browser asks for GPS permission, and that's it. Works on iPhone and Android.
      </p>
    ),
  },
];

const billingFaqs: FaqItem[] = [
  {
    q: 'How do refunds work?',
    aText:
      "Full refund within 7 days if the event hasn't been published. No refunds after publishing, since Pro features have been delivered to your participants. Cancelled events due to weather or venue loss are reviewed case by case. See our Refund Policy for details.",
    a: (
      <p>
        Full refund within 7 days if the event hasn't been published. No refunds after
        publishing, since Pro features have been delivered to your participants. Cancelled
        events due to weather or venue loss are reviewed case by case. See our{' '}
        <Link to="/refund" className="text-primary hover:underline">Refund Policy</Link>{' '}
        for details.
      </p>
    ),
  },
  {
    q: 'What payment methods do you accept?',
    aText:
      'All major credit and debit cards via Stripe. We never see or store your card number.',
    a: (
      <p>
        All major credit and debit cards via Stripe. We never see or store your card number.
      </p>
    ),
  },
];

const privacyFaqs: FaqItem[] = [
  {
    q: 'Who can see my event?',
    aText:
      'Only published events have a public page. Draft events are visible only to you in your dashboard. You can unpublish at any time to take the page offline.',
    a: (
      <p>
        Only published events have a public page. Draft events are visible only to you in your
        dashboard. You can unpublish at any time to take the page offline.
      </p>
    ),
  },
  {
    q: 'Do you sell my data?',
    aText:
      "No. We don't sell data, run ads, or train AI models on your content. See our Privacy Policy for the full breakdown.",
    a: (
      <p>
        No. We don't sell data, run ads, or train AI models on your content. See our{' '}
        <Link to="/privacy" className="text-primary hover:underline">Privacy Policy</Link>{' '}
        for the full breakdown.
      </p>
    ),
  },
];

const sections = [
  { title: 'General', items: generalFaqs },
  { title: 'Free vs Pro', items: planFaqs },
  { title: 'Courses & Maps', items: courseAndMapFaqs },
  { title: 'Live Tracking', items: trackingFaqs },
  { title: 'Billing', items: billingFaqs },
  { title: 'Privacy & Data', items: privacyFaqs },
];

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

const Faq = () => {
  useSeoMeta({
    title: 'Hereday FAQ — Event Map Maker Help & Pricing Questions',
    description:
      'Answers to common questions about Hereday — the event map maker for race directors. Pricing, live tracking, route editing, refunds, and more.',
    canonicalPath: '/faq',
  });

  const allFaqs = sections.flatMap((s) => s.items);
  const faqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: allFaqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.aText },
    })),
  };

  return (
    <div className="min-h-screen bg-background">
      <JsonLd data={faqSchema} />
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-card/80 backdrop-blur-md">
        <div className="container mx-auto flex items-center justify-between py-3 px-4">
          <Link to="/" className="flex items-center gap-3">
            <img src="/hereday-logo.png" alt="Hereday" className="h-16 w-auto -my-3" />
          </Link>
          <Link
            to="/"
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="container mx-auto px-4 py-12 max-w-2xl">
        <h1 className="text-3xl font-display font-bold text-foreground mb-2">
          Frequently Asked Questions
        </h1>
        <p className="text-sm text-muted-foreground mb-10">Last updated: {LAST_UPDATED}</p>

        <div className="space-y-10">
          {sections.map((section) => (
            <div key={section.title}>
              <h2 className="text-lg font-display font-semibold text-foreground mb-4 pb-2 border-b border-border">
                {section.title}
              </h2>
              <div className="space-y-1">
                {section.items.map((item, i) => (
                  <Accordion key={i} q={item.q} a={item.a} />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Still have questions? */}
        <div className="mt-14 pt-8 border-t border-border text-center">
          <p className="text-foreground/80 text-sm">
            Still have a question?{' '}
            <a href="mailto:hello@hereday.io" className="text-primary font-medium hover:underline">
              hello@hereday.io
            </a>
          </p>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border bg-card py-8 mt-12">
        <div className="container mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <img src="/hereday-logo.png" alt="Hereday" className="h-16 w-auto -my-3 opacity-70" />
          <p className="text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()} Hereday LLC. All rights reserved.
          </p>
          <div className="flex gap-4 text-xs text-muted-foreground">
            <Link to="/getting-started" className="hover:text-foreground transition-colors">Getting Started</Link>
            <Link to="/terms" className="hover:text-foreground transition-colors">Terms</Link>
            <Link to="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
            <Link to="/refund" className="hover:text-foreground transition-colors">Refunds</Link>
          </div>
        </div>
      </footer>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Accordion                                                          */
/* ------------------------------------------------------------------ */

// Native <details>/<summary> so the answer body is in the rendered
// DOM regardless of open state — required for search engines and
// accessibility tools to read the content without executing JS.
const Accordion = ({ q, a }: { q: string; a: React.ReactNode }) => (
  <details className="border-b border-border/60 last:border-0 group">
    <summary className="list-none w-full flex items-center justify-between gap-4 py-4 text-left cursor-pointer">
      <span className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
        {q}
      </span>
      <span className="shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-45">
        +
      </span>
    </summary>
    <div className="pb-4 text-sm text-foreground/80 leading-relaxed pl-0.5">
      {a}
    </div>
  </details>
);

export default Faq;
