import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { ArrowRight } from 'lucide-react';
import { MIN_PASSWORD_LENGTH, userFacingError } from '@/lib/userFacingError';

// How long to wait for Supabase to turn the link's token into a session
// before deciding the link is dead. A valid link resolves in well under a
// second; this only has to outlast a slow phone connection.
const LINK_TIMEOUT_MS = 8000;

type LinkState = 'verifying' | 'ready' | 'expired';

// Supabase redirects an expired or already-used link back here with the
// reason in the hash (or query, for PKCE): #error=access_denied&error_code=otp_expired
function linkErrorInUrl(): boolean {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const query = new URLSearchParams(window.location.search);
  return !!(params.get('error') || params.get('error_code') || query.get('error') || query.get('error_code'));
}

const ResetPassword = () => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkState, setLinkState] = useState<LinkState>(() => (linkErrorInUrl() ? 'expired' : 'verifying'));
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    if (linkState !== 'verifying') return;
    // PASSWORD_RECOVERY fires when the link's token is exchanged. If that
    // already happened before this mounted, INITIAL_SESSION carries the
    // session instead — either way, a session means the form can submit.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || (event === 'INITIAL_SESSION' && session)) {
        setLinkState('ready');
      }
    });
    const timer = window.setTimeout(() => {
      setLinkState((s) => (s === 'verifying' ? 'expired' : s));
    }, LINK_TIMEOUT_MS);
    return () => {
      subscription.unsubscribe();
      window.clearTimeout(timer);
    };
  }, [linkState]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirmPassword) {
      setError("Those passwords don't match.");
      return;
    }
    setLoading(true);

    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      const friendly = userFacingError(updateError, { action: 'update your password', flow: 'reset' });
      if (friendly.kind === 'session') {
        setLinkState('expired');
      } else {
        setError(friendly.description);
      }
    } else {
      toast({ title: 'Password reset', description: 'Sign in with your new password below.' });
      navigate('/login');
    }
    setLoading(false);
  };

  const description =
    linkState === 'ready'
      ? 'Enter your new password below.'
      : linkState === 'expired'
        ? 'This reset link has expired. Request a new one.'
        : 'Verifying your reset link…';

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center space-y-2">
          <img src="/hereday-logo.png" alt="Hereday" className="w-96 max-h-24 object-contain mx-auto" />
          <p className="text-muted-foreground">Set a new password</p>
        </div>

        <Card className="border-border/60 shadow-lg">
          <CardHeader className="pb-4">
            <CardTitle className="font-display text-xl">
              {linkState === 'expired' ? 'Link expired' : 'Reset password'}
            </CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent>
            {linkState === 'ready' ? (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="password">New password</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={MIN_PASSWORD_LENGTH}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Confirm password</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    minLength={MIN_PASSWORD_LENGTH}
                  />
                </div>
                {error && (
                  <p className="text-sm text-destructive" role="alert">
                    {error}
                  </p>
                )}
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? 'Updating…' : 'Update password'}
                  {!loading && <ArrowRight className="ml-2 h-4 w-4" />}
                </Button>
              </form>
            ) : linkState === 'expired' ? (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Reset links work once and expire after a while. We'll send you a fresh one.
                </p>
                <Button className="w-full" asChild>
                  <Link to="/forgot-password">Request a new link</Link>
                </Button>
              </div>
            ) : (
              <div className="text-center py-4">
                <p className="text-sm text-muted-foreground animate-pulse">
                  Verifying your reset link…
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default ResetPassword;
