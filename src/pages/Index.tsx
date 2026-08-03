import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Route,
  MapPinned,
  Globe,
  Mountain,
  Users,
  Check,
  Palette,
  Lock,
  ChevronDown,
} from 'lucide-react';
import { PAYWALL_LIMITS } from '@/hooks/usePaywall';
import { useAuth } from '@/hooks/useAuth';
import { useSeoMeta } from '@/hooks/useSeoMeta';
import { JsonLd } from '@/components/JsonLd';

// Hero map is a pre-baked PNG in /public so the landing page has zero
// runtime dependency on the Mapbox Static Images API — no token
// referrer issues, no extra request on first paint, no broken-image
// state when Mapbox hiccups. Regenerate it by re-running the helper
// script if you want to change the route or markers.
const heroMapUrl = '/hero-map1.png';

// ─── Features ────────────────────────────────────────────────────────
// Editorial palette alternates: every 3n+2 card flips icon tile to the
// primary blue tone instead of brand orange so the grid feels like a
// rhythm rather than a wall of identical icons. `pro` flags features
// that are gated behind the Pro tier.
const features = [
  {
    icon: Route,
    title: 'Multi-route courses',
    description:
      'Build 5K, 10K, and half marathon routes in one event. Snap to roads or draw freehand — your call.',
  },
  {
    icon: MapPinned,
    title: 'Points of interest',
    description:
      'Drop water stations, parking, aid, and start/finish in a click. They cluster when zoomed out so your map stays clean.',
  },
  {
    icon: Users,
    title: 'Runner & spectator views',
    description:
      'Participants get a course map to follow. Spectators get the overview to find the action. Same link, two modes.',
  },
  {
    icon: Mountain,
    title: 'Elevation & weather',
    description:
      'Profiles show every climb. Forecasts appear automatically as event day approaches.',
  },
  {
    icon: Globe,
    title: 'Instant public pages',
    description:
      "One click publishes a polished, shareable map page. Drop in your logo — it looks like yours, not ours.",
  },
  {
    icon: Palette,
    title: 'Custom branding',
    description:
      'Your logo, your colors, your event. Add a banner and logo so the public page looks like yours — not ours.',
    pro: true,
  },
];

// Both plans share the same signup flow — you start free and unlock
// Pro per event at publish time. This is intentional: the landing
// page should never ask a visitor to pick a plan before they've
// built the thing they're paying for.
//
// PRO COPY IS LOAD-BEARING: the 8-item list below mirrors the live
// Faq.tsx copy and the Billing flow. Keep these strings verbatim.
const plans = [
  {
    name: 'Free',
    price: '$0',
    priceSuffix: 'forever',
    description: 'Everything you need for a typical small event.',
    cta: 'Start for free',
    highlight: false,
    features: [
      'Unlimited events',
      `Up to ${PAYWALL_LIMITS.routes} routes per event`,
      `Up to ${PAYWALL_LIMITS.pois} points of interest`,
      'Runner & spectator views',
      'Elevation profiles & weather',
      'Public share links',
    ],
  },
  {
    name: 'Pro',
    price: '$49',
    priceSuffix: 'per event',
    description: 'Pay when you publish — only for the events you actually run.',
    cta: 'Try Pro — pay at publish',
    highlight: true,
    features: [
      'Everything in Free',
      'Unlimited routes & points of interest',
      'Custom logo & banner branding',
      'Live volunteer status reporting',
      'Event Ops Center for race-day ops',
      'All branded sponsors on the map',
      'Remove Hereday watermark',
    ],
  },
];

const useCases = [
  '5K & 10K races',
  'Half & full marathons',
  'Cycling events',
  'City fun runs',
  'Turkey trots',
  'Charity walks',
  'Community festivals',
];

const steps = [
  {
    number: '01',
    title: 'Name it',
    description:
      "Type an event name and hit Enter. You're in the editor in under 10 seconds.",
  },
  {
    number: '02',
    title: 'Draw the course',
    description:
      'Click to place waypoints — they snap to roads automatically. Drop water stations and markers along the way.',
  },
  {
    number: '03',
    title: 'Publish & share',
    description:
      'Hit publish, share one link. Runners get the course. Spectators get the overview. Same page, two modes.',
  },
];

// FAQ content distilled from src/pages/Faq.tsx so the landing page
// stays in sync with the source-of-truth answers used on /faq.
const faqs = [
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

const Index = () => {
  // The marketing landing is for anonymous visitors. If a logged-in
  // user lands here — typically by hitting browser Back from another
  // public page like /getting-started — silently route them to their
  // dashboard so they don't see the unauthenticated nav and assume
  // their session was lost.
  const navigate = useNavigate();
  const { session, loading } = useAuth();
  useEffect(() => {
    if (!loading && session) {
      navigate('/dashboard', { replace: true });
    }
  }, [loading, session, navigate]);

  useSeoMeta({
    title: 'Hereday — Event Map Maker for Race Directors & Organizers',
    description:
      'Build a shareable event map for your race in minutes. Multi-route courses, water stations, elevation profiles, and a printable race-day checklist. Free to start.',
    canonicalPath: '/',
  });

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
      { '@type': 'Offer', name: 'Pro', price: '49', priceCurrency: 'USD', description: 'Per event, one-time' },
    ],
  };

  const homepageFaqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };

  return (
    <div
      className="editorial-theme min-h-screen flex flex-col"
      style={{
        background: 'var(--ed-bg)',
        color: 'var(--ed-ink)',
        fontFamily: "'DM Sans', ui-sans-serif, system-ui, sans-serif",
      }}
    >
      <JsonLd data={organizationSchema} />
      <JsonLd data={softwareSchema} />
      <JsonLd data={homepageFaqSchema} />

      {/* ─── Nav (sticky) ─────────────────────────────────────── */}
      <header
        className="sticky top-0 z-50 backdrop-blur-xl"
        style={{
          background: 'rgba(250, 250, 247, 0.8)',
          borderBottom: '1px solid var(--ed-line)',
        }}
      >
        <div className="container mx-auto flex items-center justify-between py-3.5 px-4">
          <Link to="/" className="flex items-center" aria-label="Hereday home">
            <img src="/hereday-logo.png" alt="Hereday" className="h-14 w-auto -my-2" />
          </Link>
          <nav className="hidden md:flex items-center gap-1">
            {[
              { href: '#features', label: 'Features' },
              { href: '#how-it-works', label: 'How it works' },
              { href: '#pricing', label: 'Pricing' },
              { href: '#faq', label: 'FAQ' },
            ].map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="text-sm font-medium px-3.5 py-2 transition-colors"
                style={{ color: 'var(--ed-muted)' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--ed-ink)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ed-muted)')}
              >
                {item.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Link
              to="/login"
              className="hidden sm:inline-flex text-sm font-semibold px-3.5 py-2.5 rounded-[4px] transition-colors"
              style={{ color: 'var(--ed-muted)' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--ed-ink)';
                e.currentTarget.style.background = 'var(--ed-line-2)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--ed-muted)';
                e.currentTarget.style.background = 'transparent';
              }}
            >
              Sign in
            </Link>
            <Link
              to="/signup"
              className="ed-btn-primary inline-flex items-center gap-2 text-sm font-semibold px-5 py-2.5 rounded-[4px] text-white"
              style={{ background: 'var(--ed-primary)', letterSpacing: '-0.01em' }}
            >
              Start for free <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* ─── Hero ─────────────────────────────────────────────── */}
      <section className="relative overflow-hidden" style={{ padding: '120px 0 60px' }}>
        {/* Decorative topographic background */}
        <div
          className="ed-topo absolute inset-0 pointer-events-none"
          aria-hidden
          style={{
            zIndex: 0,
            opacity: 0.55,
            backgroundImage:
              'radial-gradient(ellipse at 20% 30%, color-mix(in srgb, var(--ed-primary) 12%, transparent), transparent 50%), radial-gradient(ellipse at 85% 40%, color-mix(in srgb, var(--ed-brand) 14%, transparent), transparent 55%)',
          }}
        >
          <svg
            className="absolute inset-0 w-full h-full"
            viewBox="0 0 1200 700"
            preserveAspectRatio="none"
          >
            {Array.from({ length: 12 }).map((_, i) => (
              <path
                key={i}
                d={`M -50 ${120 + i * 50} Q 300 ${80 + i * 45} 600 ${140 + i * 48} T 1250 ${120 + i * 52}`}
              />
            ))}
          </svg>
        </div>

        <div className="container mx-auto px-4 text-center relative" style={{ zIndex: 1 }}>
          {/* Badge */}
          <div
            className="inline-flex items-center gap-2 rounded-full text-xs font-semibold"
            style={{
              padding: '6px 14px 6px 8px',
              background: 'var(--ed-card)',
              border: '1px solid var(--ed-line)',
              color: 'var(--ed-ink-2)',
              boxShadow: 'var(--ed-shadow-sm)',
              letterSpacing: '-0.01em',
            }}
          >
            <span
              className="relative flex items-center justify-center"
              style={{ width: 16, height: 16, borderRadius: '50%', background: 'var(--ed-brand)' }}
            >
              <span
                className="ed-pulse-ring absolute"
                style={{
                  inset: -4,
                  borderRadius: '50%',
                  border: '2px solid var(--ed-brand)',
                  opacity: 0.5,
                }}
              />
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />
            </span>
            Built for event organizers
          </div>

          {/* Headline */}
          <h1
            className="ed-hero-h1 font-editorial mx-auto"
            style={{
              fontSize: 'clamp(44px, 6.5vw, 84px)',
              lineHeight: 0.98,
              letterSpacing: '-0.04em',
              fontWeight: 500,
              maxWidth: 900,
              marginTop: 24,
            }}
          >
            <span className="sr-only">Event Map Maker for Race Organizers — </span>
            <span aria-hidden="true">Type a name.</span>
            <br />
            <span aria-hidden="true">Draw a route.</span>
            <br />
            <span
              className="font-editorial italic"
              style={{ color: 'var(--ed-primary)', fontWeight: 400 }}
              aria-hidden="true"
            >
              Share a link.
            </span>
          </h1>

          {/* Subhead */}
          <p
            className="mx-auto"
            style={{
              marginTop: 22,
              fontSize: 19,
              color: 'var(--ed-muted)',
              maxWidth: 580,
              lineHeight: 1.55,
              textWrap: 'pretty' as React.CSSProperties['textWrap'],
            }}
          >
            Hereday turns your course into a polished, shareable page — the kind participants and
            spectators actually use on event day. Running, cycling, charity walks, community
            festivals.
          </p>

          {/* CTAs */}
          <div className="flex flex-wrap justify-center" style={{ gap: 12, marginTop: 32 }}>
            <Link
              to="/signup"
              className="ed-btn-primary inline-flex items-center gap-2 text-white font-semibold rounded-[4px]"
              style={{
                background: 'var(--ed-primary)',
                padding: '14px 26px',
                fontSize: 15,
                letterSpacing: '-0.01em',
              }}
            >
              Start for free <ArrowRight className="h-4 w-4" />
            </Link>
            <a
              href="#how-it-works"
              className="inline-flex items-center gap-2 font-semibold rounded-[4px] transition-transform hover:-translate-y-px"
              style={{
                background: 'var(--ed-card)',
                color: 'var(--ed-ink)',
                border: '1px solid var(--ed-line)',
                padding: '14px 26px',
                fontSize: 15,
                letterSpacing: '-0.01em',
              }}
            >
              See how it works
            </a>
          </div>

          {/* Trust foot */}
          <div
            className="flex flex-wrap justify-center items-center"
            style={{ marginTop: 18, gap: 14, fontSize: 13, color: 'var(--ed-muted)' }}
          >
            {['No credit card', 'Live in 5 minutes', 'Refund if event cancels'].map((item) => (
              <span key={item} className="inline-flex items-center" style={{ gap: 6 }}>
                <Check className="h-3.5 w-3.5" style={{ color: 'var(--ed-success)' }} />
                {item}
              </span>
            ))}
          </div>

          {/* Hero static image frame */}
          <div
            className="ed-hero-glow relative mx-auto"
            style={{ marginTop: 56, maxWidth: 1080 }}
          >
            <div
              className="overflow-hidden"
              style={{
                background: 'var(--ed-card)',
                border: '1px solid var(--ed-line)',
                borderRadius: 6,
                boxShadow: 'var(--ed-shadow-xl)',
              }}
            >
              {/* Browser bar */}
              <div
                className="flex items-center"
                style={{
                  gap: 14,
                  padding: '14px 18px',
                  background: 'var(--ed-line-2)',
                  borderBottom: '1px solid var(--ed-line)',
                }}
              >
                <div className="flex" style={{ gap: 7 }}>
                  <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#FF5F57' }} />
                  <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#FEBC2E' }} />
                  <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#28C840' }} />
                </div>
                <div
                  className="flex-1 flex items-center text-left"
                  style={{
                    background: 'var(--ed-card)',
                    border: '1px solid var(--ed-line)',
                    borderRadius: 8,
                    padding: '6px 14px',
                    fontSize: 12,
                    fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
                    color: 'var(--ed-muted)',
                    gap: 8,
                  }}
                >
                  <Lock className="h-3 w-3 shrink-0" style={{ color: 'var(--ed-success)' }} />
                  hereday.io/crystal-lake-5k
                </div>
              </div>
              {/* Hero map */}
              <img
                src={heroMapUrl}
                alt="Example Hereday event map showing a 5K loop around Crystal Lake with start, water stop, sponsor, and finish markers"
                className="block w-full h-auto"
                loading="eager"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ─── Use Cases ───────────────────────────────────────── */}
      <section style={{ padding: '56px 0' }}>
        <div className="container mx-auto px-4">
          <p
            className="text-center uppercase font-bold"
            style={{
              fontSize: 11,
              letterSpacing: '0.15em',
              color: 'var(--ed-muted-2)',
              marginBottom: 22,
            }}
          >
            Built for every kind of event
          </p>
          <div className="flex flex-wrap justify-center" style={{ gap: 10 }}>
            {useCases.map((label) => (
              <span
                key={label}
                className="inline-flex items-center transition-all"
                style={{
                  padding: '9px 16px',
                  borderRadius: 4,
                  background: 'var(--ed-card)',
                  border: '1px solid var(--ed-line)',
                  fontSize: 14,
                  fontWeight: 500,
                  color: 'var(--ed-ink-2)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--ed-brand)';
                  e.currentTarget.style.color = 'var(--ed-brand)';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--ed-line)';
                  e.currentTarget.style.color = 'var(--ed-ink-2)';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                {label}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ─── How It Works ────────────────────────────────────── */}
      <section id="how-it-works" style={{ padding: '100px 0' }}>
        <div className="container mx-auto px-4">
          <div className="text-center" style={{ marginBottom: 56 }}>
            <p
              className="uppercase font-bold"
              style={{
                fontSize: 12,
                letterSpacing: '0.2em',
                color: 'var(--ed-ink)',
                marginBottom: 12,
              }}
            >
              How it works
            </p>
            <h2
              className="font-editorial italic mx-auto"
              style={{
                fontSize: 'clamp(32px, 4vw, 46px)',
                lineHeight: 1.05,
                letterSpacing: '-0.04em',
                fontWeight: 400,
                maxWidth: 700,
              }}
            >
              From idea to shareable map in minutes.
            </h2>
          </div>
          <div className="grid sm:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {steps.map((step) => (
              <div
                key={step.number}
                className="transition-all"
                style={{
                  background: 'var(--ed-card)',
                  border: '1px solid var(--ed-line)',
                  borderRadius: 6,
                  padding: 32,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-4px)';
                  e.currentTarget.style.boxShadow = 'var(--ed-shadow-md)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                <div
                  className="inline-flex items-center"
                  style={{
                    gap: 10,
                    fontFamily: 'Fraunces, Georgia, serif',
                    fontSize: 12,
                    fontWeight: 700,
                    color: 'var(--ed-brand)',
                    letterSpacing: '0.1em',
                  }}
                >
                  <span
                    className="inline-flex items-center justify-center"
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 10,
                      background: 'var(--ed-brand-50)',
                      color: 'var(--ed-brand)',
                      fontSize: 18,
                      fontWeight: 700,
                      fontFamily: 'Fraunces, Georgia, serif',
                    }}
                  >
                    {step.number.slice(-1)}
                  </span>
                  STEP {step.number}
                </div>
                <h3
                  className="font-editorial"
                  style={{
                    fontSize: 22,
                    marginTop: 18,
                    letterSpacing: '-0.02em',
                    fontWeight: 600,
                  }}
                >
                  {step.title}
                </h3>
                <p
                  style={{
                    marginTop: 10,
                    color: 'var(--ed-muted)',
                    fontSize: 15,
                    lineHeight: 1.55,
                  }}
                >
                  {step.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Features ────────────────────────────────────────── */}
      <section
        id="features"
        style={{
          padding: '100px 0',
          background: 'var(--ed-card)',
          borderTop: '1px solid var(--ed-line)',
          borderBottom: '1px solid var(--ed-line)',
        }}
      >
        <div className="container mx-auto px-4">
          <div className="text-center" style={{ marginBottom: 56 }}>
            <p
              className="uppercase font-bold"
              style={{
                fontSize: 12,
                letterSpacing: '0.2em',
                color: 'var(--ed-ink)',
                marginBottom: 12,
              }}
            >
              Features
            </p>
            <h2
              className="font-editorial italic mx-auto"
              style={{
                fontSize: 'clamp(32px, 4vw, 46px)',
                lineHeight: 1.05,
                letterSpacing: '-0.04em',
                fontWeight: 400,
                maxWidth: 700,
              }}
            >
              Everything you need, nothing you don't.
            </h2>
            <p
              className="mx-auto"
              style={{
                marginTop: 14,
                color: 'var(--ed-muted)',
                maxWidth: 560,
                fontSize: 17,
                lineHeight: 1.5,
              }}
            >
              Purpose-built for event organizers, not GIS experts. Every feature earns its place.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 max-w-6xl mx-auto">
            {features.map(({ icon: Icon, title, description, pro }, i) => {
              // Editorial palette — alternate icon tile color so the grid
              // mixes brand orange with primary blue rather than reading
              // as one color.
              const useBlue = i % 3 === 1;
              return (
                <div
                  key={title}
                  className="ed-feature relative transition-all"
                  style={{
                    padding: 28,
                    borderRadius: 20,
                    border: '1px dashed var(--ed-line)',
                    background: 'var(--ed-bg)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    e.currentTarget.style.boxShadow = 'var(--ed-shadow-md)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  {pro && (
                    <span
                      className="absolute uppercase font-bold"
                      style={{
                        top: 20,
                        right: 20,
                        fontSize: 10,
                        letterSpacing: '0.1em',
                        color: 'var(--ed-primary)',
                        background: 'var(--ed-primary-50)',
                        padding: '3px 8px',
                        borderRadius: 4,
                      }}
                    >
                      PRO
                    </span>
                  )}
                  <div
                    className="flex items-center justify-center"
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 12,
                      marginBottom: 18,
                      background: useBlue ? 'var(--ed-primary-50)' : 'var(--ed-brand-50)',
                      color: useBlue ? 'var(--ed-primary)' : 'var(--ed-brand)',
                    }}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3
                    className="font-editorial"
                    style={{ fontSize: 18, letterSpacing: '-0.015em', fontWeight: 600 }}
                  >
                    {title}
                  </h3>
                  <p
                    style={{
                      color: 'var(--ed-muted)',
                      fontSize: 14.5,
                      lineHeight: 1.55,
                      marginTop: 8,
                    }}
                  >
                    {description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─── Pricing ─────────────────────────────────────────── */}
      <section id="pricing" style={{ padding: '100px 0' }}>
        <div className="container mx-auto px-4">
          <div className="text-center" style={{ marginBottom: 56 }}>
            <p
              className="uppercase font-bold"
              style={{
                fontSize: 12,
                letterSpacing: '0.2em',
                color: 'var(--ed-ink)',
                marginBottom: 12,
              }}
            >
              Pricing
            </p>
            <h2
              className="font-editorial italic mx-auto"
              style={{
                fontSize: 'clamp(32px, 4vw, 46px)',
                lineHeight: 1.05,
                letterSpacing: '-0.04em',
                fontWeight: 400,
                maxWidth: 700,
              }}
            >
              Simple, honest, per-event.
            </h2>
            <p
              className="mx-auto"
              style={{
                marginTop: 14,
                color: 'var(--ed-muted)',
                maxWidth: 560,
                fontSize: 17,
                lineHeight: 1.5,
              }}
            >
              Start free. Upgrade only when you're ready to publish.
            </p>
          </div>
          <div
            className="grid sm:grid-cols-2 mx-auto"
            style={{ gap: 20, maxWidth: 860 }}
          >
            {plans.map((plan) => (
              <div
                key={plan.name}
                className="relative flex flex-col"
                style={{
                  padding: 36,
                  borderRadius: 10,
                  background: 'var(--ed-card)',
                  border: plan.highlight
                    ? '2px solid var(--ed-primary)'
                    : '1px solid var(--ed-line)',
                  boxShadow: plan.highlight ? 'var(--ed-shadow-lg)' : 'none',
                }}
              >
                {plan.highlight && (
                  <span
                    className="absolute uppercase font-bold text-white"
                    style={{
                      top: -12,
                      left: 36,
                      background: 'var(--ed-primary)',
                      padding: '5px 12px',
                      borderRadius: 999,
                      fontSize: 11,
                      letterSpacing: '0.08em',
                    }}
                  >
                    Best for event day
                  </span>
                )}
                <span
                  className="uppercase font-bold"
                  style={{
                    fontSize: 13,
                    letterSpacing: '0.1em',
                    color: 'var(--ed-muted)',
                  }}
                >
                  {plan.name}
                </span>
                <div
                  className="flex items-baseline"
                  style={{ marginTop: 14, gap: 8 }}
                >
                  <span
                    className="font-editorial"
                    style={{
                      fontSize: 56,
                      fontWeight: 500,
                      letterSpacing: '-0.04em',
                      color: 'var(--ed-ink)',
                      lineHeight: 1,
                    }}
                  >
                    {plan.price}
                  </span>
                  <span style={{ fontSize: 14, color: 'var(--ed-muted)' }}>
                    {plan.priceSuffix}
                  </span>
                </div>
                <p
                  style={{
                    marginTop: 14,
                    color: 'var(--ed-muted)',
                    fontSize: 15,
                    lineHeight: 1.55,
                  }}
                >
                  {plan.description}
                </p>
                <ul
                  className="flex-1"
                  style={{ listStyle: 'none', padding: 0, margin: '28px 0' }}
                >
                  {plan.features.map((f) => (
                    <li
                      key={f}
                      className="flex items-start"
                      style={{
                        gap: 10,
                        padding: '7px 0',
                        fontSize: 14.5,
                        color: 'var(--ed-ink-2)',
                      }}
                    >
                      <Check
                        className="h-4 w-4 shrink-0"
                        style={{
                          marginTop: 3,
                          color: plan.highlight ? 'var(--ed-brand)' : 'var(--ed-success)',
                        }}
                      />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  to="/signup"
                  className={
                    plan.highlight
                      ? 'ed-btn-primary inline-flex items-center justify-center gap-2 text-white font-semibold rounded-[4px]'
                      : 'inline-flex items-center justify-center gap-2 font-semibold rounded-[4px] transition-transform hover:-translate-y-px'
                  }
                  style={{
                    padding: '14px 26px',
                    fontSize: 15,
                    letterSpacing: '-0.01em',
                    width: '100%',
                    background: plan.highlight ? 'var(--ed-primary)' : 'var(--ed-card)',
                    color: plan.highlight ? '#fff' : 'var(--ed-ink)',
                    border: plan.highlight ? 'none' : '1px solid var(--ed-line)',
                  }}
                >
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>
          <div
            className="text-center flex flex-wrap justify-center items-center"
            style={{ marginTop: 28, gap: 18, fontSize: 13.5, color: 'var(--ed-muted)' }}
          >
            <span
              className="inline-flex items-center font-semibold"
              style={{
                gap: 6,
                padding: '6px 12px',
                background: 'color-mix(in srgb, var(--ed-success) 10%, transparent)',
                color: 'var(--ed-success)',
                borderRadius: 999,
              }}
            >
              <Check className="h-3 w-3" />
              Refund if event cancels
            </span>
            <span>No subscription, ever.</span>
            <span>
              Questions?{' '}
              <a
                href="mailto:hello@hereday.io"
                className="underline"
                style={{ color: 'var(--ed-ink-2)' }}
              >
                hello@hereday.io
              </a>
            </span>
          </div>
        </div>
      </section>

      {/* ─── FAQ ─────────────────────────────────────────────── */}
      <section
        id="faq"
        style={{
          padding: '100px 0',
          background: 'var(--ed-card)',
          borderTop: '1px solid var(--ed-line)',
        }}
      >
        <div className="container mx-auto px-4">
          <div className="text-center" style={{ marginBottom: 56 }}>
            <p
              className="uppercase font-bold"
              style={{
                fontSize: 12,
                letterSpacing: '0.2em',
                color: 'var(--ed-ink)',
                marginBottom: 12,
              }}
            >
              FAQ
            </p>
            <h2
              className="font-editorial italic mx-auto"
              style={{
                fontSize: 'clamp(32px, 4vw, 46px)',
                lineHeight: 1.05,
                letterSpacing: '-0.04em',
                fontWeight: 400,
                maxWidth: 700,
              }}
            >
              Questions, answered.
            </h2>
          </div>
          <div
            className="mx-auto flex flex-col"
            style={{ maxWidth: 720, gap: 10 }}
          >
            {faqs.map((item, i) => (
              <details
                key={item.q}
                className="ed-faq-item"
                open={i === 0}
                style={{
                  border: '1px solid var(--ed-line)',
                  borderRadius: 6,
                  background: 'var(--ed-bg)',
                  padding: '4px 22px',
                  overflow: 'hidden',
                  transition: 'border-color 0.2s, background 0.2s',
                }}
              >
                <summary
                  className="cursor-pointer flex items-center justify-between"
                  style={{
                    padding: '18px 0',
                    fontWeight: 600,
                    fontSize: 16,
                    letterSpacing: '-0.01em',
                    color: 'var(--ed-ink)',
                  }}
                >
                  <span>{item.q}</span>
                  <span
                    className="ed-faq-plus inline-flex items-center justify-center"
                    aria-hidden
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      flexShrink: 0,
                    }}
                  >
                    <ChevronDown className="h-4 w-4" />
                  </span>
                </summary>
                <p
                  style={{
                    padding: '0 0 18px 0',
                    color: 'var(--ed-muted)',
                    fontSize: 15,
                    lineHeight: 1.6,
                    maxWidth: 620,
                  }}
                >
                  {item.a}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Final CTA ───────────────────────────────────────── */}
      <section
        className="ed-final-cta relative overflow-hidden text-center"
        style={{ padding: '120px 0', background: 'var(--ed-ink)', color: '#fff' }}
      >
        <div className="container mx-auto px-4 relative" style={{ zIndex: 1 }}>
          <h2
            className="font-editorial mx-auto"
            style={{
              fontSize: 'clamp(40px, 6vw, 72px)',
              letterSpacing: '-0.035em',
              fontWeight: 700,
              lineHeight: 1,
              maxWidth: 780,
            }}
          >
            Your next event deserves a proper map.
          </h2>
          <p
            className="mx-auto"
            style={{
              marginTop: 20,
              color: 'rgba(255, 255, 255, 0.7)',
              fontSize: 18,
              maxWidth: 520,
              lineHeight: 1.5,
            }}
          >
            Create a shareable event page in under five minutes. No credit card. No design skills
            required.
          </p>
          <Link
            to="/signup"
            className="inline-flex items-center gap-2 font-semibold rounded-[4px] transition-colors"
            style={{
              marginTop: 36,
              background: '#fff',
              color: 'var(--ed-ink)',
              padding: '16px 32px',
              fontSize: 16,
              letterSpacing: '-0.01em',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--ed-brand)';
              e.currentTarget.style.color = '#fff';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#fff';
              e.currentTarget.style.color = 'var(--ed-ink)';
            }}
          >
            Start for free <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* ─── Footer ──────────────────────────────────────────── */}
      <footer
        style={{
          padding: '48px 0',
          borderTop: '1px solid var(--ed-line)',
          background: 'var(--ed-bg)',
        }}
      >
        <div className="container mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-5">
          <Link to="/" className="flex items-center" aria-label="Hereday home">
            <img src="/hereday-logo.png" alt="Hereday" className="h-14 w-auto -my-2" />
          </Link>
          <div
            className="flex flex-wrap justify-center"
            style={{ gap: 22, fontSize: 13, color: 'var(--ed-muted)' }}
          >
            <Link
              to="/getting-started"
              className="transition-colors"
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--ed-ink)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '')}
            >
              Getting Started
            </Link>
            <Link
              to="/faq"
              className="transition-colors"
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--ed-ink)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '')}
            >
              FAQ
            </Link>
            <Link
              to="/terms"
              className="transition-colors"
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--ed-ink)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '')}
            >
              Terms
            </Link>
            <Link
              to="/privacy"
              className="transition-colors"
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--ed-ink)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '')}
            >
              Privacy
            </Link>
            <Link
              to="/refund"
              className="transition-colors"
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--ed-ink)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '')}
            >
              Refunds
            </Link>
            <a
              href="mailto:hello@hereday.io"
              className="transition-colors"
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--ed-ink)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '')}
            >
              Contact
            </a>
          </div>
          <div style={{ fontSize: 12, color: 'var(--ed-muted)' }}>
            © {new Date().getFullYear()} Hereday. Made for event organizers.
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Index;
