import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSeoMeta } from '@/hooks/useSeoMeta';
import { PAYWALL_LIMITS } from '@/hooks/usePaywall';

// Linked from outreach emails (the Pro offer play) as the "what does Pro
// get me" page. Feature wording mirrors the pricing card in Index.tsx and
// the "What does Pro unlock?" FAQ — keep the three in step.
const ProGuide = () => {
  useSeoMeta({
    title: 'Hereday Pro for Race Directors — Event Ops Center, Branding & More',
    description:
      'What Hereday Pro adds to your race map: the Event Ops Center for race day, live volunteer status, unlimited routes, your own branding and sponsors. $49 per event, one time.',
    canonicalPath: '/pro',
  });

  return (
    <div className="min-h-screen bg-background">
      {/* Article schema is injected into <head> server-side by
          api/page/[name].ts (source: api/_shared/pageSchemas.ts). */}

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
          Hereday Pro: run race day from one screen
        </h1>
        <p className="text-base text-muted-foreground mb-10">
          The free plan publishes your course map. Pro adds what you need on race morning: live
          volunteer updates, an operations dashboard, and a page that carries your brand and your
          sponsors. <strong className="text-foreground">$49 per event, one time.</strong> No
          subscription.
        </p>

        <div className="space-y-10">
          <Feature title="Event Ops Center">
            <p>
              A race-day dashboard for your event, opened from your Hereday dashboard. In one
              place you get:
            </p>
            <ul className="list-disc pl-5 space-y-1.5 mt-2">
              <li><strong>Live marker statuses</strong>: every water station and aid station, as your volunteers report it</li>
              <li><strong>Volunteer roster</strong>: which volunteers are active and which have gone idle</li>
              <li><strong>Activity feed</strong>: status changes, new subscribers and scouted markers as they happen</li>
              <li><strong>Scout review</strong>: volunteers can suggest markers from the course; you accept them onto the map with one click</li>
              <li><strong>Analytics and sponsors</strong>: page views over time, QR shares, and impressions and clicks for each sponsor, which are numbers worth sending your sponsors after the race</li>
              <li><strong>Subscriber tracking</strong>: who signed up for updates from your event page</li>
            </ul>
          </Feature>

          <Feature title="Live volunteer status on the public map">
            <p>
              Volunteers mark their station <strong>Open</strong>, <strong>Low</strong> or{' '}
              <strong>Closed</strong> from their phone. Runners and spectators see it as a colored
              dot on the map, so nobody runs to a water table that's already out.
            </p>
          </Feature>

          <Feature title="Unlimited routes and points of interest">
            <p>
              Free events get {PAYWALL_LIMITS.routes} routes and {PAYWALL_LIMITS.pois} points of
              interest. Pro removes both limits, which matters when you run a 5K, 10K, half and a
              kids' dash on the same morning, or want every water stop, restroom and parking lot on
              the map.
            </p>
          </Feature>

          <Feature title="Your brand and all your sponsors">
            <p>
              Put your logo and banner on the public event page, show every sponsor with their logo
              and link (free events show one), and remove the "Made with Hereday" footer.
            </p>
          </Feature>

          <Feature title="A clean race-day checklist">
            <p>
              Every event can download a printable race-day checklist with your course, markers, QR
              code and organizer contacts. With Pro it comes without the Hereday footer, ready to
              hand to volunteers as your own.
            </p>
          </Feature>

          <Feature title="Priority support">
            <p>
              Questions before or during race week go to the front of the line at{' '}
              <a href="mailto:hello@hereday.io" className="text-primary hover:underline">
                hello@hereday.io
              </a>
              .
            </p>
          </Feature>
        </div>

        {/* How to get it */}
        <div className="mt-14 pt-8 border-t border-border">
          <h2 className="text-xl font-display font-semibold text-foreground mb-4">How to get Pro</h2>
          <ol className="list-decimal pl-5 space-y-2 text-sm text-foreground/90 leading-relaxed">
            <li>
              <Link to="/signup" className="text-primary hover:underline font-medium">Create a free account</Link>{' '}
              and build your event. The{' '}
              <Link to="/getting-started" className="text-primary hover:underline font-medium">getting-started guide</Link>{' '}
              takes about five minutes.
            </li>
            <li>
              Open the event and choose <strong>Unlock for $49</strong>. Pro applies to that one
              event; your other events stay free until you decide otherwise.
            </li>
            <li>
              Have a discount code? Enter it on your{' '}
              <Link to="/billing#promo" className="text-primary hover:underline font-medium">Billing page</Link>{' '}
              before you unlock, or type it at checkout.
            </li>
          </ol>
          <p className="text-sm text-muted-foreground mt-4">
            More questions about pricing and refunds are answered in the{' '}
            <Link to="/faq" className="text-primary hover:underline">FAQ</Link>.
          </p>
        </div>

        {/* CTA */}
        <div className="mt-12 text-center">
          <Button asChild size="lg">
            <Link to="/signup">
              Start for free <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
          <p className="text-sm text-muted-foreground mt-3">
            Questions?{' '}
            <a href="mailto:hello@hereday.io" className="text-primary hover:underline">
              hello@hereday.io
            </a>
          </p>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border bg-card py-8 mt-12">
        <div className="container mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <img src="/hereday-logo.png" alt="Hereday" className="h-16 w-auto -my-3 opacity-70" />
          <p className="text-xs text-muted-foreground">&copy; {new Date().getFullYear()} Hereday LLC. All rights reserved.</p>
          <div className="flex gap-4 text-xs text-muted-foreground">
            <Link to="/getting-started" className="hover:text-foreground transition-colors">Getting Started</Link>
            <Link to="/faq" className="hover:text-foreground transition-colors">FAQ</Link>
            <Link to="/terms" className="hover:text-foreground transition-colors">Terms</Link>
            <Link to="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
          </div>
        </div>
      </footer>
    </div>
  );
};

const Feature = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section>
    <h2 className="text-lg font-display font-semibold text-foreground mb-2">{title}</h2>
    <div className="text-foreground/90 text-sm leading-relaxed space-y-2">{children}</div>
  </section>
);

export default ProGuide;
