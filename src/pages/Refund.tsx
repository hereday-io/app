import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useSeoMeta } from '@/hooks/useSeoMeta';

const LAST_UPDATED = 'April 13, 2026';

const Refund = () => {
  useSeoMeta({
    title: 'Refund Policy — Hereday',
    description:
      'Hereday refund policy. Full refund within 7 days for unpublished events; cancellations after publishing reviewed case by case.',
    canonicalPath: '/refund',
  });

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
        <h1 className="text-3xl font-display font-bold text-foreground mb-2">Refund Policy</h1>
        <p className="text-sm text-muted-foreground mb-8">Last updated: {LAST_UPDATED}</p>

        <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none space-y-6 text-foreground/90">
          <p>
            Hereday Pro is a <strong>one-time $49 upgrade per event</strong>. This policy explains
            when we issue refunds. We aim to be fair — if something here feels off for your
            situation, email us and we'll take a look.
          </p>

          <Section title="7-day refund for unpublished events">
            <p>
              If you purchased Pro and haven't published the event yet, you can request a full
              refund within <strong>7 days</strong> of payment. Email{' '}
              <a href="mailto:legal@hereday.io" className="text-primary hover:underline">
                legal@hereday.io
              </a>{' '}
              from the account you paid with, and we'll refund you to the original payment method.
            </p>
          </Section>

          <Section title="No refunds after publishing">
            <p>
              Once you publish an event, Pro features have been delivered and made available to
              your participants and spectators — unlimited routes and POIs, branding, live
              tracking, no Hereday footer on your public page. For that reason, we don't issue
              refunds on published events.
            </p>
          </Section>

          <Section title="Cancelled events (force majeure)">
            <p>
              If your event is cancelled due to weather, venue loss, or another circumstance
              outside your reasonable control within 30 days of payment, email us at{' '}
              <a href="mailto:legal@hereday.io" className="text-primary hover:underline">
                legal@hereday.io
              </a>{' '}
              with a brief description of what happened. We review these case by case and will
              typically offer a refund or credit toward a future event at our discretion.
            </p>
          </Section>

          <Section title="Duplicate or accidental charges">
            <p>
              If you were charged twice for the same event or paid in error, we'll refund the
              duplicate charge in full. Email us with your account email and the approximate
              date(s) of payment.
            </p>
          </Section>

          <Section title="How refunds work">
            <ul className="list-disc pl-5 space-y-1.5">
              <li>Refunds go to the original payment method via Stripe</li>
              <li>Most refunds appear within 5–10 business days depending on your bank</li>
              <li>Once refunded, the event's Pro features are removed and the "Made with Hereday" footer returns to the public page</li>
            </ul>
          </Section>

          <Section title="Chargebacks">
            <p>
              If you have an issue, please contact us first — we'd much rather fix it than fight a
              chargeback. Initiating a chargeback without first contacting us may result in your
              account being suspended while the dispute is reviewed.
            </p>
          </Section>

          <Section title="Contact">
            <p>
              For refund requests or questions, email{' '}
              <a href="mailto:legal@hereday.io" className="text-primary hover:underline">
                legal@hereday.io
              </a>{' '}
              from the account you paid with. Including the event name in the subject line helps
              us resolve it faster.
            </p>
          </Section>
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
            <Link to="/login" className="hover:text-foreground transition-colors">Sign in</Link>
          </div>
        </div>
      </footer>
    </div>
  );
};

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section>
    <h2 className="text-lg font-display font-semibold text-foreground mb-2">{title}</h2>
    {children}
  </section>
);

export default Refund;
