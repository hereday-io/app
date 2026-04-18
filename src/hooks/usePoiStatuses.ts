import { useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import type { PoiStatus } from '@/types/mapEditor';

/**
 * Live subscription to poi_statuses rows for a single event.
 *
 * Public-map viewers open this hook on mount; it does:
 *   1. Initial SELECT to hydrate the current state for late joiners
 *      (so a spectator who opens the page mid-race sees the right
 *      colors without waiting for the next volunteer update).
 *   2. postgres_changes subscription on INSERT/UPDATE/DELETE of
 *      poi_statuses filtered by event_id, merging into state as
 *      deltas arrive.
 *
 * Returns a Map keyed by poi_id. Consumers look up their POI's status
 * and update marker overlays / popover copy accordingly.
 *
 * Pattern mirrors useTrackingSubscription — same channel + cleanup
 * lifecycle, different subscription source (postgres_changes vs.
 * broadcast).
 */
export function usePoiStatuses(eventId: string | null, enabled: boolean = true) {
  const [statuses, setStatuses] = useState<Map<string, PoiStatus>>(new Map());
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    if (!eventId || !enabled) {
      setStatuses(new Map());
      return;
    }

    let cancelled = false;

    // 1. Hydrate initial state. Anon RLS allows SELECT on poi_statuses
    // so this works from the public map without auth.
    (async () => {
      const { data, error } = await supabase
        .from('poi_statuses')
        .select('*')
        .eq('event_id', eventId);
      if (cancelled) return;
      if (error) {
        console.warn('[usePoiStatuses] initial fetch failed', error);
        return;
      }
      const next = new Map<string, PoiStatus>();
      for (const row of (data ?? []) as PoiStatus[]) {
        next.set(row.poi_id, row);
      }
      setStatuses(next);
    })();

    // 2. Subscribe to realtime changes.
    const channel = supabase
      .channel(`poi-statuses:${eventId}`)
      .on(
        // @ts-expect-error — supabase-js v2 typings for postgres_changes
        // expect a narrow literal and get picky; runtime is correct.
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'poi_statuses',
          filter: `event_id=eq.${eventId}`,
        },
        (payload: {
          eventType: 'INSERT' | 'UPDATE' | 'DELETE';
          new: PoiStatus | null;
          old: PoiStatus | null;
        }) => {
          setStatuses((prev) => {
            const next = new Map(prev);
            if (payload.eventType === 'DELETE') {
              const id = payload.old?.poi_id;
              if (id) next.delete(id);
            } else if (payload.new) {
              next.set(payload.new.poi_id, payload.new);
            }
            return next;
          });
        },
      );

    channel.subscribe();
    channelRef.current = channel;

    return () => {
      cancelled = true;
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [eventId, enabled]);

  return statuses;
}
