-- Store the customer's active promo code on the profiles row.
--
-- Billing page (/billing) lets an organizer redeem a partner / community
-- code once; the next Stripe Checkout session created for them forwards
-- it as a `discounts: [{ coupon }]` parameter. The code stays attached
-- to the profile so subsequent unlocks inherit the discount until the
-- organizer removes it or it expires.
--
-- We piggyback on `profiles` rather than adding a new `customers` table
-- because Hereday already tracks Stripe data per-profile (see
-- stripe_customer_id) and there's no multi-customer-per-user case.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS active_promo_code        TEXT,
  ADD COLUMN IF NOT EXISTS active_promo_expires_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS active_promo_percent_off INTEGER;
