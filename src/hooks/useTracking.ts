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
  position: { lng: number; lat: number; accuracy: number; speed: number | null } | null;
}

export function useTracking(eventId: string) {
  const [state, setState] = useState<TrackingState>({
    isTracking: false,
    error: null,
    position: null,
  });

  const sessionIdRef = useRef<string | null>(null);
  const sessionSecretRef = useRef<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const dbIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const latestPositionRef = useRef<{ lng: number; lat: number; accuracy: number; speed: number | null } | null>(null);
  const nameRef = useRef<string>('');
  const colorRef = useRef<string>('');

  const storageKey = `hereday:tracking:${eventId}`;

  // Persist last-known position to the DB via the update-tracking-ping
  // edge function. The function validates session_secret server-side
  // before writing; anon clients no longer have direct UPDATE rights on
  // tracking_sessions (see migration 20260501120000, fix C-3).
  const persistToDb = useCallback(async () => {
    const pos = latestPositionRef.current;
    const sid = sessionIdRef.current;
    const secret = sessionSecretRef.current;
    if (!pos || !sid || !secret) return;

    const { error } = await supabase.functions.invoke('update-tracking-ping', {
      body: {
        sessionId: sid,
        sessionSecret: secret,
        lng: pos.lng,
        lat: pos.lat,
      },
    });
    if (error) console.error('[useTracking] ping failed', error);
  }, []);

  // Send position via broadcast channel (called by watchPosition)
  const broadcastPosition = useCallback((lng: number, lat: number, accuracy: number, speed: number | null, heading: number | null) => {
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
        speed,
        heading,
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
    let sessionSecret: string | null = null;
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Verify the session still exists and is active. The secret
        // column is not selectable by anon (column-level GRANT) — we
        // restore it from localStorage on resume, where the original
        // create call wrote it.
        const { data } = await supabase.from('tracking_sessions')
          .select('id, is_active')
          .eq('id', parsed.sessionId)
          .single();
        if (data?.is_active && typeof parsed.sessionSecret === 'string') {
          sessionId = parsed.sessionId;
          sessionSecret = parsed.sessionSecret;
          nameRef.current = parsed.name || runnerName;
          colorRef.current = parsed.color || color;
        }
      }
    } catch { /* no stored session, create a new one */ }

    // Create a new session if we don't have one to resume.
    // Generate the session_secret client-side so it never traverses an
    // INSERT response (server doesn't echo it back). Persist to
    // localStorage immediately so a refresh mid-session can resume.
    if (!sessionId) {
      const generatedSecret = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
        ? crypto.randomUUID().replace(/-/g, '')
        : Math.random().toString(36).slice(2) + Date.now().toString(36);
      const { data, error: insertError } = await supabase.from('tracking_sessions')
        .insert({
          event_id: eventId,
          runner_name: runnerName,
          color,
          session_secret: generatedSecret,
        })
        .select('id')
        .single();

      if (insertError || !data) {
        setState(s => ({ ...s, error: 'Could not start tracking. Make sure this is a Pro event.' }));
        return;
      }
      sessionId = data.id as string;
      sessionSecret = generatedSecret;
      try {
        window.localStorage.setItem(storageKey, JSON.stringify({
          sessionId,
          sessionSecret: generatedSecret,
          name: runnerName,
          color,
        }));
      } catch { /* ignore storage errors */ }
    }

    sessionIdRef.current = sessionId;
    sessionSecretRef.current = sessionSecret;

    // Set up the broadcast channel
    const channel = supabase.channel(`tracking:${eventId}`);
    channel.subscribe();
    channelRef.current = channel;

    // Start geolocation watch
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { longitude: lng, latitude: lat, accuracy, speed, heading } = pos.coords;
        latestPositionRef.current = { lng, lat, accuracy, speed };
        setState(s => ({ ...s, position: { lng, lat, accuracy, speed } }));
        broadcastPosition(lng, lat, accuracy, speed, heading);
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

    // Final DB persist + mark inactive — also via the edge function so
    // the secret check applies (see persistToDb above).
    const sid = sessionIdRef.current;
    const secret = sessionSecretRef.current;
    if (sid && secret) {
      const pos = latestPositionRef.current;
      await supabase.functions.invoke('update-tracking-ping', {
        body: {
          sessionId: sid,
          sessionSecret: secret,
          ...(pos ? { lng: pos.lng, lat: pos.lat } : {}),
          isActive: false,
        },
      });
    }

    // Unsubscribe from channel
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    // Clear localStorage
    try { window.localStorage.removeItem(storageKey); } catch { /* ignore */ }

    sessionIdRef.current = null;
    sessionSecretRef.current = null;
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
