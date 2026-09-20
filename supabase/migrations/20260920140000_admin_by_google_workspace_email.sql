-- Auto-grant admin to the hereday.io team — but only via Google.
--
-- The ask was "anyone with a @hereday.io email can be an admin". Taken
-- literally that is a self-service backdoor: this project has
-- mailer_autoconfirm = true and signups open, so anyone can register
-- ops@hereday.io and be marked confirmed instantly without ever touching
-- the mailbox. Email address alone proves nothing here.
--
-- Google sign-in does prove it. A Google account at @hereday.io can only
-- exist if it was created inside the hereday.io Workspace, so the OAuth
-- identity is evidence of domain membership in a way a typed string is
-- not. Hence the rule below: Google identity AND @hereday.io address.
--
-- If email confirmation is ever turned on, the email_confirmed_at check
-- here becomes meaningful on its own and the provider requirement could
-- be relaxed. Until then it is load-bearing — do not drop it.
--
-- GRANT-ONLY, deliberately. This never sets is_admin = false, because
-- admins granted by hand (the founder account is a personal Gmail, not a
-- hereday.io address) must survive every run of this trigger. Removing
-- an admin stays a deliberate manual UPDATE.

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

  IF NEW.email_confirmed_at IS NULL THEN
    RETURN NEW;
  END IF;

  -- raw_app_meta_data->>'provider' is the provider the account was
  -- created with; auth.identities covers accounts that linked Google
  -- later, or were created before that field was populated.
  v_is_google := (NEW.raw_app_meta_data->>'provider' = 'google')
    OR EXISTS (
      SELECT 1 FROM auth.identities i
       WHERE i.user_id = NEW.id AND i.provider = 'google'
    );

  IF NOT v_is_google THEN
    RETURN NEW;
  END IF;

  -- Upsert rather than update: this trigger must not depend on firing
  -- after the handle_new_user trigger that creates the profiles row.
  INSERT INTO public.profiles (user_id, is_admin)
  VALUES (NEW.id, true)
  ON CONFLICT (user_id) DO UPDATE SET is_admin = true;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_admin_from_google_workspace()
  FROM PUBLIC, anon, authenticated;

-- Named zz_ so it sorts after on_auth_user_created; the upsert above
-- makes ordering harmless either way, but belt and braces.
DROP TRIGGER IF EXISTS "zz_sync_admin_on_user_created" ON auth.users;
CREATE TRIGGER "zz_sync_admin_on_user_created"
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_admin_from_google_workspace();

-- Covers the two ways an existing account becomes eligible later:
-- confirming an email, or linking/changing to a Google hereday.io identity.
DROP TRIGGER IF EXISTS "zz_sync_admin_on_user_updated" ON auth.users;
CREATE TRIGGER "zz_sync_admin_on_user_updated"
  AFTER UPDATE OF email, email_confirmed_at, raw_app_meta_data ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_admin_from_google_workspace();

-- ── Backfill anyone who already qualifies ───────────────────────────
INSERT INTO public.profiles (user_id, is_admin)
SELECT u.id, true
  FROM auth.users u
 WHERE u.email ILIKE '%@hereday.io'
   AND u.email_confirmed_at IS NOT NULL
   AND (
     u.raw_app_meta_data->>'provider' = 'google'
     OR EXISTS (SELECT 1 FROM auth.identities i
                 WHERE i.user_id = u.id AND i.provider = 'google')
   )
ON CONFLICT (user_id) DO UPDATE SET is_admin = true;
