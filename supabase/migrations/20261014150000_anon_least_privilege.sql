-- Least privilege for anon and authenticated across public (2026-10-13).
--
-- Supabase's default privileges grant anon and authenticated ALL on every
-- table and view in public, so RLS has been the only guard, and prod's
-- policies have drifted from the migration files (20261014140000). Two
-- things followed from that:
--
--   * public_events is an auto-updatable view with definer rights
--     (security_invoker = false, owned by postgres). anon's default
--     UPDATE/DELETE grant on it reached straight through to public.events
--     past RLS: PATCH or DELETE /rest/v1/public_events?id=eq.<id> could
--     rewrite or remove any published event. Prod answered 204 to a
--     zero-row probe on 2026-10-13.
--   * Any policy prod has that the files don't is invisible to review.
--     Taking away the privileges a role has no use for closes those
--     regardless of the policy's name.
--
-- So this migration grants each role exactly what the app uses and
-- nothing else. The signed-out surface, from src/, api/ and
-- supabase/functions (every edge function that touches tables uses the
-- service-role key, which is unaffected):
--
--   public_events      SELECT          /event/:slug, api/event/[slug].ts
--   product_events     INSERT          logEvent() on public pages
--   event_subscribers  INSERT          SubscribeButton, EventEndedView
--   poi_statuses       SELECT          usePoiStatuses (+ realtime)
--   tracking_sessions  INSERT, SELECT  useTracking / useTrackingSubscription
--                      (some columns)  (LIVE_TRACKING_ENABLED is off today)
--
-- It also tightens two policies anon reaches:
--   * product_events INSERT was WITH CHECK (true): anon could write
--     purchase_completed / purchase_refunded rows, which crm_get_deal
--     shows as app purchases and revenue queries count, and could stamp
--     any user_id on a row.
--   * poi_statuses SELECT was USING (true): anon could read aid-station
--     statuses, notes and volunteer names on draft events.
--
-- Apply on its own in the SQL editor; never `supabase db push`. It ends
-- with a check that refuses to commit if prod has any public policy this
-- file doesn't know about, so fill in section 0 from pg_policies first.
-- Tested by supabase/tests/anon_least_privilege.check.mjs.

BEGIN;

-- ── 0. Prod-only policies (not in any migration file) ────────────────
-- None. pg_policies on prod (2026-10-14) matched the migration chain
-- exactly: the same 25 policies, names and conditions. Grants matched
-- too, apart from the public_events hotfix below, and every public table
-- has RLS on without FORCE. Section 5 re-checks this at apply time.

-- ── 1. anon: revoke everything, grant back the five objects it uses ──
-- REVOKE ALL on a table also drops its column-level grants, so
-- tracking_sessions' column lists are restated below.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;

GRANT SELECT ON public.public_events TO anon;
GRANT INSERT ON public.product_events TO anon;
GRANT INSERT ON public.event_subscribers TO anon;
GRANT SELECT ON public.poi_statuses TO anon;
-- The runner sends these four (useTracking.ts). id and timestamps come
-- from defaults; positions and is_active only ever change through
-- update-tracking-ping, so a runner can't seed a fake position.
GRANT INSERT (event_id, runner_name, color, session_secret)
  ON public.tracking_sessions TO anon;
-- session_secret stays unselectable (20260501120000 C-3).
GRANT SELECT (
    id, event_id, runner_name, color, started_at, last_ping_at,
    last_lng, last_lat, is_active, created_at
  ) ON public.tracking_sessions TO anon;

-- New tables start with nothing for anon; a public flow has to GRANT
-- what it needs. Applies to tables created by the role running this
-- (postgres, which is who runs migrations in the SQL editor).
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;

-- ── 2. authenticated: drop what no policy or flow uses ───────────────
-- TRUNCATE ignores RLS, TRIGGER and REFERENCES have no use from the API.
REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM authenticated;

-- Writes through the definer view bypass events' RLS (see header).
-- Prod got this exact statement as a hotfix on 2026-10-13; repeated here
-- so the repo matches, and harmless to re-run.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES
  ON public.public_events FROM anon, authenticated, PUBLIC;

-- Commands with no policy for authenticated and no caller in src/.
-- Each is denied by RLS today; revoking means a stray or prod-only
-- policy can't open it later.
REVOKE DELETE                 ON public.comp_grants        FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.email_sends        FROM authenticated;
REVOKE DELETE                 ON public.event_subscribers  FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.event_transfers    FROM authenticated;
REVOKE UPDATE, DELETE         ON public.poi_status_history FROM authenticated;
REVOKE SELECT, UPDATE, DELETE ON public.pro_waitlist       FROM authenticated;
REVOKE UPDATE, DELETE         ON public.product_events     FROM authenticated;
REVOKE DELETE                 ON public.profiles           FROM authenticated;
REVOKE ALL                    ON public.scout_rate_limits  FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.tracking_sessions  FROM authenticated;
GRANT INSERT (event_id, runner_name, color, session_secret)
  ON public.tracking_sessions TO authenticated;

-- ── 3. Functions ─────────────────────────────────────────────────────
-- event_owner_is_paid() has had no caller since 20260411120000 and tells
-- anyone holding a user id whether that user has paid.
REVOKE ALL ON FUNCTION public.event_owner_is_paid(uuid) FROM PUBLIC, anon, authenticated;
-- Owner-only (raises otherwise) and a trigger function; neither is an
-- anon call. event_is_published / event_tracking_open stay: anon's
-- policies call them.
REVOKE ALL ON FUNCTION public.get_event_analytics(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- ── 4. Policies anon reaches ─────────────────────────────────────────
DROP POLICY IF EXISTS "Anyone can log product events" ON public.product_events;
CREATE POLICY "Anyone can log product events"
  ON public.product_events FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    (user_id IS NULL OR user_id = auth.uid())
    -- Written only by stripe-webhook with the service role.
    AND event_type NOT IN ('purchase_completed', 'purchase_refunded')
  );

-- Owners keep "Owners manage statuses on their events" (FOR ALL), so a
-- director still sees statuses on a draft in the Ops Center. The
-- volunteer page reads through resolve-status-token (service role).
DROP POLICY IF EXISTS "Anyone can read POI statuses" ON public.poi_statuses;
CREATE POLICY "Anyone can read POI statuses"
  ON public.poi_statuses FOR SELECT
  TO anon, authenticated
  USING (public.event_is_published(event_id));

-- ── 5. Refuse to commit on unknown policies ──────────────────────────
-- The full set of public policies after this file. Anything else in
-- prod is drift nobody has reviewed: add it to section 0 (or here, if
-- it's wanted) and re-run.
DO $$
DECLARE
  v_expected text[] := ARRAY[
    'comp_grants|Admins can insert comp grants',
    'comp_grants|Admins can read all comp grants',
    'comp_grants|Admins can update (revoke) comp grants',
    'email_sends|Owner can read send history',
    'event_subscribers|Anyone can subscribe to events',
    'event_subscribers|Owners can read their event subscribers',
    'event_subscribers|Owners can update their event subscribers',
    'event_transfers|Admins can read event transfers',
    'events|Users can create their own events',
    'events|Users can delete their own events',
    'events|Users can update their own events',
    'events|Users can view their own events',
    'poi_status_history|Organizers read their status history',
    'poi_status_history|Owners insert history for their events',
    'poi_statuses|Anyone can read POI statuses',
    'poi_statuses|Owners manage statuses on their events',
    'poi_volunteer_tokens|Event owners manage tokens',
    'pro_waitlist|Anyone can join the waitlist',
    'product_events|Anyone can log product events',
    'product_events|Users can read their own product events',
    'profiles|Users can insert their own profile',
    'profiles|Users can update their own profile',
    'profiles|Users can view their own profile',
    'tracking_sessions|Anyone can read tracking sessions for published events',
    'tracking_sessions|Anyone can start tracking within tracking window'
  ];
  v_unexpected text;
  v_missing text;
BEGIN
  SELECT string_agg(k, E'\n' ORDER BY k) INTO v_unexpected
  FROM (SELECT tablename || '|' || policyname AS k
          FROM pg_policies WHERE schemaname = 'public') p
  WHERE k <> ALL (v_expected);

  SELECT string_agg(k, E'\n' ORDER BY k) INTO v_missing
  FROM unnest(v_expected) AS k
  WHERE k NOT IN (SELECT tablename || '|' || policyname
                    FROM pg_policies WHERE schemaname = 'public');

  IF v_unexpected IS NOT NULL THEN
    RAISE EXCEPTION 'Unreviewed policies in public (nothing applied):%', E'\n' || v_unexpected;
  END IF;
  IF v_missing IS NOT NULL THEN
    RAISE NOTICE 'Expected policies not present:%', E'\n' || v_missing;
  END IF;
END $$;

COMMIT;
