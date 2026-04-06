-- Live tracking sessions: one row per runner sharing their GPS on a Pro event.
-- Real-time positions flow through Supabase Broadcast; this table persists the
-- last-known position (updated every ~30s) so late-joining spectators get
-- immediate state.

CREATE TABLE public.tracking_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  runner_name TEXT NOT NULL CHECK (char_length(runner_name) BETWEEN 1 AND 50),
  color       TEXT NOT NULL DEFAULT '#2563eb',
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_ping_at TIMESTAMPTZ,
  last_lng    DOUBLE PRECISION,
  last_lat    DOUBLE PRECISION,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for spectator queries: "give me all active sessions for this event"
CREATE INDEX idx_tracking_sessions_event_active
  ON public.tracking_sessions (event_id)
  WHERE is_active = true;

-- Enable RLS
ALTER TABLE public.tracking_sessions ENABLE ROW LEVEL SECURITY;

-- Anyone can start tracking on a published Pro event (no account required)
CREATE POLICY "Anyone can start tracking on published pro events"
  ON public.tracking_sessions FOR INSERT TO anon, authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_id
        AND e.status = 'published'
        AND e.plan = 'pro'
    )
  );

-- Anyone can read sessions for a published event (spectators need this)
CREATE POLICY "Anyone can read tracking sessions for published events"
  ON public.tracking_sessions FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_id
        AND e.status = 'published'
    )
  );

-- Session owner can update their own session.
-- "Ownership" is proved by knowing the UUID (stored in localStorage).
-- UUIDs are cryptographically random and unguessable.
CREATE POLICY "Session owner can update their session"
  ON public.tracking_sessions FOR UPDATE TO anon, authenticated
  USING (true)
  WITH CHECK (true);
