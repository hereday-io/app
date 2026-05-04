import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useSeoMeta } from '@/hooks/useSeoMeta';

const LAST_UPDATED = 'April 13, 2026';

const Terms = () => {
  useSeoMeta({
    title: 'Terms of Service — Hereday',
    description:
      'Terms governing use of Hereday — the event map maker for race directors and event organizers.',
    canonicalPath: '/terms',
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
        <h1 className="text-3xl font-display font-bold text-foreground mb-2">Terms of Service</h1>
        <p className="text-sm text-muted-foreground mb-8">Last updated: {LAST_UPDATED}</p>

        <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none space-y-6 text-foreground/90">
          <p>
            These Terms of Service ("Terms") are a legal agreement between you and{' '}
            <strong>Hereday LLC</strong>, an Illinois limited liability company ("Hereday", "we",
            "us"), governing your use of hereday.io and related services (the "Service"). By
            creating an account or using the Service, you agree to these Terms.
          </p>

          <Section title="Who can use Hereday">
            <p>
              You must be at least 18 years old, or the age of majority in your jurisdiction, and
              able to form a binding contract. If you're using Hereday on behalf of an
              organization, you represent that you have authority to bind that organization to
              these Terms.
            </p>
          </Section>

          <Section title="Your account">
            <p>
              You're responsible for keeping your login credentials secure and for everything that
              happens under your account. Let us know right away if you suspect unauthorized
              access. One person, one account — don't share accounts, and don't create accounts
              for others without permission.
            </p>
          </Section>

          <Section title="Your content">
            <p>
              Routes, points of interest, event details, logos, images, and anything else you
              upload ("Your Content") remain yours. By uploading Your Content, you grant Hereday a
              worldwide, non-exclusive, royalty-free license to host, display, and distribute it
              solely as needed to operate the Service — for example, to show your published event
              page to the public, render your map, or back up your data.
            </p>
            <p>
              You represent that you have the right to upload Your Content and that it doesn't
              infringe anyone else's rights. You're responsible for what you publish.
            </p>
          </Section>

          <Section title="Acceptable use">
            <p>Don't use Hereday to:</p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>Break any law or violate anyone's rights (including intellectual property, privacy, or publicity rights)</li>
              <li>Upload malware, spam, or content that's harassing, defamatory, hateful, or sexually explicit</li>
              <li>Attempt to access accounts, data, or systems you're not authorized to access</li>
              <li>Scrape, crawl, or extract data from the Service at scale without written permission</li>
              <li>Resell, sublicense, or white-label the Service without a separate agreement</li>
              <li>Interfere with the Service, probe it for vulnerabilities, or circumvent rate limits or access controls</li>
              <li>Impersonate another person or misrepresent your affiliation with an event or organization</li>
            </ul>
            <p>
              We may suspend or terminate accounts that violate these rules, with or without
              notice.
            </p>
          </Section>

          <Section title="Free and Pro plans">
            <p>
              The free plan includes a limited number of routes and points of interest per event
              and displays a "Made with Hereday" footer on public event pages. The Pro plan is a{' '}
              <strong>one-time $49 per event</strong> purchase that unlocks unlimited routes and
              points of interest, removes the footer, and enables Pro-only features like live
              tracking. Pro is associated with a single event and is not transferable to other
              events.
            </p>
            <p>
              Pricing and features may change. We'll give reasonable notice for material changes
              that affect existing paid events, and changes won't retroactively apply to events
              you've already upgraded.
            </p>
          </Section>

          <Section title="Payment">
            <p>
              Payments are processed by Stripe. By paying for Pro, you authorize us (through
              Stripe) to charge your payment method the amount shown at checkout, including any
              applicable taxes. Refunds are governed by our{' '}
              <Link to="/refund" className="text-primary hover:underline">Refund Policy</Link>.
            </p>
          </Section>

          <Section title="Live tracking and location data">
            <p>
              Runner location sharing is opt-in. Runners can stop sharing at any time, and we only
              broadcast location during the tracking window the organizer configures. Organizers
              are responsible for obtaining any additional consents required in their
              jurisdiction. Hereday is not a safety or emergency service and shouldn't be relied
              on for medical response, search-and-rescue, or any safety-critical decision.
            </p>
          </Section>

          <Section title="Third-party services">
            <p>
              Hereday relies on third-party services (Supabase, Stripe, Mapbox, Vercel, Google).
              We're not responsible for their outages, content, or policies, and their terms apply
              when you interact with them through the Service.
            </p>
          </Section>

          <Section title="Intellectual property">
            <p>
              The Hereday name, logo, and the Service itself (including its software, design, and
              content we provide) are owned by Hereday LLC and protected by copyright, trademark,
              and other laws. These Terms don't grant you any rights to our trademarks or
              branding.
            </p>
          </Section>

          <Section title="Termination">
            <p>
              You can stop using Hereday and delete your account at any time from your dashboard.
              We may suspend or terminate your access if you violate these Terms, if required by
              law, or if the Service is discontinued. On termination, your right to use the
              Service ends, but sections that by their nature should survive — including
              ownership, disclaimers, limitation of liability, and dispute resolution — will
              survive.
            </p>
          </Section>

          <Section title="Disclaimers">
            <p>
              The Service is provided <strong>"as is" and "as available"</strong>, without
              warranties of any kind, express or implied. To the fullest extent permitted by law,
              we disclaim all warranties including merchantability, fitness for a particular
              purpose, non-infringement, and any warranty that the Service will be uninterrupted,
              error-free, secure, or accurate. Maps, routes, and navigation data are provided for
              planning and reference only — verify them on the ground before an event.
            </p>
          </Section>

          <Section title="Limitation of liability">
            <p>
              To the fullest extent permitted by law, Hereday LLC and its owners, employees, and
              contractors will not be liable for any indirect, incidental, special, consequential,
              exemplary, or punitive damages, or for lost profits, lost data, or business
              interruption, arising out of or related to these Terms or the Service — even if
              we've been advised of the possibility of such damages.
            </p>
            <p>
              Our total liability for any claim arising out of or related to these Terms or the
              Service is limited to the <strong>greater of $100 or the amount you paid us in the
              twelve months before the claim arose</strong>.
            </p>
          </Section>

          <Section title="Indemnification">
            <p>
              You agree to indemnify and hold harmless Hereday LLC from any claims, damages, or
              expenses (including reasonable attorneys' fees) arising out of Your Content, your
              use of the Service, or your violation of these Terms or applicable law.
            </p>
          </Section>

          <Section title="Dispute resolution and arbitration">
            <p>
              <strong>Please read this section carefully — it affects your legal rights.</strong>
            </p>
            <p>
              You and Hereday agree that any dispute, claim, or controversy arising out of or
              relating to these Terms or the Service will be resolved by{' '}
              <strong>binding individual arbitration</strong> administered by the American
              Arbitration Association (AAA) under its Consumer Arbitration Rules, rather than in
              court. The arbitration will take place in Cook County, Illinois, or by phone or
              video at your option. Judgment on the award may be entered in any court of
              competent jurisdiction.
            </p>
            <p>
              <strong>Small-claims carve-out.</strong> Either of us may bring a qualifying claim
              in small-claims court in Cook County, Illinois instead of arbitration, as long as
              the claim stays in that court.
            </p>
            <p>
              <strong>Class-action waiver.</strong> You and Hereday agree to bring claims only in
              an individual capacity, and not as a plaintiff or class member in any class,
              collective, or representative proceeding. The arbitrator may not consolidate claims
              or preside over any form of representative proceeding.
            </p>
            <p>
              <strong>Opt-out.</strong> You may opt out of this arbitration agreement by emailing{' '}
              <a href="mailto:legal@hereday.io" className="text-primary hover:underline">
                legal@hereday.io
              </a>{' '}
              within 30 days of first accepting these Terms, with the subject line "Arbitration
              Opt-Out" and your account email in the body.
            </p>
          </Section>

          <Section title="Governing law and venue">
            <p>
              These Terms are governed by the laws of the State of Illinois, without regard to its
              conflict-of-laws rules. Except for claims properly brought in small-claims court,
              any disputes not subject to arbitration will be resolved exclusively in the state or
              federal courts located in Cook County, Illinois, and you consent to personal
              jurisdiction there.
            </p>
          </Section>

          <Section title="Changes to these Terms">
            <p>
              We may update these Terms from time to time. We'll post the new version here with an
              updated date. For material changes, we'll notify you by email if you have an
              account. Continued use of the Service after changes take effect means you accept the
              updated Terms.
            </p>
          </Section>

          <Section title="Miscellaneous">
            <p>
              These Terms, together with our{' '}
              <Link to="/privacy" className="text-primary hover:underline">Privacy Policy</Link>{' '}
              and{' '}
              <Link to="/refund" className="text-primary hover:underline">Refund Policy</Link>,
              are the entire agreement between you and Hereday regarding the Service. If any
              provision is held unenforceable, the rest will remain in effect. Our failure to
              enforce a right isn't a waiver of it. You may not assign these Terms without our
              consent; we may assign them in connection with a merger, acquisition, or sale of
              assets.
            </p>
          </Section>

          <Section title="Contact">
            <p>
              Questions about these Terms? Email us at{' '}
              <a href="mailto:legal@hereday.io" className="text-primary hover:underline">
                legal@hereday.io
              </a>
              .
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
            <Link to="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
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

export default Terms;
