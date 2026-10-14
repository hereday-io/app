import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Site traffic from PostHog, proxied through the `posthog-traffic` edge
 * function (the personal API key can read every PostHog project the
 * owner can, so it never reaches the browser).
 *
 * `configured: false` is a normal response, not an error — it means the
 * function's PostHog secrets aren't set yet, and the UI shows setup
 * steps instead of a failed panel.
 */

export interface TrafficTotals {
  pageviews: number;
  visitors: number;
  sessions: number;
}

export interface PostHogTrafficData {
  configured: boolean;
  error?: string;
  hint?: string;
  days?: number;
  app_url?: string;
  totals?: TrafficTotals;
  prev_totals?: TrafficTotals;
  /** Earliest pageview across this window and the one before (ISO). */
  first_seen?: string | null;
  by_day?: Array<{ day: string; pageviews: number; visitors: number }>;
  top_pages?: Array<{ path: string; pageviews: number; visitors: number }>;
  top_referrers?: Array<{ domain: string; sessions: number; visitors: number }>;
}

export function usePostHogTraffic(days: number) {
  const [data, setData] = useState<PostHogTrafficData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data: result, error: fnError } = await supabase.functions.invoke('posthog-traffic', {
      body: { days },
    });

    if (fnError) {
      // supabase-js collapses any non-2xx into a generic message; the
      // real error and hint are in the body FunctionsHttpError carries
      // as `context`.
      let parsed: PostHogTrafficData | null = null;
      const context = (fnError as { context?: Response }).context;
      if (context && typeof context.json === 'function') {
        try {
          parsed = (await context.json()) as PostHogTrafficData;
        } catch {
          /* body wasn't JSON — fall back to the generic message */
        }
      }
      setData(parsed);
      setError(parsed?.error ?? fnError.message);
    } else {
      setData(result as PostHogTrafficData);
      setError((result as PostHogTrafficData)?.error ?? null);
    }
    setLoading(false);
  }, [days]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  return { data, loading, error, refresh: fetchData };
}
