import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

const POLL_INTERVAL_MS = 30_000; // refresh every 30s while open

export interface SponsorStat {
  poi_id: string;
  title: string;
  logo_url: string | null;
  brand_color: string | null;
  impressions: number;
  clicks: number;
  promo_copies: number;
}

export interface EventAnalytics {
  views_total: number;
  views_runner: number;
  views_spectator: number;
  subscribers_total: number;
  qr_generated: number;
  qr_downloaded: number;
  tracking_sessions: number;
  tracking_runners: number;
  views_by_day: Array<{ day: string; count: number }>;
  sponsors: SponsorStat[];
}

const EMPTY: EventAnalytics = {
  views_total: 0,
  views_runner: 0,
  views_spectator: 0,
  subscribers_total: 0,
  qr_generated: 0,
  qr_downloaded: 0,
  tracking_sessions: 0,
  tracking_runners: 0,
  views_by_day: [],
  sponsors: [],
};

export function useEventAnalytics(eventId: string | null) {
  const [data, setData] = useState<EventAnalytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback((showLoading: boolean) => {
    if (!eventId) return;
    if (showLoading) setLoading(true);
    setError(null);

    supabase
      .rpc('get_event_analytics', { p_event_id: eventId })
      .then(({ data: result, error: rpcError }) => {
        if (rpcError) {
          setError(rpcError.message);
          setData(EMPTY);
        } else {
          const parsed = (typeof result === 'string' ? JSON.parse(result) : result) as Partial<EventAnalytics>;
          // Defensive defaults — if the SQL function is stale (pre
          // sponsor-aggregates migration) it won't return `sponsors`.
          setData({ ...EMPTY, ...parsed, sponsors: parsed.sponsors ?? [] });
        }
        setLoading(false);
      });
  }, [eventId]);

  // Initial fetch
  useEffect(() => {
    if (!eventId) {
      setData(null);
      return;
    }
    fetch(true);
  }, [eventId, fetch]);

  // Poll every 30s while open
  useEffect(() => {
    if (!eventId) return;
    const timer = setInterval(() => fetch(false), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [eventId, fetch]);

  return { data, loading, error };
}
