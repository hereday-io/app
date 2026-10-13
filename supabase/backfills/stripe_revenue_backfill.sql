-- One-off backfill: purchase_completed / purchase_refunded rows in
-- public.product_events for sales made before the stripe-webhook-ledger
-- webhook started logging them.
--
-- This file is a TEMPLATE. Don't paste it into the SQL editor as is.
-- scripts/stripe-revenue-backfill.mjs reads charges from Stripe, puts
-- them where __STRIPE_INPUT__ is, and writes two runnable files:
--
--   supabase/backfills/out/stripe_revenue_preview.sql  read-only; run first
--   supabase/backfills/out/stripe_revenue_apply.sql    BEGIN … COMMIT write
--
-- Each row mirrors logRevenueEvent in supabase/functions/stripe-webhook:
--   purchase_completed: amount_total, amount_subtotal, amount_discount,
--     currency, percent_off, promo_code, stripe_session_id, stripe_charge_id
--   purchase_refunded: amount_total, amount_refunded, currency,
--     stripe_charge_id, promo_code
--   both: the buyer's first-touch attribution from profiles, with null
--     keys dropped, plus "backfilled": true.
-- created_at is the Stripe charge time, or the refund time for refunds.
--
-- Matching. The event comes from metadata hereday_event_id (session
-- first, then charge), else events.stripe_payment_id = the charge.
-- The buyer comes from metadata hereday_user_id, else the event's owner.
-- An event deleted since the sale still gets its row: event_id is not a
-- foreign key, and the revenue happened. The preview flags these
-- (event_exists = false). A buyer no longer in auth.users is written as
-- user_id NULL, the same as ON DELETE SET NULL would leave it.
--
-- Differences from the live webhook, on purpose:
--   * Refund rows take the same resolved promo code as the purchase.
--     The new webhook reads it from charge metadata, which it stamps
--     with that same resolved code. The old webhook only stamped codes
--     applied on /billing.
--   * Partial refunds are skipped, as the webhook skips them. The preview
--     lists them.
--
-- Idempotent: a charge that already has a row of the same event_type
-- with the same properties.stripe_charge_id is skipped. That covers
-- rows the new webhook wrote and a second run of this file.
--
-- Sections are split on the "-- ==== NAME ====" lines below.

-- ==== CORE ====
input AS (
  SELECT DISTINCT ON (x.charge_id) x.*
    FROM jsonb_to_recordset($stripe_input$__STRIPE_INPUT__$stripe_input$::jsonb) AS x(
           charge_id       text,
           created         bigint,  -- unix seconds
           amount          int,
           currency        text,
           amount_refunded int,
           refunded_at     bigint,  -- unix seconds of the last refund, or null
           charge_meta     jsonb,   -- charge.metadata
           session         jsonb)   -- {id, amount_total, amount_subtotal, amount_discount,
                                    --  currency, meta, promo_code} or null
   ORDER BY x.charge_id
),
charges AS (
  SELECT i.*,
         CASE WHEN m.event_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN m.event_id::uuid END AS meta_event_id,
         CASE WHEN m.user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN m.user_id::uuid END AS meta_user_id,
         -- Same order as the webhook's resolvePromoCode: the code applied
         -- on /billing, then the one typed on Stripe's page. Charge
         -- metadata is last, for a charge with no Checkout Session.
         coalesce(i.session->'meta'->>'hereday_promo_code',
                  i.session->>'promo_code',
                  i.charge_meta->>'hereday_promo_code') AS promo_code
    FROM input i
   CROSS JOIN LATERAL (SELECT
           coalesce(i.session->'meta'->>'hereday_event_id', i.charge_meta->>'hereday_event_id') AS event_id,
           coalesce(i.session->'meta'->>'hereday_user_id', i.charge_meta->>'hereday_user_id') AS user_id) m
),
matched AS (
  SELECT c.*,
         ev.event_id,
         e.id IS NOT NULL AS event_exists,
         e.name AS event_name,
         u.id AS user_id,
         jsonb_build_object(
           'first_referrer',     p.first_referrer,
           'first_landing_page', p.first_landing_page,
           'utm_source',         p.utm_source,
           'utm_medium',         p.utm_medium,
           'utm_campaign',       p.utm_campaign,
           'utm_term',           p.utm_term,
           'utm_content',        p.utm_content) AS attribution
    FROM charges c
    LEFT JOIN public.events e_meta ON e_meta.id = c.meta_event_id
    -- LIMIT 1: stripe_payment_id is not unique. Metadata wins anyway.
    LEFT JOIN LATERAL (SELECT ep.id FROM public.events ep
                        WHERE ep.stripe_payment_id = c.charge_id
                        ORDER BY ep.created_at LIMIT 1) e_pay ON true
    CROSS JOIN LATERAL (SELECT coalesce(e_meta.id, e_pay.id, c.meta_event_id) AS event_id) ev
    LEFT JOIN public.events e ON e.id = ev.event_id
    LEFT JOIN auth.users u ON u.id = coalesce(c.meta_user_id, e.user_id)
    LEFT JOIN public.profiles p ON p.user_id = u.id
),
revenue_rows AS (
  SELECT 'purchase_completed'::text AS event_type,
         m.charge_id, m.event_id, m.event_exists, m.event_name, m.user_id,
         to_timestamp(m.created) AS created_at,
         CASE WHEN m.event_id IS NULL THEN 'skip: no matching event' END AS skip_reason,
         jsonb_strip_nulls(jsonb_build_object(
           'amount_total',      coalesce((m.session->>'amount_total')::int, m.amount),
           'amount_subtotal',   nullif(s.subtotal, 0),
           'amount_discount',   nullif(s.discount, 0),
           'currency',          coalesce(m.session->>'currency', m.currency),
           'percent_off',       CASE WHEN s.discount > 0 AND s.subtotal > 0
                                     THEN round(s.discount * 100.0 / s.subtotal)::int END,
           'promo_code',        m.promo_code,
           'stripe_session_id', m.session->>'id',
           'stripe_charge_id',  m.charge_id,
           'backfilled',        true) || m.attribution) AS properties
    FROM matched m
   CROSS JOIN LATERAL (SELECT coalesce((m.session->>'amount_subtotal')::int, 0) AS subtotal,
                              coalesce((m.session->>'amount_discount')::int, 0) AS discount) s
  UNION ALL
  SELECT 'purchase_refunded',
         m.charge_id, m.event_id, m.event_exists, m.event_name, m.user_id,
         to_timestamp(m.refunded_at),
         CASE WHEN m.event_id IS NULL THEN 'skip: no matching event'
              WHEN m.amount_refunded < m.amount THEN 'skip: partial refund'
              WHEN m.refunded_at IS NULL THEN 'skip: no refund time' END,
         jsonb_strip_nulls(jsonb_build_object(
           'amount_total',     m.amount,
           'amount_refunded',  m.amount_refunded,
           'currency',         m.currency,
           'stripe_charge_id', m.charge_id,
           'promo_code',       m.promo_code,
           'backfilled',       true) || m.attribution)
    FROM matched m
   WHERE m.amount_refunded > 0
),
candidates AS (
  SELECT r.*,
         coalesce(r.skip_reason,
                  CASE WHEN EXISTS (SELECT 1 FROM public.product_events pe
                                     WHERE pe.event_type = r.event_type
                                       AND pe.properties->>'stripe_charge_id' = r.charge_id)
                       THEN 'skip: already logged' END,
                  'insert') AS action
    FROM revenue_rows r
)
-- ==== PREVIEW ====
SELECT c.action,
       count(*) OVER (PARTITION BY c.action) AS rows_with_this_action,
       c.event_type,
       c.created_at,
       c.charge_id,
       c.event_id,
       c.event_exists,
       c.event_name,
       c.user_id,
       c.properties->'amount_total' AS amount_total,
       c.properties->>'promo_code' AS promo_code,
       c.properties
  FROM candidates c
 ORDER BY c.action <> 'insert', c.created_at, c.event_type;
-- ==== APPLY ====
, inserted AS (
  INSERT INTO public.product_events (event_type, user_id, event_id, properties, created_at)
  SELECT c.event_type, c.user_id, c.event_id, c.properties, c.created_at
    FROM candidates c
   WHERE c.action = 'insert'
   ORDER BY c.created_at
  RETURNING event_type
)
SELECT event_type, count(*) AS inserted FROM inserted GROUP BY event_type;

-- Guard: no charge may now have two rows of one type. Raising here
-- aborts the transaction and the script stops, so nothing is committed.
DO $guard$
DECLARE
  v_dupe record;
BEGIN
  SELECT pe.event_type, pe.properties->>'stripe_charge_id' AS charge_id, count(*) AS n
    INTO v_dupe
    FROM public.product_events pe
   WHERE pe.event_type IN ('purchase_completed', 'purchase_refunded')
     AND pe.properties ? 'stripe_charge_id'
   GROUP BY 1, 2
  HAVING count(*) > 1 AND bool_or(pe.properties->>'backfilled' = 'true')
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'backfill would duplicate % for charge % (% rows); rolled back',
      v_dupe.event_type, v_dupe.charge_id, v_dupe.n;
  END IF;
END
$guard$;
