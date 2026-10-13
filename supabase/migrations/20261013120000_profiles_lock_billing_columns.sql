-- Users may only write the profile columns that are theirs to write.
--
-- Why: the profiles UPDATE policy checks the row (auth.uid() = user_id)
-- and freezes is_admin / is_sales, but every other column was writable
-- by its owner through PostgREST, because Supabase grants UPDATE on all
-- columns of every public table to `authenticated`. That included:
--   * stripe_customer_id — trusted by list-charges, get-receipt,
--     get-payment-method, detach-payment-method and create-checkout via
--     _shared/billing.ts. Pointing it at someone else's cus_… id would
--     show their charges and card, or detach their card.
--   * active_promo_code / _percent_off / _expires_at — applied at
--     checkout. Writing an internal coupon id here skipped the
--     promotion-code-only check in apply-promo (the 2026-05-01 H-3 fix).
--   * plan, is_paid, stripe_subscription_id, current_period_end — legacy
--     billing state that should only ever come from Stripe.
--
-- Fix: column privileges. `authenticated` keeps UPDATE on the columns
-- the app writes from the browser (name, organization, avatar, and the
-- first-touch attribution that src/lib/attribution.ts claims once) and
-- loses it on everything else. Billing columns are written only by edge
-- functions, which use the service role and are unaffected. The RLS
-- policies stay as they are; this sits underneath them.
--
-- Also: profiles.active_promotion_code_id, so checkout can hand Stripe
-- the promotion code itself (which enforces its expiry and redemption
-- limits) rather than the bare coupon behind it.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Column privileges
-- ─────────────────────────────────────────────────────────────────────
REVOKE UPDATE ON public.profiles FROM anon, authenticated;
GRANT UPDATE (
  display_name,
  organization_name,
  avatar_url,
  first_referrer,
  first_landing_page,
  utm_source,
  utm_medium,
  utm_campaign,
  utm_term,
  utm_content,
  attribution_captured_at
) ON public.profiles TO authenticated;

-- Rows are created by handle_new_user (SECURITY DEFINER) on signup.
-- Nothing in the app inserts a profile from the browser.
REVOKE INSERT ON public.profiles FROM anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 2. The promotion code behind active_promo_code
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS active_promotion_code_id TEXT;

COMMENT ON COLUMN public.profiles.active_promotion_code_id IS
  'Stripe promotion code (promo_…) validated by apply-promo. create-checkout passes it to Stripe so the code''s own expiry and redemption limits apply. A saved code without one predates 20261013120000 and is dropped at the next checkout.';

-- ─────────────────────────────────────────────────────────────────────
-- Check (read-only, run after applying). Expect exactly the 11 columns
-- granted above for `authenticated`, and no INSERT / UPDATE rows for anon:
--
--   SELECT grantee, privilege_type, column_name
--     FROM information_schema.column_privileges
--    WHERE table_schema = 'public' AND table_name = 'profiles'
--      AND grantee IN ('anon', 'authenticated')
--      AND privilege_type IN ('INSERT', 'UPDATE')
--    ORDER BY grantee, privilege_type, column_name;
--
-- Rollback:
--   GRANT UPDATE, INSERT ON public.profiles TO authenticated;
--   (leave the new column in place)
-- ─────────────────────────────────────────────────────────────────────
