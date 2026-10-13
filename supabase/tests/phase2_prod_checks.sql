-- Go-live checks for 20261013120000_profiles_lock_billing_columns.sql and
-- 20261013121000_crm_cli_rpcs.sql. Read-only, one result each, for the
-- Supabase SQL editor. Run A before applying, B after.

-- ═════════════════════════════════════════════════════════════════════
-- A. BEFORE
--   authenticated_can_update_columns: how many profile columns a
--     signed-in user can write today (every column, if the gap is real).
--   saved_promos: codes saved on profiles, grouped, no users named. Any
--     coupon you don't recognise as a public promotion is one someone
--     wrote to their own profile. Coupon-only rows are dropped at the
--     next checkout after the new create-checkout ships.
--   sent_deals_without_followup_date: imported Sent deals the backfill
--     will give a follow-up date.
-- ═════════════════════════════════════════════════════════════════════
SELECT jsonb_pretty(jsonb_build_object(
  'authenticated_can_update_columns', (
    SELECT count(*) FROM information_schema.column_privileges
     WHERE table_schema = 'public' AND table_name = 'profiles'
       AND grantee = 'authenticated' AND privilege_type = 'UPDATE'),
  'authenticated_can_insert', EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = 'profiles'
       AND grantee = 'authenticated' AND privilege_type = 'INSERT'),
  'saved_promos', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'coupon', active_promo_code, 'percent_off', active_promo_percent_off,
             'expires', active_promo_expires_at, 'profiles', n)), '[]'::jsonb)
      FROM (SELECT active_promo_code, active_promo_percent_off, active_promo_expires_at, count(*) AS n
              FROM public.profiles WHERE active_promo_code IS NOT NULL
             GROUP BY 1, 2, 3) p),
  'sent_deals_without_followup_date', (
    SELECT count(*) FROM public.crm_deals
     WHERE stage = 'sent' AND sent_at IS NOT NULL AND followed_up_at IS NULL AND next_step_at IS NULL)
)) AS preflight;

-- ═════════════════════════════════════════════════════════════════════
-- B. AFTER applying both
-- ═════════════════════════════════════════════════════════════════════
SELECT jsonb_pretty(jsonb_build_object(
  'authenticated_update_columns_expect_11', (
    SELECT jsonb_agg(column_name ORDER BY column_name) FROM information_schema.column_privileges
     WHERE table_schema = 'public' AND table_name = 'profiles'
       AND grantee = 'authenticated' AND privilege_type = 'UPDATE'),
  'authenticated_can_insert_expect_false', EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = 'profiles'
       AND grantee = 'authenticated' AND privilege_type = 'INSERT'),
  'promotion_code_column_expect_true', EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'active_promotion_code_id'),
  'crm_functions_expect_20', (
    SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname LIKE 'crm\_%'),
  'sent_deals_without_followup_date_expect_0', (
    SELECT count(*) FROM public.crm_deals
     WHERE stage = 'sent' AND sent_at IS NOT NULL AND followed_up_at IS NULL AND next_step_at IS NULL),
  'sent_deals_by_followup_date', (
    SELECT coalesce(jsonb_object_agg(coalesce(next_step_at::text, 'none'), n), '{}'::jsonb)
      FROM (SELECT next_step_at, count(*) AS n FROM public.crm_deals WHERE stage = 'sent' GROUP BY 1) s)
)) AS postflight;
