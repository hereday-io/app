import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { userFacingError } from '@/lib/userFacingError';
import GoogleSignInButton from '@/components/GoogleSignInButton';
import AuthLayout, { AUTH_LABEL } from '@/components/auth/AuthLayout';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    if (signInError) {
      setError(userFacingError(signInError, { action: 'sign in', flow: 'signin', email }).description);
    } else {
      navigate('/dashboard');
    }
    setLoading(false);
  };

  // Same layout and order as Signup (email form, then Google) so the two
  // pages read as one flow.
  return (
    <AuthLayout
      headerAction={<>
        New to Hereday?{' '}
        <Link to="/signup" className="text-[hsl(217_91%_45%)] font-medium hover:underline">
          Create an account
        </Link>
      </>}
    >
      <div className="mb-7">
        <h2 className="font-display font-bold text-[32px] leading-none tracking-[-0.02em] mb-[6px]">
          Sign in
        </h2>
        <p className="text-[14.5px] text-muted-foreground leading-[1.6]">
          Pick up where you left off with your event maps.
        </p>
      </div>

      <form onSubmit={handleLogin} className="space-y-[18px]">
        <div className="space-y-[6px]">
          <label htmlFor="email" className={AUTH_LABEL}>Email</label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            className="h-11 rounded-lg"
            placeholder="you@run.club"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="space-y-[6px]">
          <div className="flex items-baseline justify-between">
            <label htmlFor="password" className={AUTH_LABEL}>Password</label>
            <Link to="/forgot-password" className="text-[12px] text-muted-foreground hover:text-foreground hover:underline">
              Forgot password?
            </Link>
          </div>
          {/* No placeholder: a row of dots reads as an already-filled field. */}
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            className="h-11 rounded-lg"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        {error && (
          <p className="text-[12.5px] text-[hsl(0_72%_55%)]" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full h-11 rounded-lg bg-primary text-white font-medium text-[14px] inline-flex items-center justify-center gap-2 hover:bg-[hsl(217_91%_45%)] shadow-[0_1px_2px_rgba(0,0,0,0.05)] disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {loading ? 'Signing in…' : (
            <>
              Sign in
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
    </AuthLayout>
  );
};

export default Login;
