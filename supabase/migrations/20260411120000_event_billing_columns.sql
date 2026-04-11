-- Make "Pro" an event attribute, not a user attribute.
--
-- Context: pricing is locked at $49 per event, one-time, no
-- subscription. Profiles.is_paid / profiles.plan made sense under the
-- old per-user subscription model but now actively misrepresent
-- reality — a user can have paid for one event and not another.
--
-- This migration shifts the source of truth to events.paid_at. The
-- Stripe webhook (coming once the account is live) will land here
-- with a single UPDATE per successful checkout:
--
--   UPDATE events
--      SET paid_at = now(),
--          stripe_session_id = $1,
--          plan = 'pro'
--    WHERE id = $2;
--
-- events.plan stays around as a mirror because the editor already
-- reads it; it is kept in sync with paid_at below. Future cleanup can
-- collapse the two if we ever want to, but that's a refactor, not a
-- migration.

-- ── 1. New columns ──────────────────────────────────────────────────
--
-- paid_at          — NULL = free, timestamp = when payment landed
-- stripe_session_id — cs_xxx id from checkout.session.completed; kept
--                     so we can reconcile webhook events and support
--                     manual refunds / comps
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS paid_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stripe_session_id TEXT;

-- ── 2. Backfill ─────────────────────────────────────────────────────
--
-- Any event that was treated as Pro under the old model keeps its Pro
-- status here. Two sources of truth existed:
--   a. events.plan = 'pro' (per-event, what the editor already reads)
--   b. profiles.is_paid = true OR profiles.plan = 'pro' (per-user,
--      what the public_events view reads today)
--
-- We take the union so nothing regresses when the view flips below.
-- paid_at is set to now() for backfilled rows — we don't know when
-- the user actually "paid" (they didn't, in the Stripe sense), but
-- the column's semantics are "is this Pro" not "exact payment moment"
-- so now() is a fine marker for pre-Stripe comps and internal events.
UPDATE public.events e
   SET paid_at = COALESCE(e.paid_at, now()),
       plan    = 'pro'
  WHERE e.paid_at IS NULL
    AND (
      e.plan = 'pro'
      OR EXISTS (
        SELECT 1
          FROM public.profiles p
         WHERE p.user_id = e.user_id
           AND (p.is_paid = true OR p.plan = 'pro')
      )
    );

-- ── 3. Redefine public_events so owner_is_paid is per-event ─────────
--
-- Same column name (owner_is_paid) to avoid churning client code that
-- already consumes it — the semantics quietly shift from "this event's
-- owner is Pro" to "this event is Pro". EventPublic.tsx reads this
-- value to decide whether to show the "Made with Hereday" footer;
-- per-event is what it always should have meant.
CREATE OR REPLACE VIEW public.public_events
WITH (security_invoker = true) AS
SELECT
  e.id,
  e.name,
  e.slug,
  e.city,
  e.event_date,
  e.routes,
  e.pois,
  e.route_count,
  e.poi_count,
  e.logo_url,
  e.branding_style,
  e.updated_at,
  e.tracking_start,
  e.tracking_end,
  (e.paid_at IS NOT NULL) AS owner_is_paid,
  (e.event_date IS NOT NULL AND e.event_date < CURRENT_DATE) AS has_ended
FROM public.events e
WHERE e.status = 'published';

GRANT SELECT ON public.public_events TO anon, authenticated;

-- event_owner_is_paid() is now unused by the view but we leave it in
-- place — dropping it would require cascading through any other
-- dependencies we might not see, and it does no harm sitting unused.
