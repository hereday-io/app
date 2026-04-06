import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { RunnerPosition } from '@/types/mapEditor';

const STALE_THRESHOLD_MS = 60_000; // runner gone for 60s → remove

export function useTrackingSubscription(eventId: string, enabled: boolean) {
  const [runners, setRunners] = useState<Map<string, RunnerPosition>>(new Map());
  const channelRef = useRef<RealtimeChannel | null>(null);
  const staleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Prune runners that haven't sent a ping in 60 seconds
  const pruneStale = useCallback(() => {
    const now = Date.now();
    setRunners(prev => {
      let changed = false;
      const next = new Map(prev);
      for (const [id, runner] of next) {
        if (now - runner.timestamp > STALE_THRESHOLD_MS) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  useEffect(() => {
    if (!enabled) return;

    // 1. Fetch active sessions from the DB for late-joining spectators
    const fetchInitial = async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase.from('tracking_sessions' as any) as any)
        .select('id, runner_name, color, last_lng, last_lat, last_ping_at')
        .eq('event_id', eventId)
        .eq('is_active', true);

      if (data && data.length > 0) {
        const initial = new Map<string, RunnerPosition>();
        for (const row of data) {
          if (row.last_lng != null && row.last_lat != null) {
            initial.set(row.id, {
              sessionId: row.id,
              name: row.runner_name,
              color: row.color,
              lng: row.last_lng,
              lat: row.last_lat,
              accuracy: 0,
              timestamp: row.last_ping_at ? new Date(row.last_ping_at).getTime() : Date.now(),
            });
          }
        }
        if (initial.size > 0) setRunners(initial);
      }
    };

    fetchInitial();

    // 2. Subscribe to broadcast channel for real-time updates
    const channel = supabase.channel(`tracking:${eventId}`);

    channel.on('broadcast', { event: 'position' }, (msg) => {
      const p = msg.payload as RunnerPosition;
      if (!p?.sessionId) return;
      setRunners(prev => {
        const next = new Map(prev);
        next.set(p.sessionId, p);
        return next;
      });
    });

    channel.subscribe();
    channelRef.current = channel;

    // 3. Prune stale runners every 15 seconds
    staleTimerRef.current = setInterval(pruneStale, 15_000);

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      if (staleTimerRef.current) {
        clearInterval(staleTimerRef.current);
        staleTimerRef.current = null;
      }
      setRunners(new Map());
    };
  }, [eventId, enabled, pruneStale]);

  return { runners };
}
