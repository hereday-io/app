import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { logEvent } from '@/lib/analytics';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { ArrowRight } from 'lucide-react';
import GoogleSignInButton from '@/components/GoogleSignInButton';

// Lightweight password strength heuristic. We deliberately skip zxcvbn
// (~400KB gzip) — the goal is a live signal that nudges users toward
// passwords longer than our 6-char minimum, not a bank-grade estimator.
// Score 0-4: weak, fair, good, strong, excellent.
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

const Signup = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  const viewedRef = useRef(false);
  useEffect(() => {
    if (!viewedRef.current) { viewedRef.current = true; logEvent('signup_page_viewed'); }
  }, []);

  const strength = useMemo(() => scorePassword(password), [password]);
  // Gate submission on both the Supabase minimum (6) and a meaningful
  // strength signal — a 6-char all-lowercase password is technically
  // valid but should at least prompt the user.
  const passwordAcceptable = password.length >= 6;

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName },
        emailRedirectTo: `${window.location.origin}/dashboard`,
      },
    });

    if (error) {
      toast({ title: 'Signup failed', description: error.message, variant: 'destructive' });
    } else {
      logEvent('signup_form_submitted', null, { method: 'email' });
      toast({ title: 'Account created', description: 'Check your inbox to verify your email. You can start building right away.' });
      navigate('/dashboard');
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center space-y-2">
          <img src="/hereday-logo.png" alt="Hereday" className="w-96 max-h-24 object-contain mx-auto" />
          <p className="text-muted-foreground">Create your account</p>
        </div>

        <Card className="border-border/60 shadow-lg">
          <CardHeader className="pb-4">
            <CardTitle className="font-display text-xl">Get started</CardTitle>
            <CardDescription>Your first route is two minutes away.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 mb-4">
              <GoogleSignInButton />
              <p className="text-[11px] text-muted-foreground text-center leading-snug">
                By creating an account you agree to our{' '}
                <Link to="/terms" className="underline hover:text-foreground">Terms of Service</Link>{' '}
                and{' '}
                <Link to="/privacy" className="underline hover:text-foreground">Privacy Policy</Link>.
              </p>
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">or sign up with email</span>
                </div>
              </div>
            </div>
            <form onSubmit={handleSignup} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Display name</Label>
                <Input
                  id="name"
                  placeholder="Jane Smith"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="organizer@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                />
                {password.length > 0 && (
                  <div className="space-y-1">
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
                    <p className="text-[11px] text-muted-foreground">
                      {passwordAcceptable ? strength.label : 'At least 6 characters'}
                      {passwordAcceptable && strength.score < 3 && (
                        <span className="ml-1">— try mixing case, numbers, or symbols</span>
                      )}
                    </p>
                  </div>
                )}
              </div>
              <Button type="submit" className="w-full" disabled={loading || !passwordAcceptable}>
                {loading ? 'Creating account…' : 'Create account'}
                {!loading && <ArrowRight className="ml-2 h-4 w-4" />}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link to="/login" className="text-primary font-medium hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
};

export default Signup;
