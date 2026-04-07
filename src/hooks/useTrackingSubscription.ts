import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { RunnerPosition } from '@/types/mapEditor';

const NO_PING_MS = 60_000;          // no broadcast at all for 60s → connection lost
const NO_MOVE_MS = 5 * 60_000;      // position hasn't changed for 5 min → runner stopped
const MOVE_EPSILON = 0.0001;         // ~10 m — ignore jitter when checking "moved"
const MAX_SPEED_MS = 12.5;           // ~28 mph — anything above is GPS glitch

export function useTrackingSubscription(eventId: string, enabled: boolean) {
  const [runners, setRunners] = useState<Map<string, RunnerPosition>>(new Map());
  const channelRef = useRef<RealtimeChannel | null>(null);
  const staleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Track when each runner last *actually moved* (not just pinged)
  const lastMovedRef = useRef<Map<string, { lng: number; lat: number; time: number }>>(new Map());

  // Prune stale runners: no ping for 60s OR no movement for 5 min
  const pruneStale = useCallback(() => {
    const now = Date.now();
    setRunners(prev => {
      let changed = false;
      const next = new Map(prev);
      for (const [id, runner] of next) {
        const noPing = now - runner.timestamp > NO_PING_MS;
        const moved = lastMovedRef.current.get(id);
        const noMove = moved ? now - moved.time > NO_MOVE_MS : false;
        if (noPing || noMove) {
          next.delete(id);
          lastMovedRef.current.delete(id);
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
      const { data } = await supabase.from('tracking_sessions')
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
              speed: null,
              heading: null,
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

      // Ignore GPS glitches (unrealistic speed)
      if (p.speed != null && p.speed > MAX_SPEED_MS) return;

      // Track last-moved time
      const prev = lastMovedRef.current.get(p.sessionId);
      const moved = !prev
        || Math.abs(p.lng - prev.lng) > MOVE_EPSILON
        || Math.abs(p.lat - prev.lat) > MOVE_EPSILON;
      if (moved) {
        lastMovedRef.current.set(p.sessionId, { lng: p.lng, lat: p.lat, time: Date.now() });
      }

      setRunners(r => {
        const next = new Map(r);
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
