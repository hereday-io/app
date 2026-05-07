-- Comp grants: founder-issued, user-level Pro access for free.
--
-- Pro is per-event (events.paid_at). A "comp grant" is a user-level
-- record that cascades to all of that user's events — existing rows
-- via an AFTER INSERT trigger, future rows via a BEFORE INSERT trigger
-- on events. Revocation clears only events that were Pro because of
-- this grant; real Stripe payments (stripe_payment_id NOT NULL) are
-- always preserved.
--
-- The new events.comp_grant_id column is the discriminator. We
-- intentionally do NOT overload stripe_session_id, because Billing.tsx
-- renders a fake "Receipt …" line from any stripe_session_id present.

-- ─────────────────────────────────────────────────────────────────────
-- 1. profiles.is_admin + lock against self-promotion via the
--    user-update-own-profile policy.
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND is_admin = (
      SELECT p.is_admin FROM public.profiles p WHERE p.user_id = auth.uid()
    )
  );

-- ─────────────────────────────────────────────────────────────────────
-- 2. comp_grants table + indexes + RLS
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.comp_grants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_by      UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  grant_reason    TEXT NOT NULL CHECK (length(grant_reason) BETWEEN 3 AND 500),
  revoked_at      TIMESTAMPTZ,
  revoked_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  revoke_reason   TEXT CHECK (revoke_reason IS NULL OR length(revoke_reason) BETWEEN 3 AND 500),
  CONSTRAINT comp_grants_revoke_pair CHECK (
    (revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason IS NULL)
    OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND revoke_reason IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS comp_grants_user_active_idx
  ON public.comp_grants (user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS comp_grants_user_history_idx
  ON public.comp_grants (user_id, granted_at DESC);

ALTER TABLE public.comp_grants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read all comp grants" ON public.comp_grants;
CREATE POLICY "Admins can read all comp grants"
  ON public.comp_grants FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid() AND p.is_admin = true
    )
  );

DROP POLICY IF EXISTS "Admins can insert comp grants" ON public.comp_grants;
CREATE POLICY "Admins can insert comp grants"
  ON public.comp_grants FOR INSERT
  TO authenticated
  WITH CHECK (
    granted_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid() AND p.is_admin = true
    )
  );

DROP POLICY IF EXISTS "Admins can update (revoke) comp grants" ON public.comp_grants;
CREATE POLICY "Admins can update (revoke) comp grants"
  ON public.comp_grants FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid() AND p.is_admin = true
    )
  )
  WITH CHECK (
    revoked_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid() AND p.is_admin = true
    )
  );
-- No DELETE policy — append/update-only for audit.

-- ─────────────────────────────────────────────────────────────────────
-- 3. events.comp_grant_id — the discriminator that distinguishes a
--    comp'd event from a Stripe-paid one.
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS comp_grant_id UUID
    REFERENCES public.comp_grants(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 4. Apply trigger: when a comp_grants row is inserted, stamp every
--    eligible event the user owns. SECURITY DEFINER so it can bypass
--    the per-user RLS on events.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.apply_comp_grant_to_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
BEGIN
  UPDATE public.events
     SET paid_at       = COALESCE(paid_at, now()),
         plan          = 'pro',
         comp_grant_id = NEW.id
   WHERE user_id = NEW.user_id
     AND (paid_at IS NULL OR comp_grant_id IS NOT NULL)
     AND stripe_payment_id IS NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS comp_grants_apply ON public.comp_grants;
CREATE TRIGGER comp_grants_apply
  AFTER INSERT ON public.comp_grants
  FOR EACH ROW
  WHEN (NEW.revoked_at IS NULL)
  EXECUTE FUNCTION public.apply_comp_grant_to_events();

-- Trigger-only — not an RPC. Revoke EXECUTE so anon/authenticated cannot
-- call it via /rest/v1/rpc/. The trigger itself runs as definer (postgres).
REVOKE EXECUTE ON FUNCTION public.apply_comp_grant_to_events() FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 5. Auto-stamp future events. The 00_ prefix guarantees this BEFORE
--    trigger fires before enforce_pro_gates (alphabetical order),
--    which short-circuits at `IF NEW.paid_at IS NOT NULL THEN RETURN NEW`.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.stamp_comp_on_new_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE
  v_grant_id UUID;
BEGIN
  IF NEW.paid_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_grant_id
    FROM public.comp_grants
   WHERE user_id = NEW.user_id
     AND revoked_at IS NULL
   ORDER BY granted_at DESC
   LIMIT 1;

  IF v_grant_id IS NOT NULL THEN
    NEW.paid_at       := now();
    NEW.plan          := 'pro';
    NEW.comp_grant_id := v_grant_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "00_stamp_comp_on_new_event" ON public.events;
CREATE TRIGGER "00_stamp_comp_on_new_event"
  BEFORE INSERT ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_comp_on_new_event();

REVOKE EXECUTE ON FUNCTION public.stamp_comp_on_new_event() FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 6. Revoke trigger: clear only events tagged with this grant id and
--    not paid via Stripe.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.revoke_comp_grant_on_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
BEGIN
  IF OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.events
     SET paid_at       = NULL,
         plan          = 'free',
         comp_grant_id = NULL
   WHERE comp_grant_id = OLD.id
     AND stripe_payment_id IS NULL;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS comp_grants_revoke ON public.comp_grants;
CREATE TRIGGER comp_grants_revoke
  AFTER UPDATE ON public.comp_grants
  FOR EACH ROW
  WHEN (OLD.revoked_at IS DISTINCT FROM NEW.revoked_at)
  EXECUTE FUNCTION public.revoke_comp_grant_on_events();

REVOKE EXECUTE ON FUNCTION public.revoke_comp_grant_on_events() FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 7. Email lookup RPC — admin-only. SECURITY DEFINER so it can read
--    auth.users; the explicit is_admin check is the privilege gate.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_lookup_user_by_email(p_email TEXT)
RETURNS TABLE (user_id UUID, email TEXT, display_name TEXT, created_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp, auth
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid() AND p.is_admin = true
  ) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT u.id, u.email::text, p.display_name, u.created_at
      FROM auth.users u
      LEFT JOIN public.profiles p ON p.user_id = u.id
     WHERE lower(u.email) = lower(trim(p_email))
     LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_lookup_user_by_email(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_lookup_user_by_email(TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 8. Founder bootstrap (manual, run ONCE in the Supabase SQL editor):
--
--   UPDATE public.profiles
--      SET is_admin = true
--    WHERE user_id = (SELECT id FROM auth.users WHERE email = '<founder>');
--
-- The migration intentionally does not hard-code an email or UUID.
-- Future admin appointments go through the same SQL path; the in-app
-- /admin/comps page has no "promote admin" button.
-- ─────────────────────────────────────────────────────────────────────
