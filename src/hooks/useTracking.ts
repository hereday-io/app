import { useState, useRef, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { RealtimeChannel } from '@supabase/supabase-js';

// Distinct color palette so multiple runners are easy to tell apart
const RUNNER_COLORS = [
  '#2563eb', '#dc2626', '#16a34a', '#d97706', '#9333ea',
  '#0891b2', '#e11d48', '#4f46e5', '#ca8a04', '#059669',
];

function pickColor(): string {
  return RUNNER_COLORS[Math.floor(Math.random() * RUNNER_COLORS.length)];
}

interface TrackingState {
  isTracking: boolean;
  error: string | null;
  position: { lng: number; lat: number; accuracy: number } | null;
}

export function useTracking(eventId: string) {
  const [state, setState] = useState<TrackingState>({
    isTracking: false,
    error: null,
    position: null,
  });

  const sessionIdRef = useRef<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const dbIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const latestPositionRef = useRef<{ lng: number; lat: number; accuracy: number } | null>(null);
  const nameRef = useRef<string>('');
  const colorRef = useRef<string>('');

  const storageKey = `hereday:tracking:${eventId}`;

  // Persist last-known position to the DB (called every ~30s)
  const persistToDb = useCallback(async () => {
    const pos = latestPositionRef.current;
    const sid = sessionIdRef.current;
    if (!pos || !sid) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('tracking_sessions' as any) as any)
      .update({
        last_lng: pos.lng,
        last_lat: pos.lat,
        last_ping_at: new Date().toISOString(),
      })
      .eq('id', sid);
  }, []);

  // Send position via broadcast channel (called by watchPosition)
  const broadcastPosition = useCallback((lng: number, lat: number, accuracy: number) => {
    const channel = channelRef.current;
    if (!channel) return;
    channel.send({
      type: 'broadcast',
      event: 'position',
      payload: {
        sessionId: sessionIdRef.current,
        name: nameRef.current,
        color: colorRef.current,
        lng,
        lat,
        accuracy,
        timestamp: Date.now(),
      },
    });
  }, []);

  const startTracking = useCallback(async (runnerName: string) => {
    setState(s => ({ ...s, error: null }));

    // Check for geolocation support
    if (!navigator.geolocation) {
      setState(s => ({ ...s, error: 'Geolocation is not supported by this browser.' }));
      return;
    }

    const color = pickColor();
    nameRef.current = runnerName;
    colorRef.current = color;

    // Check for an existing session in localStorage (resume after tab close)
    let sessionId: string | null = null;
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Verify the session still exists and is active
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data } = await (supabase.from('tracking_sessions' as any) as any)
          .select('id, is_active')
          .eq('id', parsed.sessionId)
          .single();
        if (data?.is_active) {
          sessionId = parsed.sessionId;
          nameRef.current = parsed.name || runnerName;
          colorRef.current = parsed.color || color;
        }
      }
    } catch { /* no stored session, create a new one */ }

    // Create a new session if we don't have one to resume
    if (!sessionId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error: insertError } = await (supabase.from('tracking_sessions' as any) as any)
        .insert({
          event_id: eventId,
          runner_name: runnerName,
          color,
        })
        .select('id')
        .single();

      if (insertError || !data) {
        setState(s => ({ ...s, error: 'Could not start tracking. Make sure this is a Pro event.' }));
        return;
      }
      sessionId = data.id as string;
      try {
        window.localStorage.setItem(storageKey, JSON.stringify({
          sessionId,
          name: runnerName,
          color,
        }));
      } catch { /* ignore storage errors */ }
    }

    sessionIdRef.current = sessionId;

    // Set up the broadcast channel
    const channel = supabase.channel(`tracking:${eventId}`);
    channel.subscribe();
    channelRef.current = channel;

    // Start geolocation watch
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { longitude: lng, latitude: lat, accuracy } = pos.coords;
        latestPositionRef.current = { lng, lat, accuracy };
        setState(s => ({ ...s, position: { lng, lat, accuracy } }));
        broadcastPosition(lng, lat, accuracy);
      },
      (err) => {
        let msg = 'Location error.';
        if (err.code === err.PERMISSION_DENIED) msg = 'Location permission denied. Please allow location access.';
        else if (err.code === err.POSITION_UNAVAILABLE) msg = 'Location unavailable. Try moving to an open area.';
        else if (err.code === err.TIMEOUT) msg = 'Location request timed out.';
        setState(s => ({ ...s, error: msg }));
      },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 },
    );

    // Persist to DB every 30 seconds
    dbIntervalRef.current = setInterval(persistToDb, 30_000);

    setState(s => ({ ...s, isTracking: true }));
  }, [eventId, storageKey, broadcastPosition, persistToDb]);

  const stopTracking = useCallback(async () => {
    // Stop geolocation
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    // Stop DB interval
    if (dbIntervalRef.current) {
      clearInterval(dbIntervalRef.current);
      dbIntervalRef.current = null;
    }

    // Final DB persist + mark inactive
    const sid = sessionIdRef.current;
    if (sid) {
      const pos = latestPositionRef.current;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('tracking_sessions' as any) as any)
        .update({
          is_active: false,
          ...(pos ? { last_lng: pos.lng, last_lat: pos.lat } : {}),
          last_ping_at: new Date().toISOString(),
        })
        .eq('id', sid);
    }

    // Unsubscribe from channel
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    // Clear localStorage
    try { window.localStorage.removeItem(storageKey); } catch { /* ignore */ }

    sessionIdRef.current = null;
    latestPositionRef.current = null;
    setState({ isTracking: false, error: null, position: null });
  }, [storageKey]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
      if (dbIntervalRef.current) clearInterval(dbIntervalRef.current);
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, []);

  return {
    ...state,
    startTracking,
    stopTracking,
  };
}
