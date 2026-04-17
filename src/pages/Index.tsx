import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  ArrowRight,
  Route,
  MapPinned,
  Globe,
  Mountain,
  Users,
  Check,
  Radio,
  Sparkles,
} from 'lucide-react';
import { PAYWALL_LIMITS } from '@/hooks/usePaywall';

// Hero map is a pre-baked PNG in /public so the landing page has zero
// runtime dependency on the Mapbox Static Images API — no token
// referrer issues, no extra request on first paint, no broken-image
// state when Mapbox hiccups. Regenerate it by re-running the helper
// script if you want to change the route or markers.
const heroMapUrl = '/hero-map1.png';

// ─── Features ────────────────────────────────────────────────────────
// Each card gets an accent tone so the grid mixes the logo's blue and
// orange rather than being a wall of identical icons. `pro` marks
// features that require the Pro tier.
const features = [
  {
    icon: Route,
    title: 'Multi-route courses',
    description:
      'Build 5K, 10K, and half marathon routes in the same event. Snap to roads or draw freehand — your call.',
    tone: 'brand' as const,
  },
  {
    icon: MapPinned,
    title: 'Points of interest',
    description:
      'Drop water stations, parking, aid stations, and start/finish lines in a click. They cluster when zoomed out so your map stays clean.',
    tone: 'brand' as const,
  },
  {
    icon: Users,
    title: 'Runner & spectator views',
    description:
      'Participants get a course map to follow. Spectators get the full overview to find the action. Same link, two modes.',
    tone: 'brand' as const,
  },
  {
    icon: Mountain,
    title: 'Elevation & weather',
    description:
      'Elevation profiles show every climb and descent. Weather forecasts appear automatically as race day approaches.',
    tone: 'brand' as const,
  },
  {
    icon: Globe,
    title: 'Instant public pages',
    description:
      'One click publishes a polished, shareable map page. Add your event logo so it looks like yours, not ours.',
    tone: 'brand' as const,
  },
  {
    icon: Radio,
    title: 'Live GPS tracking',
    description:
      'Runners share their location in real time. Spectators watch moving dots on the map — no app download required.',
    tone: 'brand' as const,
    pro: true,
  },
];

// Both plans share the same signup flow — you start free and unlock
// Pro per event at publish time. This is intentional: the landing
// page should never ask a visitor to pick a plan before they've
// built the thing they're paying for.
const plans = [
  {
    name: 'Free',
    price: '$0',
    priceSuffix: 'forever',
    description: 'Everything you need for a typical small race.',
    cta: 'Start for free',
    ctaVariant: 'outline' as const,
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
    cta: 'Start for free',
    ctaVariant: 'default' as const,
    highlight: true,
    features: [
      'Everything in Free',
      'Unlimited routes per event',
      'Unlimited points of interest',
      'Live GPS tracking for runners',
      'Custom logo & banner branding',
      'Remove Hereday watermark',
    ],
  },
];

const useCases = [
  { emoji: '🏃', label: '5K & 10K Races' },
  { emoji: '🏅', label: 'Half & Full Marathons' },
  { emoji: '🚴', label: 'Cycling Events' },
  { emoji: '🌆', label: 'City Fun Runs' },
  { emoji: '🦃', label: 'Turkey Trots' },
  { emoji: '🎉', label: 'Community Events' },
];

const steps = [
  {
    number: '01',
    title: 'Name it',
    description:
      "Type your event name on the dashboard and hit Enter. You're in the editor in under 10 seconds.",
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
      'Hit publish and share one link. Runners get turn-by-turn views, spectators get the overview — same page, two modes.',
  },
];

// ─── Tone helpers ─────────────────────────────────────────────────────
// Centralizing the tone classes keeps the feature grid readable and
// makes it trivial to swap palettes later.
const toneClasses: Record<'primary' | 'brand', { bg: string; text: string }> = {
  primary: { bg: 'bg-primary/10', text: 'text-primary' },
  brand: { bg: 'bg-brand/10', text: 'text-brand' },
};

const Index = () => {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* ─── Nav ──────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b border-border/60 bg-card/75 backdrop-blur-xl">
        <div className="container mx-auto flex items-center justify-between py-3 px-4">
          <Link to="/" className="flex items-center" aria-label="Hereday home">
            <img src="/hereday-logo.png" alt="Hereday" className="h-14 w-auto -my-2" />
          </Link>
          <nav className="hidden md:flex items-center gap-1">
            <a
              href="#features"
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5"
            >
              Features
            </a>
            <a
              href="#how-it-works"
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5"
            >
              How it works
            </a>
            <a
              href="#pricing"
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5"
            >
              Pricing
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/login">Sign in</Link>
            </Button>
            <Button size="sm" asChild>
              <Link to="/signup">
                Start for free <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* ─── Hero ─────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        {/* Decorative background glows */}
        <div className="absolute inset-0 -z-10 pointer-events-none">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[500px] bg-gradient-to-br from-primary/10 via-transparent to-brand/10 blur-3xl rounded-full" />
          <div className="absolute top-40 right-10 w-72 h-72 bg-brand/5 blur-3xl rounded-full" />
        </div>

        <div className="container mx-auto px-4 pt-20 pb-16 text-center">
          <div className="inline-flex items-center gap-2 bg-brand/10 text-brand text-xs font-semibold rounded-full px-3 py-1.5 mb-6 ring-1 ring-brand/20">
            <Sparkles className="h-3 w-3" />
            Built for race organizers
          </div>

          <h1 className="text-4xl sm:text-6xl font-display font-bold leading-[1.05] tracking-tight max-w-3xl mx-auto">
            Type a name.
            <br />
            Draw a route.
            <br />
            <span className="text-primary">Share a link.</span>
          </h1>

          <p className="mt-6 text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed">
            Hereday is the fastest way for race organizers to turn a course into a polished,
            shareable map page — the kind runners and spectators actually use on race day.
          </p>

          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button size="lg" asChild className="rounded-full px-8 shadow-lg shadow-primary/20">
              <Link to="/signup">
                Start for free <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button size="lg" variant="ghost" asChild className="rounded-full px-6">
              <a href="#how-it-works">See how it works</a>
            </Button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            No credit card required · Publish your first event in under 5 minutes
          </p>

          {/* Hero map preview */}
          <div className="mt-14 relative mx-auto max-w-5xl">
            <div className="rounded-2xl overflow-hidden border border-border shadow-2xl shadow-primary/10 bg-card">
              {/* Browser chrome */}
              <div className="bg-muted/70 border-b border-border px-4 py-3 flex items-center gap-2">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-[#ff5f57]" />
                  <div className="w-3 h-3 rounded-full bg-[#febc2e]" />
                  <div className="w-3 h-3 rounded-full bg-[#28c840]" />
                </div>
                <div className="flex-1 mx-4 bg-background/80 rounded-md px-3 py-1 text-xs text-muted-foreground text-left flex items-center gap-1.5">
                  <Globe className="h-3 w-3 shrink-0" />
                  hereday.io/event/crystal-lake-5k
                </div>
              </div>
              {/* Map image */}
              <div className="relative">
                <img
                  src={heroMapUrl}
                  alt="Example Hereday event map showing a 5K loop around Crystal Lake with start, water stop, sponsor, and finish markers"
                  className="w-full object-cover"
                  style={{ maxHeight: '460px' }}
                  loading="eager"
                />
                {/* Floating stat pill overlay */}
                <div className="absolute bottom-4 left-4 flex items-center gap-2 bg-card/95 backdrop-blur-md rounded-full px-3 py-1.5 text-xs font-medium shadow-lg ring-1 ring-black/5">
                  <div className="w-2 h-2 rounded-full bg-primary" />
                  <span className="text-foreground">Crystal Lake 5K</span>
                  <span className="text-muted-foreground">· 3.1 mi · +82 ft</span>
                </div>
              </div>
            </div>
            <div className="absolute -inset-6 bg-gradient-to-br from-primary/10 via-brand/5 to-transparent rounded-[2rem] blur-3xl -z-10" />
          </div>
        </div>
      </section>

      {/* ─── Use cases ───────────────────────────────────────── */}
      <section className="container mx-auto px-4 py-14">
        <p className="text-center text-xs uppercase tracking-widest text-muted-foreground font-semibold mb-6">
          Built for every kind of event
        </p>
        <div className="flex flex-wrap justify-center gap-2.5">
          {useCases.map(({ emoji, label }) => (
            <div
              key={label}
              className="flex items-center gap-2 bg-card border border-border rounded-full px-4 py-2 text-sm font-medium text-foreground hover:border-brand/40 transition-colors"
            >
              <span>{emoji}</span>
              {label}
            </div>
          ))}
        </div>
      </section>

      {/* ─── How it works ────────────────────────────────────── */}
      <section id="how-it-works" className="bg-secondary/40 border-y border-border py-20">
        <div className="container mx-auto px-4">
          <div className="text-center mb-14">
            <p className="text-xs uppercase tracking-widest text-primary font-bold mb-2">How it works</p>
            <h2 className="text-3xl sm:text-4xl font-display font-bold">From idea to shareable map in minutes</h2>
          </div>
          <div className="grid sm:grid-cols-3 gap-8 max-w-4xl mx-auto relative">
            {/* Connecting line on desktop */}
            <div
              className="hidden sm:block absolute top-8 left-[16.66%] right-[16.66%] h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent pointer-events-none"
              aria-hidden
            />
            {steps.map((step) => (
              <div key={step.number} className="relative text-center space-y-3">
                <div className="relative mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 ring-1 ring-primary/20 flex items-center justify-center">
                  <span className="text-xl font-display font-bold text-primary">{step.number}</span>
                </div>
                <h3 className="font-semibold text-foreground text-lg" style={{ fontFamily: 'var(--font-display)' }}>
                  {step.title}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-xs mx-auto">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Features ────────────────────────────────────────── */}
      <section id="features" className="container mx-auto px-4 py-20">
        <div className="text-center mb-14">
          <p className="text-xs uppercase tracking-widest text-primary font-bold mb-2">Features</p>
          <h2 className="text-3xl sm:text-4xl font-display font-bold">Everything you need, nothing you don't</h2>
          <p className="text-muted-foreground mt-3 max-w-xl mx-auto">
            Purpose-built for event organizers, not GIS experts. Every feature earns its place on the page.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 max-w-5xl mx-auto">
          {features.map(({ icon: Icon, title, description, tone, pro }) => {
            const classes = toneClasses[tone];
            return (
              <div
                key={title}
                className="relative bg-card border border-border rounded-2xl p-6 space-y-3 hover:border-brand/30 hover:shadow-lg hover:shadow-brand/5 transition-all"
              >
                {pro && (
                  <span className="absolute top-4 right-4 text-[9px] font-bold uppercase tracking-wider bg-primary/10 text-primary rounded-full px-2 py-0.5 ring-1 ring-primary/20">
                    Pro
                  </span>
                )}
                <div className={`h-11 w-11 rounded-xl ${classes.bg} flex items-center justify-center`}>
                  <Icon className={`h-5 w-5 ${classes.text}`} />
                </div>
                <h3 className="font-semibold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
                  {title}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* ─── Pricing ─────────────────────────────────────────── */}
      <section id="pricing" className="bg-secondary/40 border-y border-border py-20">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <p className="text-xs uppercase tracking-widest text-primary font-bold mb-2">Pricing</p>
            <h2 className="text-3xl sm:text-4xl font-display font-bold">Simple, honest pricing</h2>
            <p className="text-muted-foreground mt-3">
              Start free. Upgrade per event when you're ready to go big.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 gap-6 max-w-3xl mx-auto">
            {plans.map((plan) => (
              <div
                key={plan.name}
                className={`relative rounded-2xl border p-8 flex flex-col ${
                  plan.highlight
                    ? 'border-primary bg-card shadow-xl shadow-primary/10'
                    : 'border-border bg-card'
                }`}
              >
                {plan.highlight && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-[10px] font-bold uppercase tracking-wider rounded-full px-3 py-1">
                    Most popular
                  </div>
                )}
                <div className="mb-6">
                  <h3 className="font-display font-bold text-xl text-foreground">{plan.name}</h3>
                  <div className="mt-2 flex items-baseline gap-1.5">
                    <span className="text-4xl font-display font-bold text-foreground">{plan.price}</span>
                    <span className="text-sm text-muted-foreground">{plan.priceSuffix}</span>
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{plan.description}</p>
                </div>
                <ul className="space-y-2.5 mb-8 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-sm text-foreground">
                      <Check
                        className={`h-4 w-4 shrink-0 mt-0.5 ${
                          plan.highlight ? 'text-brand' : 'text-muted-foreground'
                        }`}
                      />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Button size="lg" variant={plan.ctaVariant} asChild className="w-full rounded-full">
                  <Link to="/signup">{plan.cta}</Link>
                </Button>
              </div>
            ))}
          </div>
          <p className="text-center text-xs text-muted-foreground mt-8">
            Start free, pay only when you're ready to publish · No subscription, ever · Questions?{' '}
            <a href="mailto:hello@hereday.io" className="underline hover:text-foreground">
              hello@hereday.io
            </a>
          </p>
        </div>
      </section>

      {/* ─── Bottom CTA ──────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-primary text-primary-foreground py-20">
        <div className="absolute inset-0 pointer-events-none opacity-30">
          <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-brand/40 blur-3xl rounded-full" />
        </div>
        <div className="container mx-auto px-4 text-center space-y-6 relative">
          <h2 className="text-3xl sm:text-4xl font-display font-bold">Ready to map your next event?</h2>
          <p className="text-primary-foreground/80 max-w-md mx-auto">
            Create a professional, shareable event map in minutes. No design skills required.
          </p>
          <Button size="lg" variant="secondary" asChild className="rounded-full px-10">
            <Link to="/signup">
              Start for free <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </section>

      {/* ─── Footer ──────────────────────────────────────────── */}
      <footer className="border-t border-border bg-card py-10">
        <div className="container mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <img src="/hereday-logo.png" alt="Hereday" className="h-12 w-auto opacity-70" />
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} Hereday. Made for race organizers.
          </p>
          <div className="flex gap-4 text-xs text-muted-foreground">
            <Link to="/getting-started" className="hover:text-foreground transition-colors">
              Getting Started
            </Link>
            <Link to="/terms" className="hover:text-foreground transition-colors">
              Terms
            </Link>
            <Link to="/privacy" className="hover:text-foreground transition-colors">
              Privacy
            </Link>
            <Link to="/refund" className="hover:text-foreground transition-colors">
              Refunds
            </Link>
            <a href="mailto:hello@hereday.io" className="hover:text-foreground transition-colors">
              Contact
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Index;
