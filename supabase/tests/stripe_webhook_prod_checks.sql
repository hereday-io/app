-- Go-live checks for 20260727120000_stripe_webhook_ledger_two_phase.sql
-- and the stripe-webhook deploy that depends on it. Read-only, one
-- result each, for the Supabase SQL editor. Run A before applying, B
-- after the test purchase and refund.

-- ═════════════════════════════════════════════════════════════════════
-- A. BEFORE
--   completed_at_exists: false means the migration hasn't been applied.
--     The new webhook must not be deployed while this is false: every
--     duplicate delivery would 500 on the reclaim query.
--   service_role_can_*: the webhook now UPDATEs the ledger as well as
--     inserting into it. All three should be true.
--   ledger_rows / ledger_oldest / ledger_newest: what the backfill will
--     mark completed.
--   stripe_paid_events: events paid through Stripe. purchase rows is 0
--     today; that gap is what this deploy closes for new sales.
-- ═════════════════════════════════════════════════════════════════════
SELECT jsonb_pretty(jsonb_build_object(
  'completed_at_exists', EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'stripe_webhook_events'
       AND column_name = 'completed_at'),
  'service_role_can_insert', has_table_privilege('service_role', 'public.stripe_webhook_events', 'INSERT'),
  'service_role_can_update', has_table_privilege('service_role', 'public.stripe_webhook_events', 'UPDATE'),
  'service_role_can_select', has_table_privilege('service_role', 'public.stripe_webhook_events', 'SELECT'),
  'ledger_rows',   (SELECT count(*) FROM public.stripe_webhook_events),
  'ledger_oldest', (SELECT min(processed_at) FROM public.stripe_webhook_events),
  'ledger_newest', (SELECT max(processed_at) FROM public.stripe_webhook_events),
  'stripe_paid_events', (SELECT count(*) FROM public.events
                          WHERE paid_at IS NOT NULL AND stripe_payment_id IS NOT NULL),
  'purchase_rows', (SELECT count(*) FROM public.product_events
                     WHERE event_type IN ('purchase_completed', 'purchase_refunded'))
)) AS before_checks;

-- ═════════════════════════════════════════════════════════════════════
-- B. AFTER (migration applied, webhook deployed, test purchase made)
--   completed_at_exists: true.
--   open_claims: claims with no completed_at. Should be empty. A row
--     here older than ten minutes is a delivery that failed; Stripe's
--     next retry will reclaim it. Check the function logs for why.
--   recent_ledger: the last ten deliveries. Both test events should be
--     here with completed_at set.
--   recent_purchases: the last ten revenue rows, newest first. After
--     the test you should see purchase_refunded then purchase_completed
--     for the same event_id, both with amount_total, currency,
--     promo_code if one was used, and the buyer's utm_* / first_referrer
--     if their profile has any.
-- ═════════════════════════════════════════════════════════════════════
SELECT jsonb_pretty(jsonb_build_object(
  'completed_at_exists', EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'stripe_webhook_events'
       AND column_name = 'completed_at'),
  'open_claims', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'event_id', event_id, 'type', event_type, 'claimed', processed_at)
             ORDER BY processed_at DESC), '[]'::jsonb)
      FROM public.stripe_webhook_events WHERE completed_at IS NULL),
  'recent_ledger', (
    SELECT coalesce(jsonb_agg(r ORDER BY r.processed_at DESC), '[]'::jsonb)
      FROM (SELECT event_id, event_type, processed_at, completed_at
              FROM public.stripe_webhook_events
             ORDER BY processed_at DESC LIMIT 10) r),
  'recent_purchases', (
    SELECT coalesce(jsonb_agg(r ORDER BY r.created_at DESC, r.id DESC), '[]'::jsonb)
      FROM (SELECT id, event_type, event_id, user_id, created_at, properties
              FROM public.product_events
             WHERE event_type IN ('purchase_completed', 'purchase_refunded')
             ORDER BY created_at DESC, id DESC LIMIT 10) r)
)) AS after_checks;
