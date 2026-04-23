import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Check, AlertCircle, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

type State =
  | { kind: 'loading' }
  | { kind: 'success'; eventName: string; audience: 'subscriber' | 'volunteer' }
  | { kind: 'error'; message: string };

const Unsubscribe = () => {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    if (!token) {
      setState({ kind: 'error', message: 'Missing unsubscribe token.' });
      return;
    }

    let cancelled = false;
    (async () => {
      // The unsubscribe edge function has verify_jwt=false so we can hit
      // it directly via fetch without a Supabase session. Using
      // supabase.functions.invoke would still work but would attach the
      // anon JWT unnecessarily.
      const projectUrl = (supabase as unknown as { supabaseUrl: string }).supabaseUrl;
      const endpoint = `${projectUrl}/functions/v1/unsubscribe/${encodeURIComponent(token)}`;
      try {
        const resp = await fetch(endpoint, { method: 'GET' });
        const body = await resp.json().catch(() => ({}));
        if (cancelled) return;

        if (!resp.ok) {
          setState({
            kind: 'error',
            message: (body as { error?: string }).error ?? 'Unsubscribe failed.',
          });
          return;
        }

        const { audience, eventName } = body as {
          audience?: 'subscriber' | 'volunteer';
          eventName?: string;
        };
        setState({
          kind: 'success',
          eventName: eventName ?? 'this event',
          audience: audience === 'volunteer' ? 'volunteer' : 'subscriber',
        });
      } catch {
        if (cancelled) return;
        setState({ kind: 'error', message: 'Network error. Please try the link again.' });
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md">
        <Link to="/" className="flex items-center justify-center mb-8">
          <img src="/hereday-logo.png" alt="Hereday" className="h-14 w-auto" />
        </Link>

        <div className="rounded-xl border border-border bg-card p-8 text-center">
          {state.kind === 'loading' && (
            <>
              <Loader2 className="h-10 w-10 text-muted-foreground mx-auto animate-spin mb-4" />
              <h1 className="text-xl font-display font-semibold mb-2">Unsubscribing…</h1>
              <p className="text-sm text-muted-foreground">Just a moment.</p>
            </>
          )}

          {state.kind === 'success' && (
            <>
              <div className="h-12 w-12 rounded-full bg-emerald-100 dark:bg-emerald-950/40 mx-auto flex items-center justify-center mb-4">
                <Check className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
              </div>
              <h1 className="text-xl font-display font-semibold mb-2">You're unsubscribed</h1>
              <p className="text-sm text-muted-foreground mb-4">
                We'll no longer email you about <strong>{state.eventName}</strong>.
              </p>
              <p className="text-xs text-muted-foreground">
                Changed your mind? Reach out to the organizer directly — their email is in the
                last message you received from this event.
              </p>
            </>
          )}

          {state.kind === 'error' && (
            <>
              <div className="h-12 w-12 rounded-full bg-red-100 dark:bg-red-950/40 mx-auto flex items-center justify-center mb-4">
                <AlertCircle className="h-6 w-6 text-red-600 dark:text-red-400" />
              </div>
              <h1 className="text-xl font-display font-semibold mb-2">Something went wrong</h1>
              <p className="text-sm text-muted-foreground">{state.message}</p>
              <p className="text-xs text-muted-foreground mt-4">
                If the link is old, try opening the most recent email you received. Still stuck?{' '}
                <a href="mailto:hello@hereday.io" className="text-primary hover:underline">
                  hello@hereday.io
                </a>
              </p>
            </>
          )}
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6">
          &copy; {new Date().getFullYear()} Hereday LLC
        </p>
      </div>
    </div>
  );
};

export default Unsubscribe;
