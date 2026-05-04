import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useSeoMeta } from '@/hooks/useSeoMeta';

const LAST_UPDATED = 'April 6, 2026';

const Privacy = () => {
  useSeoMeta({
    title: 'Privacy Policy — Hereday',
    description:
      'How Hereday collects, uses, and protects your data. We do not sell user data, run ads, or train AI on your content.',
    canonicalPath: '/privacy',
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
        <h1 className="text-3xl font-display font-bold text-foreground mb-2">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground mb-8">Last updated: {LAST_UPDATED}</p>

        <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none space-y-6 text-foreground/90">
          <p>
            Hereday ("we", "us", "our") operates hereday.io. This policy explains what data
            we collect, why we collect it, and how we protect it. We keep this short and honest
            because we believe privacy policies should be readable.
          </p>

          <Section title="What we collect">
            <Subsection title="Account information">
              <p>
                When you sign in with Google, we receive your name, email address, and profile
                photo from Google. We use this to create your account and display your name in
                the app. We do not access your Google contacts, calendar, or any other data.
              </p>
            </Subsection>

            <Subsection title="Event data">
              <p>
                Routes, points of interest, event names, dates, cities, and branding assets you
                upload are stored so you can create and publish event maps. Published event data
                is publicly accessible via your event's share link.
              </p>
            </Subsection>

            <Subsection title="Email subscriptions">
              <p>
                When a visitor subscribes to event updates, we store their email address and
                associate it with that event. We only use this email to send information about
                that specific event. We do not sell, rent, or share subscriber emails with
                third parties.
              </p>
            </Subsection>

            <Subsection title="GPS location (live tracking)">
              <p>
                If a runner chooses to share their location during a Pro event, their GPS
                coordinates are broadcast in real time to spectators viewing the event map.
                Location data is transmitted only while the runner actively opts in, and only
                during the organizer-configured tracking window. We store the last known
                position temporarily so late-joining spectators can see current runner locations.
                We do not retain historical GPS tracks after the tracking session ends.
              </p>
              <p>
                <strong>Location sharing is always voluntary.</strong> The browser asks for
                permission before accessing GPS, and runners can stop sharing at any time.
              </p>
            </Subsection>

            <Subsection title="Payment information">
              <p>
                Payments are processed by Stripe. We never see or store your full card number.
                We store your Stripe customer ID so we can associate payments with your account.
              </p>
            </Subsection>

            <Subsection title="Analytics and usage">
              <p>
                We log basic product events (page views, feature usage) to understand how
                people use Hereday and improve the product. These events are tied to your
                account when you're signed in, or anonymous when you're not.
              </p>
            </Subsection>
          </Section>

          <Section title="How we use your data">
            <ul className="list-disc pl-5 space-y-1.5">
              <li>To provide and maintain the Hereday service</li>
              <li>To send event-related emails you opted into</li>
              <li>To process payments for Pro upgrades</li>
              <li>To improve the product based on aggregate usage patterns</li>
            </ul>
            <p>
              We do <strong>not</strong> sell your data. We do <strong>not</strong> run
              advertising. We do <strong>not</strong> use your data to train AI models.
            </p>
          </Section>

          <Section title="Third-party services">
            <p>We use the following services to operate Hereday:</p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li><strong>Supabase</strong> — database, authentication, and real-time infrastructure (hosted in AWS US)</li>
              <li><strong>Stripe</strong> — payment processing</li>
              <li><strong>Mapbox</strong> — map rendering and geocoding</li>
              <li><strong>Vercel</strong> — hosting and deployment</li>
              <li><strong>Google</strong> — OAuth sign-in</li>
            </ul>
            <p>
              Each of these services has their own privacy policy. We only share the minimum
              data required for each service to function.
            </p>
          </Section>

          <Section title="Cookies and local storage">
            <p>
              We use browser localStorage to keep you signed in, remember your view preferences
              (runner vs. spectator), and store active tracking session IDs. We do not use
              third-party tracking cookies or advertising pixels.
            </p>
          </Section>

          <Section title="Data retention">
            <ul className="list-disc pl-5 space-y-1.5">
              <li><strong>Account data</strong> — kept until you delete your account</li>
              <li><strong>Event data</strong> — kept until you delete the event</li>
              <li><strong>Subscriber emails</strong> — kept until the subscriber unsubscribes or the event is deleted</li>
              <li><strong>GPS tracking data</strong> — temporary; last known position is cleared when the tracking session ends</li>
              <li><strong>Analytics events</strong> — retained for up to 12 months</li>
            </ul>
          </Section>

          <Section title="Your rights">
            <p>You can:</p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li><strong>Access</strong> your data by signing in to your dashboard</li>
              <li><strong>Delete</strong> your events and account at any time</li>
              <li><strong>Export</strong> your data by contacting us</li>
              <li><strong>Opt out</strong> of email subscriptions via the unsubscribe link in any email</li>
            </ul>
            <p>
              If you're in the EU, UK, or California, you have additional rights under GDPR,
              UK GDPR, or CCPA respectively. Contact us and we'll honor them.
            </p>
          </Section>

          <Section title="Children">
            <p>
              Hereday is not directed at children under 13. We do not knowingly collect data
              from children. If you believe a child has provided us with personal information,
              contact us and we will delete it.
            </p>
          </Section>

          <Section title="Changes to this policy">
            <p>
              We may update this policy from time to time. We'll post the new version here with
              an updated date. For significant changes, we'll notify you by email if you have
              an account.
            </p>
          </Section>

          <Section title="Contact">
            <p>
              Questions about this policy? Email us at{' '}
              <a href="mailto:hello@hereday.io" className="text-primary hover:underline">
                hello@hereday.io
              </a>
            </p>
          </Section>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border bg-card py-8 mt-12">
        <div className="container mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <img src="/hereday-logo.png" alt="Hereday" className="h-16 w-auto -my-3 opacity-70" />
          <p className="text-xs text-muted-foreground">&copy; {new Date().getFullYear()} Hereday. All rights reserved.</p>
          <div className="flex gap-4 text-xs text-muted-foreground">
            <Link to="/terms" className="hover:text-foreground transition-colors">Terms</Link>
            <Link to="/refund" className="hover:text-foreground transition-colors">Refunds</Link>
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

const Subsection = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="ml-1">
    <h3 className="text-sm font-semibold text-foreground mb-1">{title}</h3>
    {children}
  </div>
);

export default Privacy;
