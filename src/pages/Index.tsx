import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowRight, Route, MapPinned, Globe, Mountain, Zap, Users, Check } from 'lucide-react';
import { PAYWALL_LIMITS } from '@/hooks/usePaywall';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string;

const staticMapUrl = `https://api.mapbox.com/styles/v1/mapbox/light-v11/static/-87.84,42.01,12.5,0/1200x680@2x?access_token=${MAPBOX_TOKEN}`;

const features = [
  {
    icon: Route,
    title: 'Multi-route courses',
    description: 'Build 5K, 10K, and half marathon routes in the same event. Snap to roads or draw freehand — your call.',
  },
  {
    icon: MapPinned,
    title: 'Points of interest',
    description: 'Drop water stations, parking, aid stations, and start/finish lines in a click. They cluster when zoomed out so your map stays clean.',
  },
  {
    icon: Users,
    title: 'Runner & spectator views',
    description: 'Participants get a course map to follow. Spectators get the full overview to find the action. Same link, two modes.',
  },
  {
    icon: Mountain,
    title: 'Elevation & weather',
    description: 'Elevation profiles show every climb and descent. Weather forecasts appear automatically as race day approaches.',
  },
  {
    icon: Globe,
    title: 'Instant public pages',
    description: 'One click publishes a polished, shareable map page. Add your event logo so it looks like yours, not ours.',
  },
  {
    icon: Zap,
    title: 'Zero learning curve',
    description: 'Type a name, click on the map, publish. Most organizers ship their first event page in under 5 minutes.',
  },
];

const plans = [
  {
    name: 'Free',
    price: '$0',
    priceSuffix: 'forever',
    description: 'Everything you need for a typical small race.',
    cta: 'Get started',
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
    price: '$29',
    priceSuffix: 'per event',
    description: 'Unlock the full toolkit when your event needs it.',
    cta: 'Start free, upgrade anytime',
    ctaVariant: 'default' as const,
    highlight: true,
    features: [
      'Everything in Free',
      'Unlimited routes per event',
      'Unlimited points of interest',
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
    description: 'Type your event name on the dashboard and hit Enter. You\'re in the editor in under 10 seconds.',
  },
  {
    number: '02',
    title: 'Draw the course',
    description: 'Click on the map to place waypoints — they snap to roads automatically. Drop water stations and POIs along the way.',
  },
  {
    number: '03',
    title: 'Publish & share',
    description: 'Hit publish and share one link. Runners get turn-by-turn views, spectators get the overview — same page, two modes.',
  },
];

const Index = () => {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Nav */}
      <header className="sticky top-0 z-50 border-b border-border bg-card/80 backdrop-blur-md">
        <div className="container mx-auto flex items-center justify-between py-3 px-4">
          <img src="/hereday-logo.png" alt="Hereday" className="h-16 w-auto -my-3" />
          <div className="flex items-center gap-2">
            <a
              href="#pricing"
              className="hidden sm:inline-block text-sm font-medium text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5"
            >
              Pricing
            </a>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/login">Sign in</Link>
            </Button>
            <Button size="sm" asChild>
              <Link to="/signup">
                Get started free <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="container mx-auto px-4 pt-20 pb-12 text-center">
        <div className="inline-flex items-center gap-2 bg-primary/10 text-primary text-xs font-semibold rounded-full px-3 py-1.5 mb-6">
          <Zap className="h-3 w-3" />
          Built for race organizers
        </div>
        <h1 className="text-4xl sm:text-6xl font-display font-bold leading-tight tracking-tight max-w-3xl mx-auto">
          Type a name.
          <br />
          Draw a route.
          <br />
          <span className="text-primary">Share a link.</span>
        </h1>
        <p className="mt-6 text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed">
          Hereday is the fastest way for race organizers to turn a course into a polished, shareable map page — the kind runners and spectators actually use on race day.
        </p>
        <div className="mt-8">
          <Button size="lg" asChild className="rounded-full px-10">
            <Link to="/signup">
              Start for free <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">No credit card required · Free tier available</p>

        {/* Map mockup */}
        <div className="mt-14 relative mx-auto max-w-5xl">
          <div className="rounded-2xl overflow-hidden border border-border shadow-2xl shadow-black/10 bg-card">
            {/* Browser chrome */}
            <div className="bg-muted border-b border-border px-4 py-3 flex items-center gap-2">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-border" />
                <div className="w-3 h-3 rounded-full bg-border" />
                <div className="w-3 h-3 rounded-full bg-border" />
              </div>
              <div className="flex-1 mx-4 bg-background rounded-md px-3 py-1 text-xs text-muted-foreground text-left">
                hereday.io/event/crystal-lake-5k
              </div>
            </div>
            {/* Map image */}
            <div className="relative">
              <img
                src={staticMapUrl}
                alt="Hereday map preview"
                className="w-full object-cover"
                style={{ maxHeight: '420px' }}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent pointer-events-none" />
            </div>
          </div>
          {/* Glow effect */}
          <div className="absolute -inset-4 bg-primary/5 rounded-3xl blur-2xl -z-10" />
        </div>
      </section>

      {/* Use cases */}
      <section className="container mx-auto px-4 py-12">
        <p className="text-center text-sm text-muted-foreground font-medium mb-6">Perfect for</p>
        <div className="flex flex-wrap justify-center gap-3">
          {useCases.map(({ emoji, label }) => (
            <div
              key={label}
              className="flex items-center gap-2 bg-secondary text-secondary-foreground rounded-full px-4 py-2 text-sm font-medium"
            >
              <span>{emoji}</span>
              {label}
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="bg-secondary/40 border-y border-border py-20">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-display font-bold">How it works</h2>
            <p className="text-muted-foreground mt-2">From idea to published map in under 5 minutes.</p>
          </div>
          <div className="grid sm:grid-cols-3 gap-8 max-w-4xl mx-auto">
            {steps.map((step) => (
              <div key={step.number} className="text-center space-y-3">
                <div className="text-4xl font-display font-bold text-primary/20">{step.number}</div>
                <h3 className="font-semibold text-foreground">{step.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="container mx-auto px-4 py-20">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-display font-bold">Everything you need</h2>
          <p className="text-muted-foreground mt-2">Purpose-built for event organizers, not GIS experts.</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {features.map(({ icon: Icon, title, description }) => (
            <div
              key={title}
              className="bg-card border border-border rounded-2xl p-6 space-y-3 hover:shadow-md transition-shadow"
            >
              <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <Icon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="font-semibold text-foreground">{title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="bg-secondary/40 border-y border-border py-20">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-display font-bold">Simple, honest pricing</h2>
            <p className="text-muted-foreground mt-2">Start free. Upgrade per event when you\'re ready to go big.</p>
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
                      <Check className={`h-4 w-4 shrink-0 mt-0.5 ${plan.highlight ? 'text-primary' : 'text-muted-foreground'}`} />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  size="lg"
                  variant={plan.ctaVariant}
                  asChild
                  className="w-full rounded-full"
                >
                  <Link to="/signup">{plan.cta}</Link>
                </Button>
              </div>
            ))}
          </div>
          <p className="text-center text-xs text-muted-foreground mt-8">
            No credit card required · One-time upgrade, no subscription · Questions? <a href="mailto:hello@hereday.io" className="underline hover:text-foreground">hello@hereday.io</a>
          </p>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="bg-primary text-primary-foreground py-20">
        <div className="container mx-auto px-4 text-center space-y-6">
          <h2 className="text-3xl sm:text-4xl font-display font-bold">Ready to map your next event?</h2>
          <p className="text-primary-foreground/80 max-w-md mx-auto">
            Join organizers using Hereday to create professional event maps their participants love.
          </p>
          <Button size="lg" variant="secondary" asChild className="rounded-full px-10">
            <Link to="/signup">
              Get started free <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border bg-card py-8">
        <div className="container mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <img src="/hereday-logo.png" alt="Hereday" className="h-16 w-auto -my-3 opacity-70" />
          <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} Hereday. All rights reserved.</p>
          <div className="flex gap-4 text-xs text-muted-foreground">
            <Link to="/login" className="hover:text-foreground transition-colors">Sign in</Link>
            <Link to="/signup" className="hover:text-foreground transition-colors">Sign up</Link>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Index;
