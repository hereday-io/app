-- Paid-but-not-Pro reconciliation. Read-only, one result row, for the
-- Supabase SQL editor or a scheduled daily run. `ok` is true when there
-- is nothing to look at; otherwise each non-empty list names the rows.
--
-- Tested against fixtures by billing_reconcile.check.mjs (npm run test:db),
-- which runs this file verbatim. Keep it a single statement.
--
--   stale_claims
--     stripe_webhook_events rows claimed but never completed, older than
--     the webhook's STALE_CLAIM_MS (10 minutes). Each is a delivery whose
--     handler failed or timed out. Stripe keeps retrying for 3 days and a
--     retry reclaims it, so a row here may clear on its own; one older
--     than a few hours means the retries are failing too. Look the event
--     id up in Stripe (Developers → Events) and in the function logs.
--
--   stripe_paid_not_pro
--     Events that went through Stripe checkout (stripe_session_id is
--     only written when the webhook grants Pro) but are not Pro now,
--     with no purchase_refunded row explaining it. Either something
--     cleared paid_at outside the webhook, or the event was refunded
--     before refund logging existed (2026-10-13) — check the charge in
--     Stripe before granting anything.
--
--   purchases_not_pro
--     purchase_completed rows (one per sale the webhook recorded) whose
--     event is not Pro now, or no longer exists, with no later refund
--     row. Same causes as above, seen from the revenue log instead.
--
-- Not covered here, because the database never hears about them: a
-- payment whose webhook never arrived at all, and a paid session the
-- webhook acknowledged without a hereday_event_id. Stripe's failed-
-- webhook emails and the `server_error` alerts in PostHog cover those.
WITH refunded AS (
  SELECT DISTINCT event_id
    FROM public.product_events
   WHERE event_type = 'purchase_refunded' AND event_id IS NOT NULL
),
stale_claims AS (
  SELECT event_id, event_type, processed_at AS claimed_at,
         round(extract(epoch FROM now() - processed_at) / 3600, 1) AS hours_open
    FROM public.stripe_webhook_events
   WHERE completed_at IS NULL
     AND processed_at < now() - interval '10 minutes'
),
stripe_paid_not_pro AS (
  SELECT e.id AS event_id, e.name, e.user_id, e.stripe_session_id,
         e.stripe_payment_id, e.updated_at
    FROM public.events e
   WHERE e.stripe_session_id IS NOT NULL
     AND e.paid_at IS NULL
     AND e.id NOT IN (SELECT event_id FROM refunded)
),
purchases_not_pro AS (
  SELECT p.id AS product_event_id, p.event_id, p.user_id, p.created_at AS purchased_at,
         p.properties ->> 'stripe_session_id' AS stripe_session_id,
         (e.id IS NULL) AS event_missing
    FROM public.product_events p
    LEFT JOIN public.events e ON e.id = p.event_id
   WHERE p.event_type = 'purchase_completed'
     AND (e.id IS NULL OR e.paid_at IS NULL)
     AND NOT EXISTS (
       SELECT 1 FROM public.product_events r
        WHERE r.event_type = 'purchase_refunded'
          AND r.event_id = p.event_id
          AND r.created_at >= p.created_at)
)
SELECT jsonb_pretty(jsonb_build_object(
  'checked_at', now(),
  'ok', NOT EXISTS (SELECT 1 FROM stale_claims)
        AND NOT EXISTS (SELECT 1 FROM stripe_paid_not_pro)
        AND NOT EXISTS (SELECT 1 FROM purchases_not_pro),
  'stale_claims', (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.claimed_at), '[]'::jsonb) FROM stale_claims s),
  'stripe_paid_not_pro', (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.updated_at DESC), '[]'::jsonb) FROM stripe_paid_not_pro s),
  'purchases_not_pro', (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.purchased_at DESC), '[]'::jsonb) FROM purchases_not_pro s)
)) AS billing_reconcile;
