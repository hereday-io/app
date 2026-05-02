import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Sparkles, Zap, Check } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { logEvent } from '@/lib/analytics';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { InfoCallout } from '@/components/ui/info-callout';
import GoogleSignInButton from '@/components/GoogleSignInButton';

// Lightweight password strength heuristic. We deliberately skip zxcvbn
// (~400KB gzip) — the goal is a live signal that nudges users toward
// passwords longer than our 6-char minimum, not a bank-grade estimator.
const scorePassword = (pw: string): { score: 0 | 1 | 2 | 3 | 4; label: string } => {
  if (!pw) return { score: 0, label: '' };
  let points = 0;
  if (pw.length >= 8) points++;
  if (pw.length >= 12) points++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) points++;
  if (/\d/.test(pw)) points++;
  if (/[^A-Za-z0-9]/.test(pw)) points++;
  const score = Math.min(4, points) as 0 | 1 | 2 | 3 | 4;
  const labels = ['Too short', 'Weak', 'Fair', 'Good', 'Strong'];
  return { score, label: labels[score] };
};

const FEATURES = [
  'Unlimited free events',
  'Publish a shareable link in 5 minutes',
  'Pay per event, never a subscription',
];

const SMALL_CAPS_LABEL =
  'font-display font-semibold text-[11px] uppercase tracking-[0.07em] text-muted-foreground block';

const Signup = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  const navigate = useNavigate();

  const viewedRef = useRef(false);
  useEffect(() => {
    if (!viewedRef.current) { viewedRef.current = true; logEvent('signup_page_viewed'); }
  }, []);

  const strength = useMemo(() => scorePassword(password), [password]);
  const passwordAcceptable = password.length >= 6;

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error: signupError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName },
        emailRedirectTo: `${window.location.origin}/dashboard`,
      },
    });

    if (signupError) {
      setError(signupError.message);
      toast({ title: 'Signup failed', description: signupError.message, variant: 'destructive' });
    } else {
      logEvent('signup_form_submitted', null, { method: 'email' });
      toast({ title: 'Account created', description: 'Check your inbox to verify your email. You can start building right away.' });
      navigate('/dashboard');
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-[1.05fr_1fr] bg-[hsl(210_20%_98%)]">
      {/* ── Left — brand splash ───────────────────────────────────── */}
      <div className="hidden lg:flex flex-col justify-between p-12 bg-gradient-to-br from-[hsl(217_91%_18%)] via-[hsl(217_80%_26%)] to-[hsl(217_65%_40%)] text-white relative overflow-hidden">
        <div className="absolute -top-32 -right-32 w-[460px] h-[460px] rounded-full bg-gradient-to-br from-[hsl(25_95%_58%/0.4)] to-transparent blur-3xl" />
        <div className="absolute -bottom-40 -left-20 w-[380px] h-[380px] rounded-full bg-[hsl(217_91%_50%/0.4)] blur-3xl" />

        <Link to="/" className="relative flex items-center gap-3">
          <img src="/browserlogo.png" alt="" className="h-11 w-11 rounded-xl" />
          <span className="font-display font-bold text-[20px] tracking-[-0.01em]">Hereday</span>
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
          <div className="px-6 py-[10px] flex items-center justify-between">
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </Link>
            <span className="text-[13px] text-muted-foreground">
              Already have an account?{' '}
              <Link to="/login" className="text-[hsl(217_91%_45%)] font-medium hover:underline">
                Sign in
              </Link>
            </span>
          </div>
        </header>

        <div className="flex-1 flex items-start justify-center px-6 pt-12 pb-16">
          <div className="w-full max-w-[420px]">
            <div className="mb-7">
              <h2 className="font-display font-bold text-[32px] leading-none tracking-[-0.02em] mb-[6px]">
                Create your account
              </h2>
              <p className="text-[14.5px] text-muted-foreground leading-[1.6] max-w-[62ch]">
                Free forever. Upgrade per event when you publish —{' '}
                <b className="text-foreground font-medium">no subscription, no auto-renew</b>.
              </p>
            </div>

            <InfoCallout
              className="mb-7"
              icon={<Sparkles className="h-4 w-4" />}
              title="What you get on the free plan"
            >
              Up to <b className="text-foreground font-medium">3 routes</b> and{' '}
              <b className="text-foreground font-medium">30 markers</b> per event, unlimited events,
              and a public share link.{' '}
              <span className="font-display font-semibold text-[10.5px] uppercase tracking-[0.07em] rounded-full px-2 py-[2px] bg-[hsl(45_93%_94%)] text-[hsl(32_65%_35%)] inline-flex items-center gap-1 align-[1px] ml-1">
                <Zap className="h-2.5 w-2.5" />
                Pro $49/event
              </span>{' '}
              when you need more.
            </InfoCallout>

            <form onSubmit={handleSignup} className="space-y-[18px]">
              <div className="space-y-[6px]">
                <label htmlFor="signup-name" className={SMALL_CAPS_LABEL}>Your name</label>
                <Input
                  id="signup-name"
                  className="h-11 rounded-lg"
                  placeholder="Alex Garcia"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-[6px]">
                <label htmlFor="signup-email" className={SMALL_CAPS_LABEL}>Email</label>
                <Input
                  id="signup-email"
                  type="email"
                  className="h-11 rounded-lg"
                  placeholder="you@run.club"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-[6px]">
                <label htmlFor="signup-password" className={SMALL_CAPS_LABEL}>Password</label>
                <Input
                  id="signup-password"
                  type="password"
                  className="h-11 rounded-lg"
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                />
                {password.length > 0 ? (
                  <div className="space-y-1 pt-1">
                    <div className="flex gap-1" aria-hidden>
                      {[0, 1, 2, 3].map((i) => (
                        <div
                          key={i}
                          className={`h-1 flex-1 rounded-full transition-colors ${
                            i < strength.score
                              ? strength.score <= 1
                                ? 'bg-destructive'
                                : strength.score === 2
                                  ? 'bg-amber-500'
                                  : strength.score === 3
                                    ? 'bg-yellow-500'
                                    : 'bg-emerald-500'
                              : 'bg-muted'
                          }`}
                        />
                      ))}
                    </div>
                    <p className="text-[11.5px] text-muted-foreground leading-[1.5]">
                      {passwordAcceptable ? strength.label : 'At least 6 characters'}
                      {passwordAcceptable && strength.score < 3 && (
                        <span className="ml-1">— try mixing case, numbers, or symbols</span>
                      )}
                    </p>
                  </div>
                ) : (
                  <p className="text-[11.5px] text-muted-foreground leading-[1.5]">
                    We'll send you a confirmation email.
                  </p>
                )}
              </div>

              {error && (
                <p className="text-[12.5px] text-[hsl(0_72%_55%)]" role="alert">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading || !passwordAcceptable}
                className="w-full h-11 rounded-lg bg-[hsl(217_91%_50%)] text-white font-medium text-[14px] inline-flex items-center justify-center gap-2 hover:bg-[hsl(217_91%_45%)] shadow-[0_1px_2px_rgba(0,0,0,0.05)] disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loading ? 'Creating account…' : (
                  <>
                    Create account
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>

              <div className="flex items-center gap-3 text-[11px] text-muted-foreground py-1">
                <div className="flex-1 h-px bg-border" />
                <span className="font-display uppercase tracking-[0.08em] text-[10px]">or</span>
                <div className="flex-1 h-px bg-border" />
              </div>

              <GoogleSignInButton />
            </form>

            <p className="text-[11.5px] text-center text-muted-foreground mt-7 leading-[1.5]">
              By signing up you agree to the{' '}
              <Link to="/terms" className="underline hover:text-foreground">Terms</Link>{' '}
              and{' '}
              <Link to="/privacy" className="underline hover:text-foreground">Privacy Policy</Link>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Signup;
