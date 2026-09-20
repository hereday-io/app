import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Google Search Console metrics, proxied through the `search-console`
 * edge function (the service-account key never reaches the browser).
 *
 * `configured: false` is a normal response, not an error — it means the
 * GOOGLE_SERVICE_ACCOUNT_JSON secret isn't set yet, and the UI shows
 * setup instructions instead of a failed panel.
 */

export interface GscRow {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface SearchConsoleData {
  configured: boolean;
  error?: string;
  hint?: string;
  site_url?: string;
  range?: { start: string; end: string; days: number; lag_days: number };
  totals?: GscRow;
  prev_totals?: GscRow;
  by_day?: Array<GscRow & { day: string }>;
  top_queries?: Array<GscRow & { query: string }>;
  top_pages?: Array<GscRow & { page: string }>;
}

export interface GscSiteEntry {
  siteUrl: string;
  permissionLevel: string;
}

export interface GscSitesResult {
  service_account?: string;
  configured_site_url?: string;
  sites?: GscSiteEntry[];
  error?: string;
}

/**
 * Diagnostic: ask Google which properties this service account can
 * actually read. The answer settles "wrong property" vs "no permission"
 * in one call, and prints the exact string GSC_SITE_URL wants —
 * `sc-domain:example.com` for a domain property, `https://example.com/`
 * (trailing slash) for a URL-prefix one.
 */
export async function listSearchConsoleSites(): Promise<GscSitesResult> {
  const { data, error } = await supabase.functions.invoke('search-console', {
    body: { mode: 'sites' },
  });
  if (error) {
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === 'function') {
      try {
        return (await context.json()) as GscSitesResult;
      } catch {
        /* fall through */
      }
    }
    return { error: error.message };
  }
  return data as GscSitesResult;
}

export function useSearchConsole(days: number) {
  const [data, setData] = useState<SearchConsoleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data: result, error: fnError } = await supabase.functions.invoke('search-console', {
      body: { days },
    });

    if (fnError) {
      // supabase-js collapses any non-2xx into "Edge Function returned a
      // non-2xx status code", which tells you nothing. The real message
      // and hint are in the response body, which FunctionsHttpError
      // hands over untouched as `context`.
      let parsed: SearchConsoleData | null = null;
      const context = (fnError as { context?: Response }).context;
      if (context && typeof context.json === 'function') {
        try {
          parsed = (await context.json()) as SearchConsoleData;
        } catch {
          /* body wasn't JSON — fall back to the generic message */
        }
      }
      setData(parsed);
      setError(parsed?.error ?? fnError.message);
    } else {
      setData(result as SearchConsoleData);
      setError((result as SearchConsoleData)?.error ?? null);
    }
    setLoading(false);
  }, [days]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  return { data, loading, error, refresh: fetchData };
}
