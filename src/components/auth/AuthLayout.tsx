import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check } from 'lucide-react';

const FEATURES = [
  'Unlimited free events',
  'Publish a shareable link in 5 minutes',
  'Pay per event, never a subscription',
];

/** Small-caps form label shared by the auth pages. */
export const AUTH_LABEL =
  'font-display font-semibold text-[11px] uppercase tracking-[0.07em] text-muted-foreground block';

interface AuthLayoutProps {
  /** Right side of the form column's top bar, e.g. "Already have an account? Sign in". */
  headerAction: ReactNode;
  children: ReactNode;
}

/**
 * Two-column auth shell from the Signup + Dashboard handoff: brand splash
 * on the left (desktop only), form column on the right. Signup and Login
 * both use it so moving between them doesn't feel like a different product.
 */
const AuthLayout = ({ headerAction, children }: AuthLayoutProps) => (
  <div className="min-h-screen grid lg:grid-cols-[1.05fr_1fr] bg-[hsl(210_20%_98%)]">
    {/* ── Left — brand splash ───────────────────────────────────── */}
    <div className="hidden lg:flex flex-col justify-between p-12 bg-gradient-to-br from-[hsl(217_91%_18%)] via-[hsl(217_80%_26%)] to-[hsl(217_65%_40%)] text-white relative overflow-hidden">
      <div className="absolute -top-32 -right-32 w-[460px] h-[460px] rounded-full bg-gradient-to-br from-[hsl(25_95%_58%/0.4)] to-transparent blur-3xl" />
      <div className="absolute -bottom-40 -left-20 w-[380px] h-[380px] rounded-full bg-[hsl(217_91%_50%/0.4)] blur-3xl" />

      <Link to="/" className="relative flex items-center gap-3">
        <img src="/browserlogo.png" alt="" className="h-11 w-11 rounded-xl" />
        <span className="font-display font-bold text-[20px] tracking-[-0.01em]">hereday</span>
      </Link>

      <div className="relative space-y-7 max-w-md">
        <p className="font-display font-semibold text-[11px] uppercase tracking-[0.18em] text-[hsl(25_95%_75%)]">
          Built for race organizers
        </p>

        <h1 className="font-display font-bold text-[40px] leading-[1.05] tracking-[-0.02em]">
          Type a name.<br />
          Draw a route.<br />
          <span className="text-[hsl(25_95%_68%)]">Share a link.</span>
        </h1>

        <p className="text-white/75 text-[14.5px] leading-[1.6] max-w-[42ch]">
          The fastest way to turn a course into a polished, shareable map page — the kind runners and spectators actually use on race day.
        </p>

        <ul className="space-y-3 text-[13.5px]">
          {FEATURES.map((item) => (
            <li key={item} className="flex items-center gap-3">
              <span className="w-5 h-5 rounded-full bg-white/[0.12] border border-white/15 flex items-center justify-center flex-shrink-0">
                <Check className="h-3 w-3" />
              </span>
              {item}
            </li>
          ))}
        </ul>
      </div>

      <div className="relative text-[11.5px] text-white/60 font-display">
        © {new Date().getFullYear()} Hereday · Made for race organizers.
      </div>
    </div>

    {/* ── Right — form column ───────────────────────────────────── */}
    <div className="flex flex-col">
      <header className="sticky top-0 z-50 border-b border-border bg-white/80 backdrop-blur-md">
        <div className="px-6 py-[10px] flex items-center justify-between gap-4">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </Link>
          <span className="text-[13px] text-muted-foreground text-right">{headerAction}</span>
        </div>
      </header>

      <div className="flex-1 flex items-start justify-center px-6 pt-12 pb-16">
        <div className="w-full max-w-[420px]">{children}</div>
      </div>
    </div>
  </div>
);

export default AuthLayout;
