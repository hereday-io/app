import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

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
};

export function useEventAnalytics(eventId: string | null) {
  const [data, setData] = useState<EventAnalytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!eventId) {
      setData(null);
      return;
    }

    setLoading(true);
    setError(null);

    supabase
      .rpc('get_event_analytics', { p_event_id: eventId })
      .then(({ data: result, error: rpcError }) => {
        if (rpcError) {
          setError(rpcError.message);
          setData(EMPTY);
        } else {
          // The function returns JSON — parse into our typed interface
          const parsed = (typeof result === 'string' ? JSON.parse(result) : result) as EventAnalytics;
          setData(parsed);
        }
        setLoading(false);
      });
  }, [eventId]);

  return { data, loading, error };
}
