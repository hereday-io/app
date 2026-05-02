-- Pre-launch security hardening (2026-05-01)
--
-- Plugs four critical RLS / data-integrity holes surfaced by the
-- pre-launch security review (see agents/pre_launch_readiness_2026-05-01.md).
--
--   C-1: events table column leak via direct PostgREST query
--   C-2: volunteer/scout token enumeration via direct PostgREST query
--   C-3: tracking_sessions row hijack via broad anon UPDATE
--   C-4: client-only Pro gating allowed free users to set branding /
--        logo / route / POI counts beyond free-tier limits

-- ─────────────────────────────────────────────────────────────────────
-- C-1: events table anon column leak
-- ─────────────────────────────────────────────────────────────────────
-- The previous policy granted SELECT to anon on the events table with
-- only a status='published' filter. Anon could ?select=* and read
-- stripe_session_id, paid_at, plan, emergency_contacts, volunteer_roster,
-- scouted_pois — bypassing the column projection that the public_events
-- view was meant to provide.
--
-- Fix: drop the table-level anon policy and switch the view to security
-- definer mode so it bypasses RLS using the view-owner's privileges.
-- Anon callers can still SELECT through the view (granted below) but
-- can no longer hit the underlying table directly.

DROP POLICY IF EXISTS "Anon can read published events (via view)" ON public.events;

ALTER VIEW public.public_events SET (security_invoker = false);

GRANT SELECT ON public.public_events TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- C-2: volunteer / scout token enumeration
-- ─────────────────────────────────────────────────────────────────────
-- The "Anon can read a live token by PK" policy filtered only on
-- revoked_at IS NULL — no PK predicate. Anon could dump every active
-- volunteer / scout token across all events. Each token unlocks
-- submit-scouted-poi (mutate scouted_pois) and update-poi-status
-- (mutate poi_statuses).
--
-- Fix: drop the policy. Token validation already runs server-side via
-- service role inside the resolve-* and submit-* edge functions.

DROP POLICY IF EXISTS "Anon can read a live token by PK" ON public.poi_volunteer_tokens;

-- ─────────────────────────────────────────────────────────────────────
-- C-3: tracking session hijack
-- ─────────────────────────────────────────────────────────────────────
-- The previous UPDATE policy was FOR UPDATE TO anon, authenticated
-- USING (true) WITH CHECK (true). Combined with the broad SELECT policy
-- that returns session UUIDs to spectators, any spectator could PATCH
-- any runner's tracking row to redirect their GPS pin anywhere on the
-- map. The "UUIDs are unguessable" comment was wrong — the UUID is
-- exposed in SELECT to spectators.
--
-- Fix:
--   1. Add session_secret column (NOT NULL after backfill).
--   2. Drop the broad UPDATE policy. All updates now go through the
--      update-tracking-ping edge function, which validates the secret
--      and writes via service role.
--   3. Restrict anon SELECT to non-secret columns via column-level
--      GRANT so the secret is never visible to spectators.

DROP POLICY IF EXISTS "Session owner can update their session" ON public.tracking_sessions;

ALTER TABLE public.tracking_sessions
  ADD COLUMN IF NOT EXISTS session_secret TEXT;

UPDATE public.tracking_sessions
SET session_secret = encode(gen_random_bytes(16), 'hex')
WHERE session_secret IS NULL;

ALTER TABLE public.tracking_sessions
  ALTER COLUMN session_secret SET NOT NULL;

-- Column-level grant restricts anon / authenticated SELECT to the
-- spectator-facing fields only. session_secret is not in this list and
-- therefore not selectable. INSERTs are still allowed via the existing
-- "Anyone can start tracking on published pro events" policy; the new
-- column will be set in that INSERT body.
REVOKE SELECT ON public.tracking_sessions FROM anon, authenticated;
GRANT SELECT (
    id, event_id, runner_name, color, started_at, last_ping_at,
    last_lng, last_lat, is_active, created_at
  ) ON public.tracking_sessions TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- C-4: server-side enforcement of Pro feature gates
-- ─────────────────────────────────────────────────────────────────────
-- Free users could PATCH /events?id=eq.<own> setting branding_style,
-- logo_url, or growing routes / pois beyond free-tier limits — the
-- existing RLS policies allow owners to update any column on their own
-- rows, and the limits were only enforced client-side via usePaywall.
--
-- Fix: BEFORE INSERT/UPDATE trigger that rejects changes which violate
-- free-tier limits when paid_at IS NULL. The trigger tolerates legacy
-- state on UPDATE — it only blocks transitions that would *introduce* a
-- new violation, not no-op updates that preserve existing data.

CREATE OR REPLACE FUNCTION public.enforce_pro_event_gates()
RETURNS TRIGGER AS $$
DECLARE
  v_route_count INT;
  v_poi_count   INT;
BEGIN
  -- Pro events are exempt — the moment paid_at is set, all gates lift.
  IF NEW.paid_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Branding style: anything other than 'none' or NULL is Pro-only.
  IF (NEW.branding_style IS NOT NULL AND NEW.branding_style != 'none')
     AND (TG_OP = 'INSERT' OR COALESCE(OLD.branding_style, 'none') = 'none') THEN
    RAISE EXCEPTION 'Custom branding requires Pro upgrade ($49 per event)'
      USING ERRCODE = 'P0001';
  END IF;

  -- Logo URL: setting any non-empty logo_url on a free event is Pro-only.
  IF (NEW.logo_url IS NOT NULL AND NEW.logo_url != '')
     AND (TG_OP = 'INSERT' OR COALESCE(OLD.logo_url, '') = '') THEN
    RAISE EXCEPTION 'Custom logo requires Pro upgrade ($49 per event)'
      USING ERRCODE = 'P0001';
  END IF;

  -- Route count: max 3 on free.
  v_route_count := COALESCE(jsonb_array_length(NEW.routes), 0);
  IF v_route_count > 3
     AND (TG_OP = 'INSERT' OR COALESCE(jsonb_array_length(OLD.routes), 0) <= 3) THEN
    RAISE EXCEPTION 'Free tier limited to 3 routes per event. Upgrade to Pro for unlimited.'
      USING ERRCODE = 'P0001';
  END IF;

  -- POI count: max 30 on free.
  v_poi_count := COALESCE(jsonb_array_length(NEW.pois), 0);
  IF v_poi_count > 30
     AND (TG_OP = 'INSERT' OR COALESCE(jsonb_array_length(OLD.pois), 0) <= 30) THEN
    RAISE EXCEPTION 'Free tier limited to 30 markers per event. Upgrade to Pro for unlimited.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_pro_gates ON public.events;
CREATE TRIGGER enforce_pro_gates
  BEFORE INSERT OR UPDATE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_pro_event_gates();

-- ─────────────────────────────────────────────────────────────────────
-- H-1: Stripe webhook event-id replay guard
-- ─────────────────────────────────────────────────────────────────────
-- The webhook is signature-verified and idempotent on the success path
-- via COALESCE(paid_at), but refund-then-recharge cycles could race.
-- Add a processed-events ledger so the function can short-circuit
-- duplicate deliveries cheaply and predictably.

CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (
  event_id     TEXT PRIMARY KEY,
  event_type   TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index on event_type so we can audit "how many refunds did we process
-- last week?" without scanning the whole table.
CREATE INDEX IF NOT EXISTS stripe_webhook_events_type_processed_idx
  ON public.stripe_webhook_events (event_type, processed_at DESC);

ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;

-- No SELECT or INSERT policy — service role only (used by the webhook
-- function with full bypass). Defensive grant: revoke from anon to make
-- the intent explicit even though no policy permits access.
REVOKE ALL ON public.stripe_webhook_events FROM anon, authenticated;
