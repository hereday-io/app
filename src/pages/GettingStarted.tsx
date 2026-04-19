import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

const LAST_UPDATED = 'April 17, 2026';

const GettingStarted = () => {
  return (
    <div className="min-h-screen bg-background">
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
        <h1 className="text-3xl font-display font-bold text-foreground mb-2">Getting Started</h1>
        <p className="text-base text-muted-foreground mb-10">
          Go from signup to a live event page in under five minutes. No credit card needed.
        </p>

        <div className="space-y-10">
          <Step number={1} title="Create your account">
            <p>
              <Link to="/signup" className="text-primary hover:underline font-medium">Sign up</Link>{' '}
              with Google (one click) or your email. If you use email, check your inbox for a
              verification link — you can start building immediately, but you'll need to verify
              before you publish.
            </p>
          </Step>

          <Step number={2} title="Create your first event">
            <p>
              From your dashboard, click <strong>+ New Event</strong>. Give it a name, set the
              date and city, and you're in the route editor. That's it — no templates, no
              wizards, no ten-field form.
            </p>
          </Step>

          <Step number={3} title="Draw your route">
            <p>
              Click the map to place waypoints. Hereday snaps them to real roads automatically
              using turn-by-turn routing. Keep clicking to extend the course, then either{' '}
              <strong>double-click</strong> or hit the <strong>Finish route</strong> button
              (appears after 3 waypoints) to close it out.
            </p>
            <p className="mt-2">
              Running a multi-course event (5K / 10K / half)? Add another route from the
              sidebar — each one gets its own color and legend entry.
            </p>
          </Step>

          <Step number={4} title="Drop markers">
            <p>
              Switch to the marker tool and pick a category — <strong>aid station</strong>,{' '}
              <strong>water</strong>, <strong>medical</strong>, <strong>restroom</strong>,{' '}
              <strong>parking</strong>, <strong>registration</strong>, <strong>start</strong>,{' '}
              or <strong>finish</strong>. Click the map to place it, then name it and add an
              optional description. Markers cluster when zoomed out so your map stays clean.
            </p>
            <Callout>
              <strong>Free tier:</strong> up to 3 routes and 30 markers per event. That covers a
              typical small race — marathon weekends and larger events hit Pro as a genuine
              "outgrew it" moment, not a demo wall.
            </Callout>
          </Step>

          <Step number={5} title="Preview your public page">
            <p>
              Click <strong>Preview</strong> in the editor toolbar to see exactly what
              participants and spectators will see. The public page has two modes:
            </p>
            <ul className="list-disc pl-5 space-y-1.5 mt-2">
              <li><strong>Runner view</strong> — turn-by-turn with elevation profile and distance markers</li>
              <li><strong>Spectator view</strong> — bird's-eye overview with all routes and markers</li>
            </ul>
          </Step>

          <Step number={6} title="Publish">
            <p>
              Hit <strong>Publish</strong> in the editor or from your dashboard. Your event
              gets a permanent shareable URL at <code className="text-xs bg-muted px-1.5 py-0.5 rounded">hereday.io/event/your-event-name</code>.
              You can unpublish and republish as many times as you want — edits go live
              instantly, no need to re-share the link.
            </p>
          </Step>

          <Step number={7} title="Share with participants">
            <p>From your dashboard, click the <strong>⋮ menu</strong> on your event card:</p>
            <ul className="list-disc pl-5 space-y-1.5 mt-2">
              <li><strong>Copy share link</strong> — paste into email, social media, or your race registration page</li>
              <li><strong>QR code</strong> — download a print-ready QR that links to your event page (great for race-day signage and printed race bibs)</li>
              <li><strong>Race-day checklist</strong> — download a printable PDF with your course, markers, QR code, and organizer contact info to hand volunteers on race morning</li>
            </ul>
          </Step>
        </div>

        {/* What's next */}
        <div className="mt-14 pt-8 border-t border-border">
          <h2 className="text-xl font-display font-semibold text-foreground mb-4">What's next?</h2>
          <div className="space-y-4 text-foreground/90">
            <NextItem title="Upgrade to Pro" tag="$49 / event">
              Unlock unlimited routes and markers, remove the "Made with Hereday" footer, add your
              own logo and brand colors, and enable live GPS tracking for participants and
              spectators on race day.
            </NextItem>
            <NextItem title="Collect email subscribers">
              Visitors can subscribe to your event updates directly from your public page. You'll
              see subscriber counts on your dashboard — and with Pro, you'll be able to email
              them directly.
            </NextItem>
            <NextItem title="Enable live tracking" tag="Pro">
              Turn on real-time GPS tracking so spectators can follow runners on the map during
              the event. Runners opt in from their phone — no app install required.
            </NextItem>
          </div>
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
            <Link to="/terms" className="hover:text-foreground transition-colors">Terms</Link>
            <Link to="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
            <Link to="/refund" className="hover:text-foreground transition-colors">Refunds</Link>
            <Link to="/login" className="hover:text-foreground transition-colors">Sign in</Link>
          </div>
        </div>
      </footer>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Shared components                                                  */
/* ------------------------------------------------------------------ */

const Step = ({ number, title, children }: { number: number; title: string; children: React.ReactNode }) => (
  <section className="relative pl-12">
    <div className="absolute left-0 top-0.5 flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-display font-bold text-sm">
      {number}
    </div>
    <h2 className="text-lg font-display font-semibold text-foreground mb-2">{title}</h2>
    <div className="text-foreground/90 text-sm leading-relaxed space-y-2">{children}</div>
  </section>
);

const Callout = ({ children }: { children: React.ReactNode }) => (
  <div className="mt-3 rounded-md border border-amber-300/50 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-600/30 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
    {children}
  </div>
);

const NextItem = ({ title, tag, children }: { title: string; tag?: string; children: React.ReactNode }) => (
  <div>
    <h3 className="text-sm font-semibold text-foreground inline">
      {title}
    </h3>
    {tag && (
      <span className="ml-2 text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded-full">
        {tag}
      </span>
    )}
    <p className="text-sm text-foreground/80 mt-1">{children}</p>
  </div>
);

export default GettingStarted;
