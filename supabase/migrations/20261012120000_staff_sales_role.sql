-- Staff roles: a `sales` role for reps, alongside the existing admin flag.
--
-- Why: the CRM (20261012121000_crm_schema.sql) is shared with sales reps,
-- but reps must not transfer events, grant comps or read the Overview
-- analytics. Until now the only staff flag was profiles.is_admin, and
-- 20260920140000_admin_by_google_workspace_email.sql granted it to every
-- @hereday.io Google sign-in — which made every rep a full admin.
--
-- Shape: keep is_admin exactly as it is and add is_sales next to it.
-- is_admin is checked inline by six RPCs, the comp_grants and
-- event_transfers policies, the profiles WITH CHECK and
-- _shared/adminAuth.ts; converting it to a role enum would mean
-- rewriting working prod functions. Admin takes precedence, and
-- staff_role() presents the pair as a single role.
--
-- After applying: run the listing query at the bottom of this file and
-- demote any rep who is currently an admin, by hand.

-- ─────────────────────────────────────────────────────────────────────
-- 1. profiles.is_sales
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_sales BOOLEAN NOT NULL DEFAULT false;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Role helpers. New code uses these instead of repeating the inline
--    EXISTS check. They only ever describe the caller, so exposing them
--    as RPCs leaks nothing.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT p.is_admin FROM public.profiles p WHERE p.user_id = auth.uid()),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT p.is_admin OR p.is_sales FROM public.profiles p WHERE p.user_id = auth.uid()),
    false
  );
$$;

-- 'admin' | 'sales' | NULL. The admin route guard reads this.
CREATE OR REPLACE FUNCTION public.staff_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
  SELECT CASE
           WHEN p.is_admin THEN 'admin'
           WHEN p.is_sales THEN 'sales'
         END
    FROM public.profiles p
   WHERE p.user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.is_admin()   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_staff()   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.staff_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin()   TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_staff()   TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_role() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 3. Self-promotion locks. The UPDATE policy already froze is_admin
--    (20260504120000_comp_grants.sql); it now freezes is_sales too.
--    The original INSERT policy never checked either flag. That is not
--    exploitable today — handle_new_user creates the row first and
--    user_id is UNIQUE — but it costs nothing to close.
-- ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND is_admin = (SELECT p.is_admin FROM public.profiles p WHERE p.user_id = auth.uid())
    AND is_sales = (SELECT p.is_sales FROM public.profiles p WHERE p.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id AND is_admin = false AND is_sales = false);

-- ─────────────────────────────────────────────────────────────────────
-- 4. The Workspace trigger now grants sales, never admin.
--
--    Same function name, so both zz_ triggers on auth.users keep
--    pointing at it with no window where they don't. Everything that
--    made the original safe still applies and is unchanged: Google
--    identity AND @hereday.io AND a confirmed email, and grant-only —
--    it never clears a flag. Existing admins keep is_admin; removing it
--    stays a deliberate manual UPDATE.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_admin_from_google_workspace()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp, auth
AS $$
DECLARE
  v_is_google BOOLEAN;
BEGIN
  IF NEW.email IS NULL OR NEW.email NOT ILIKE '%@hereday.io' THEN
    RETURN NEW;
  END IF;

  -- Load-bearing while mailer_autoconfirm is on; see the 20260920140000
  -- header. Do not drop it.
  IF NEW.email_confirmed_at IS NULL THEN
    RETURN NEW;
  END IF;

  v_is_google := (NEW.raw_app_meta_data->>'provider' = 'google')
    OR EXISTS (
      SELECT 1 FROM auth.identities i
       WHERE i.user_id = NEW.id AND i.provider = 'google'
    );

  IF NOT v_is_google THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.profiles (user_id, is_sales)
  VALUES (NEW.id, true)
  ON CONFLICT (user_id) DO UPDATE
    SET is_sales = true
    WHERE public.profiles.is_sales IS DISTINCT FROM true;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.sync_admin_from_google_workspace() IS
  'Historical name. Since 20261012120000 it grants profiles.is_sales (CRM access), never is_admin.';

REVOKE EXECUTE ON FUNCTION public.sync_admin_from_google_workspace()
  FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 5. Backfill is_sales for everyone who already qualifies, so demoting
--    an admin rep by hand leaves them in the CRM rather than locked out.
-- ─────────────────────────────────────────────────────────────────────
UPDATE public.profiles p
   SET is_sales = true
  FROM auth.users u
 WHERE u.id = p.user_id
   AND u.email ILIKE '%@hereday.io'
   AND u.email_confirmed_at IS NOT NULL
   AND (
     u.raw_app_meta_data->>'provider' = 'google'
     OR EXISTS (SELECT 1 FROM auth.identities i
                 WHERE i.user_id = u.id AND i.provider = 'google')
   )
   AND p.is_sales = false;

-- ─────────────────────────────────────────────────────────────────────
-- 6. Who is an admin today (manual, read-only — run after applying):
--
--   SELECT u.id, u.email, u.created_at::date AS joined, u.last_sign_in_at,
--          p.is_admin, p.is_sales, p.display_name,
--          (SELECT count(*) FROM public.comp_grants g     WHERE g.granted_by = u.id)     AS comps_granted,
--          (SELECT count(*) FROM public.event_transfers t WHERE t.transferred_by = u.id) AS transfers_done,
--          (SELECT count(*) FROM public.events e          WHERE e.user_id = u.id)        AS events_owned
--     FROM auth.users u
--     JOIN public.profiles p ON p.user_id = u.id
--    WHERE p.is_admin OR p.is_sales
--    ORDER BY p.is_admin DESC, u.created_at;
--
-- Demote a rep (manual, one user at a time):
--
--   UPDATE public.profiles SET is_admin = false, is_sales = true
--    WHERE user_id = '<uuid>' RETURNING user_id, is_admin, is_sales;
--
-- Rollback (only if nothing depends on is_sales yet): restore the
-- function body from 20260920140000, then
--   DROP FUNCTION public.staff_role(); DROP FUNCTION public.is_staff();
--   DROP FUNCTION public.is_admin();
-- and leave the column in place.
-- ─────────────────────────────────────────────────────────────────────
