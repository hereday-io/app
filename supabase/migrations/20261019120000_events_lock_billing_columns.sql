-- Owners may not write their own event's billing columns.
--
-- Why: the events UPDATE and INSERT policies check only the row
-- (auth.uid() = user_id), and Supabase grants every column of every
-- public table to `authenticated`. So a signed-in director could PATCH
-- /rest/v1/events?id=eq.<own> with paid_at=now() (or INSERT an event
-- with paid_at set) and get Pro without paying. paid_at is the only Pro
-- gate (isPro(), public_events.owner_is_paid, enforce_pro_event_gates,
-- tracking_sessions). profiles got the same lockdown in 20261013120000;
-- events never did.
--
-- Columns: paid_at, plan, comp_grant_id, stripe_session_id,
-- stripe_payment_id. The browser never writes any of them
-- (CreateEventDialog, DuplicateEventDialog, EditEventDialog,
-- RouteEditor, EventOpsCenter all leave them alone).
--
-- Fix: a BEFORE INSERT OR UPDATE trigger rather than column grants,
-- because the browser writes many other events columns and a grant list
-- would have to track every one of them. It refuses changes only when
-- the statement runs as anon or authenticated. Everything that may set
-- these columns runs as someone else and is unaffected:
--   * stripe-webhook: the service role
--   * comp grants apply / revoke: SECURITY DEFINER (runs as owner)
--   * admin_transfer_event: SECURITY DEFINER
--   * "00_stamp_comp_on_new_event": made SECURITY DEFINER below
-- This trigger is named "000_…" so it fires before the comp stamp
-- (triggers fire in name order) and only sees what the client sent.
--
-- The guard function itself must stay SECURITY INVOKER: current_user is
-- how it tells the caller apart.
--
-- Also fixed here: stamp_comp_on_new_event was SECURITY INVOKER, so it
-- read comp_grants as the event owner, and comp_grants RLS lets only
-- admins read it. The lookup always came back empty, and a comped
-- director's NEW events were never stamped Pro (existing ones were, by
-- the SECURITY DEFINER apply trigger). Found by the PGlite check that
-- ships with this migration. Running it as definer makes the lookup see
-- the grant. The INSERT policy's WITH CHECK runs after BEFORE triggers,
-- so NEW.user_id is still the caller's own id.

CREATE OR REPLACE FUNCTION public.guard_event_billing_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog, pg_temp
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.paid_at IS NOT NULL
       OR COALESCE(NEW.plan, 'free') <> 'free'
       OR NEW.comp_grant_id IS NOT NULL
       OR NEW.stripe_session_id IS NOT NULL
       OR NEW.stripe_payment_id IS NOT NULL THEN
      RAISE EXCEPTION 'Billing fields on events are set by Hereday, not by the event owner'
        USING ERRCODE = '42501';
    END IF;
  ELSIF (NEW.paid_at, NEW.plan, NEW.comp_grant_id, NEW.stripe_session_id, NEW.stripe_payment_id)
        IS DISTINCT FROM
        (OLD.paid_at, OLD.plan, OLD.comp_grant_id, OLD.stripe_session_id, OLD.stripe_payment_id) THEN
    RAISE EXCEPTION 'Billing fields on events are set by Hereday, not by the event owner'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.guard_event_billing_columns() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS "000_guard_event_billing_columns" ON public.events;
CREATE TRIGGER "000_guard_event_billing_columns"
  BEFORE INSERT OR UPDATE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_event_billing_columns();

-- Comp stamp on new events: read comp_grants past its admin-only RLS.
ALTER FUNCTION public.stamp_comp_on_new_event() SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────
-- Check (read-only, run after applying). Expect the guard first, then
-- 00_stamp_comp_on_new_event, then enforce_pro_gates, and
-- stamp_comp_on_new_event with prosecdef = true:
--
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid = 'public.events'::regclass AND NOT tgisinternal
--    ORDER BY tgname;
--   SELECT proname, prosecdef FROM pg_proc
--    WHERE proname IN ('guard_event_billing_columns', 'stamp_comp_on_new_event');
--
-- Rollback:
--   DROP TRIGGER IF EXISTS "000_guard_event_billing_columns" ON public.events;
--   DROP FUNCTION IF EXISTS public.guard_event_billing_columns();
--   ALTER FUNCTION public.stamp_comp_on_new_event() SECURITY INVOKER;
-- ─────────────────────────────────────────────────────────────────────
