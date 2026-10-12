-- CRM go-live checks for the Supabase SQL editor. Read-only: every
-- statement is a SELECT. Run section A before applying the five
-- 20261012* migrations, section B after.
--
-- The behaviour itself (roles, masking, claims, DNC, import) is tested
-- locally against real Postgres with `npm run test:db`; these queries
-- only confirm prod matches what those tests assumed.

-- ═════════════════════════════════════════════════════════════════════
-- A. BEFORE applying
--
-- The SQL editor only shows the last statement's result when you run
-- several at once. A0 is A1–A6 in one query with one result to copy;
-- the individual queries follow for reference.
-- ═════════════════════════════════════════════════════════════════════

-- A0. Everything in section A, as one JSON result.
SELECT jsonb_pretty(jsonb_build_object(
  'a1_trigger_function',
    pg_get_functiondef('public.sync_admin_from_google_workspace()'::regprocedure),
  'a2_profile_policies', (
    SELECT jsonb_agg(jsonb_build_object(
             'name', polname, 'cmd', polcmd::text,
             'using', pg_get_expr(polqual, polrelid),
             'check', pg_get_expr(polwithcheck, polrelid)) ORDER BY polname)
      FROM pg_policy WHERE polrelid = 'public.profiles'::regclass),
  'a3_auth_user_triggers', (
    SELECT jsonb_agg(jsonb_build_object('name', tgname, 'enabled', tgenabled::text) ORDER BY tgname)
      FROM pg_trigger WHERE tgrelid = 'auth.users'::regclass AND NOT tgisinternal),
  'a4_name_collisions_expect_empty', (
    SELECT coalesce(jsonb_agg(x), '[]'::jsonb) FROM (
      SELECT n.nspname || '.' || p.proname AS x
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE p.proname ~ '^(crm_|is_admin$|is_staff$|staff_role$)'
      UNION ALL
      SELECT n.nspname || '.' || c.relname
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relname LIKE 'crm\_%' OR n.nspname = 'crm_internal') s),
  'a5_staff', (
    SELECT jsonb_agg(jsonb_build_object(
             'email', u.email, 'joined', u.created_at::date, 'last_seen', u.last_sign_in_at::date,
             'provider', u.raw_app_meta_data->>'provider', 'is_admin', p.is_admin,
             'name', p.display_name) ORDER BY p.is_admin DESC, u.created_at)
      FROM auth.users u JOIN public.profiles p ON p.user_id = u.id
     WHERE p.is_admin OR u.email ILIKE '%@hereday.io'),
  'a6_event_columns_expect_5', (
    SELECT jsonb_agg(column_name || ' ' || data_type ORDER BY column_name)
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'events'
       AND column_name IN ('paid_at', 'stripe_payment_id', 'comp_grant_id', 'slug', 'status'))
)) AS preflight;

-- A1. The live Workspace trigger function. It should match
--     20260920140000_admin_by_google_workspace_email.sql (grants is_admin).
SELECT pg_get_functiondef('public.sync_admin_from_google_workspace()'::regprocedure);

-- A2. The live profiles policies. Expect the UPDATE policy from
--     20260504120000_comp_grants.sql (freezes is_admin) and the original
--     INSERT / SELECT ones. Anything else: stop and compare first, because
--     20261012120000 drops and recreates the UPDATE and INSERT policies.
SELECT polname, polcmd,
       pg_get_expr(polqual, polrelid)      AS using_expr,
       pg_get_expr(polwithcheck, polrelid) AS check_expr
  FROM pg_policy
 WHERE polrelid = 'public.profiles'::regclass
 ORDER BY polname;

-- A3. Triggers on auth.users. Expect on_auth_user_created and the two zz_ ones.
SELECT tgname, tgenabled
  FROM pg_trigger
 WHERE tgrelid = 'auth.users'::regclass AND NOT tgisinternal
 ORDER BY tgname;

-- A4. Name collisions. Expect zero rows.
SELECT n.nspname, p.proname
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE p.proname ~ '^(crm_|is_admin$|is_staff$|staff_role$)'
UNION ALL
SELECT n.nspname, c.relname
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relname LIKE 'crm\_%' OR n.nspname = 'crm_internal';

-- A5. Who is staff today. Every @hereday.io Google account here is a
--     full admin under the current trigger. Note which ones are reps.
SELECT u.id, u.email, u.created_at::date AS joined, u.last_sign_in_at::date AS last_seen,
       u.raw_app_meta_data->>'provider' AS provider,
       p.is_admin, p.display_name
  FROM auth.users u
  JOIN public.profiles p ON p.user_id = u.id
 WHERE p.is_admin OR u.email ILIKE '%@hereday.io'
 ORDER BY p.is_admin DESC, u.created_at;

-- A6. events columns the CRM reads (two of them were added outside the
--     migration files). Expect all five rows.
SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'events'
   AND column_name IN ('paid_at', 'stripe_payment_id', 'comp_grant_id', 'slug', 'status')
 ORDER BY column_name;

-- ═════════════════════════════════════════════════════════════════════
-- B. AFTER applying all five, in order
-- ═════════════════════════════════════════════════════════════════════

-- B0. Everything in section B, as one JSON result.
SELECT jsonb_pretty(jsonb_build_object(
  'b1_rls_on_expect_5_true', (
    SELECT jsonb_object_agg(relname, relrowsecurity)
      FROM pg_class WHERE relname LIKE 'crm\_%' AND relkind = 'r'),
  'b2_client_table_grants_expect_empty', (
    SELECT coalesce(jsonb_agg(table_name || ' ' || grantee || ' ' || privilege_type), '[]'::jsonb)
      FROM information_schema.role_table_grants
     WHERE table_name LIKE 'crm\_%' AND grantee IN ('anon', 'authenticated')),
  'b3_rpc_count_expect_18', (
    SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname LIKE 'crm\_%'),
  'b3_rpc_problems_expect_empty', (
    SELECT coalesce(jsonb_agg(p.proname), '[]'::jsonb)
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname LIKE 'crm\_%'
       AND (NOT p.prosecdef
            OR NOT coalesce(p.proconfig::text LIKE '%search_path=%', false)
            OR has_function_privilege('anon', p.oid, 'execute'))),
  'b4_internal_schema_usage_expect_false', jsonb_build_object(
    'authenticated', has_schema_privilege('authenticated', 'crm_internal', 'usage'),
    'anon',          has_schema_privilege('anon', 'crm_internal', 'usage')),
  'b5_trigger_comment',
    obj_description('public.sync_admin_from_google_workspace()'::regprocedure, 'pg_proc'),
  'b6_staff', (
    SELECT jsonb_agg(jsonb_build_object('email', u.email, 'is_admin', p.is_admin, 'is_sales', p.is_sales)
                     ORDER BY p.is_admin DESC, u.email)
      FROM auth.users u JOIN public.profiles p ON p.user_id = u.id
     WHERE p.is_admin OR p.is_sales)
)) AS postflight;

-- B1. RLS on every CRM table (expect 5 rows, all true).
SELECT relname, relrowsecurity
  FROM pg_class
 WHERE relname LIKE 'crm\_%' AND relkind = 'r'
 ORDER BY relname;

-- B2. No client role can touch the tables directly. Expect ZERO rows.
SELECT table_name, grantee, privilege_type
  FROM information_schema.role_table_grants
 WHERE table_name LIKE 'crm\_%' AND grantee IN ('anon', 'authenticated');

-- B3. Every public crm_ RPC is SECURITY DEFINER with a pinned search_path,
--     and anon can execute none of them. Expect 18 rows, prosecdef true,
--     anon_can_execute false.
SELECT p.proname, p.prosecdef, p.proconfig,
       has_function_privilege('anon', p.oid, 'execute') AS anon_can_execute
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname LIKE 'crm\_%'
 ORDER BY p.proname;

-- B4. The internal schema is closed to client roles (expect false, false).
SELECT has_schema_privilege('authenticated', 'crm_internal', 'usage') AS authenticated_usage,
       has_schema_privilege('anon', 'crm_internal', 'usage')          AS anon_usage;

-- B5. The trigger now grants sales, not admin.
SELECT obj_description('public.sync_admin_from_google_workspace()'::regprocedure, 'pg_proc');

-- B6. Staff after the backfill. Then demote any rep who is still an
--     admin, one at a time:
--       UPDATE public.profiles SET is_admin = false, is_sales = true
--        WHERE user_id = '<uuid>' RETURNING user_id, is_admin, is_sales;
SELECT u.email, p.is_admin, p.is_sales
  FROM auth.users u JOIN public.profiles p ON p.user_id = u.id
 WHERE p.is_admin OR p.is_sales
 ORDER BY p.is_admin DESC, u.email;

-- B7. If the CRM page says a function doesn't exist right after applying,
--     PostgREST hasn't reloaded its schema cache yet. This is the one
--     non-SELECT in the file and is safe:
--       NOTIFY pgrst, 'reload schema';
