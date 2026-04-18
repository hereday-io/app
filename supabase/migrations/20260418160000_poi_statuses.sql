-- Live-status POIs — volunteer-driven state for aid stations, water
-- stations, parking, etc. Organizer generates a volunteer link (a
-- `poi_volunteer_tokens` row with purpose='status', already scaffolded
-- in the earlier scout migration), volunteers mark Open / Low / Closed
-- / Moved from a mobile URL, and the public map reflects it in real
-- time via postgres_changes subscription.
--
-- Two tables:
--   poi_statuses        — current state per POI (one row per POI)
--   poi_status_history  — append-only audit log of every change
--
-- POI ids are TEXT because POIs live inside the events.pois JSON column
-- rather than a relational table — there's nothing to FK to. The
-- composite PK (event_id, poi_id) ensures uniqueness.

-- ── poi_statuses: current state ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.poi_statuses (
  event_id          UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  poi_id            TEXT NOT NULL,
  state             TEXT NOT NULL CHECK (state IN ('open', 'low', 'closed', 'moved')),
  note              TEXT,
  -- When state='moved', volunteer can optionally specify where the POI
  -- actually is now. Public map renders a ghosted original + new pin.
  moved_to_lng      DOUBLE PRECISION,
  moved_to_lat      DOUBLE PRECISION,
  updated_by_name   TEXT,
  updated_via_token TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, poi_id)
);

-- Realtime subscribers filter by event_id — this is the hot read path.
CREATE INDEX IF NOT EXISTS idx_poi_statuses_event
  ON public.poi_statuses (event_id);

-- ── poi_status_history: audit log ────────────────────────────────────
-- Append-only. Analytics panel reads this to render the timeline
-- ("water ran low at mile 6 at 10:42"). IP is captured for abuse
-- investigation but never surfaced in the UI.
CREATE TABLE IF NOT EXISTS public.poi_status_history (
  id                BIGSERIAL PRIMARY KEY,
  event_id          UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  poi_id            TEXT NOT NULL,
  state             TEXT NOT NULL CHECK (state IN ('open', 'low', 'closed', 'moved')),
  note              TEXT,
  moved_to_lng      DOUBLE PRECISION,
  moved_to_lat      DOUBLE PRECISION,
  updated_by_name   TEXT,
  updated_via_token TEXT,
  updated_ip        INET,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_poi_status_history_event_time
  ON public.poi_status_history (event_id, created_at DESC);

-- ── RLS ──────────────────────────────────────────────────────────────
ALTER TABLE public.poi_statuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.poi_status_history ENABLE ROW LEVEL SECURITY;

-- poi_statuses: anon SELECT so the public map can subscribe to
-- postgres_changes without authentication. Event ownership check would
-- require joining to events on every row, which also blocks realtime
-- from delivering updates to anon subscribers — not worth the cost for
-- data that's intended to be publicly visible anyway.
DROP POLICY IF EXISTS "Anyone can read POI statuses" ON public.poi_statuses;
CREATE POLICY "Anyone can read POI statuses"
  ON public.poi_statuses
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Writes go through edge functions using the service-role key, which
-- bypasses RLS. No INSERT/UPDATE/DELETE policies are granted to anon or
-- authenticated — tokens (validated server-side) are the only path to
-- mutations.

-- poi_status_history: organizer-only reads (for analytics timeline).
DROP POLICY IF EXISTS "Organizers read their status history" ON public.poi_status_history;
CREATE POLICY "Organizers read their status history"
  ON public.poi_status_history
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = poi_status_history.event_id
        AND e.user_id = auth.uid()
    )
  );

-- ── Realtime ─────────────────────────────────────────────────────────
-- Add the current-state table to the `supabase_realtime` publication
-- so postgres_changes subscriptions fire on INSERT/UPDATE/DELETE. The
-- history table is NOT published — nobody subscribes to it.
ALTER PUBLICATION supabase_realtime ADD TABLE public.poi_statuses;

-- REPLICA IDENTITY FULL so UPDATE events carry both old and new rows,
-- which the client hook uses to surface state transitions.
ALTER TABLE public.poi_statuses REPLICA IDENTITY FULL;
