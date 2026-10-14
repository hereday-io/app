-- Close anonymous direct SELECT on public.events.
--
-- Found 2026-10-13: an anon REST call to /rest/v1/events?select=… returned
-- every published row with user_id, paid_at, stripe_session_id,
-- volunteer_roster and scouted_pois. 20260501120000 (C-1) meant to close
-- this by dropping "Anon can read published events (via view)" by name,
-- but prod's policy is "Public can view published events", so the drop
-- was a no-op.
-- public_events has been a definer-rights view since that migration, so
-- the public page, /api/event/[slug] and the sitemap never needed anon
-- access to the base table. Every edge function that reads events uses
-- the service-role key.
--
-- What did depend on it: three anon-facing policies on other tables
-- check "is this event published" with EXISTS (SELECT … FROM events).
-- A subquery inside a policy runs as the caller, under events' own RLS,
-- so with the anon policy gone those checks see no rows and the public
-- page's Subscribe button and live tracking (start + spectator view)
-- fail. They move to SECURITY DEFINER helpers that answer one yes/no
-- question about one event id and expose no columns.
--
-- Owners keep "Users can … their own events" (auth.uid() = user_id);
-- admin and sales reach events only through SECURITY DEFINER RPCs.
--
-- Apply on its own in the SQL editor; never `supabase db push`.
-- Tested by supabase/tests/events_anon_select.check.mjs.

-- ── 1. Helpers the anon-facing policies call ─────────────────────────
-- Owned by postgres (events' owner), so they read events past RLS.
-- They reveal no more than public_events already does: whether an id is
-- a published event, and whether its tracking window is open on a Pro
-- event (public_events carries tracking_start/tracking_end/owner_is_paid).

CREATE OR REPLACE FUNCTION public.event_is_published(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = p_event_id AND e.status = 'published'
  );
$$;

CREATE OR REPLACE FUNCTION public.event_tracking_open(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = p_event_id
      AND e.status = 'published'
      AND e.paid_at IS NOT NULL
      AND e.tracking_start IS NOT NULL
      AND e.tracking_end IS NOT NULL
      AND now() >= e.tracking_start
      AND now() <= e.tracking_end
  );
$$;

REVOKE ALL ON FUNCTION public.event_is_published(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.event_tracking_open(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_is_published(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_tracking_open(uuid) TO anon, authenticated;

-- ── 2. Re-point the anon-facing policies at the helpers ──────────────
-- Same names, roles and conditions as before; only the events lookup
-- moves inside the definer function.

DROP POLICY IF EXISTS "Anyone can subscribe to events" ON public.event_subscribers;
CREATE POLICY "Anyone can subscribe to events"
  ON public.event_subscribers
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (public.event_is_published(event_id));

DROP POLICY IF EXISTS "Anyone can read tracking sessions for published events" ON public.tracking_sessions;
CREATE POLICY "Anyone can read tracking sessions for published events"
  ON public.tracking_sessions
  FOR SELECT
  TO anon, authenticated
  USING (public.event_is_published(event_id));

DROP POLICY IF EXISTS "Anyone can start tracking within tracking window" ON public.tracking_sessions;
CREATE POLICY "Anyone can start tracking within tracking window"
  ON public.tracking_sessions
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (public.event_tracking_open(event_id));

-- ── 3. Drop the anon SELECT on the base table ────────────────────────
-- Prod's policy (pg_policies, 2026-10-13): TO anon, authenticated USING
-- (status = 'published'). No migration file created it, so it also let any
-- signed-in user read other directors' rows. The other two are every name
-- the migration files ever used for it, dropped in case they linger.
DROP POLICY IF EXISTS "Public can view published events" ON public.events;
DROP POLICY IF EXISTS "Published events are viewable by everyone" ON public.events;
DROP POLICY IF EXISTS "Anon can read published events (via view)" ON public.events;

-- ── 4. Take anon's table privileges away too ─────────────────────────
-- Supabase's default grants gave anon ALL on events, leaving RLS as the
-- only guard, which is how one stray policy exposed every column. Nothing
-- anon does needs them now: public_events and the helpers above run as
-- their owner, and FK checks on subscribe/tracking inserts run as the
-- referenced table's owner. With this, a policy re-added in the dashboard
-- still can't hand events to anon. Authenticated keeps its grants; owners
-- write through them, and RLS scopes them to auth.uid().
REVOKE ALL ON public.events FROM anon;

-- The view must keep definer rights or the public page goes blank.
ALTER VIEW public.public_events SET (security_invoker = false);
