-- Admin event transfer: move an event (map) from one account to another.
--
-- Why: outreach maps are built in Kevin's or a rep's account. When a race
-- director signs up and wants to edit "their" map, an admin hands it over
-- from /admin/transfers. Clean handoff: the recipient becomes the sole
-- owner and the event leaves the builder's dashboard.
--
-- events.user_id can't be changed from the client: the UPDATE policy has
-- no WITH CHECK, so its USING (auth.uid() = user_id) is applied to the new
-- row too, and admins have no extra policy on events. So the move happens
-- in a SECURITY DEFINER RPC behind the same inline is_admin gate as
-- admin_lookup_user_by_email (20260504120000_comp_grants.sql).
--
-- Everything keyed by event id (subscribers, email history, POI statuses,
-- analytics, tracking) follows user_id automatically. The slug and public
-- URL don't depend on the owner, so links already sent keep working.
-- What this function fixes up beyond user_id:
--   * Pro travels with the map. An event comped through the OLD owner's
--     grant is detached from that grant (comp_grant_id = NULL, paid_at
--     kept) so revoking the old owner's comp can't downgrade it later.
--     Stripe-paid events are untouched. A free event picks up the
--     recipient's active comp grant if they have one, mirroring
--     stamp_comp_on_new_event.
--   * Volunteer/scout tokens are re-pointed to the recipient so a later
--     deletion of the old account can't cascade them away.
--
-- Not handled (accepted for v1): uploaded logo/POI images stay under the
-- old owner's storage folder. They keep rendering; the recipient's new
-- uploads land under their own folder.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Audit log. Snapshots name/slug/emails so the history still reads
--    after an event or account is deleted, and so the admin page can
--    show emails without reading auth.users. No FK to events on purpose
--    (same reasoning as product_events.event_id).
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.event_transfers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL,
  event_name      TEXT NOT NULL,
  event_slug      TEXT,
  from_user_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  from_email      TEXT,
  to_user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  to_email        TEXT NOT NULL,
  transferred_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  transferred_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  pro_source      TEXT NOT NULL
    CHECK (pro_source IN ('stripe', 'comp_detached', 'comp_recipient', 'paid_other', 'free')),
  note            TEXT CHECK (note IS NULL OR length(note) <= 500)
);

CREATE INDEX IF NOT EXISTS event_transfers_time_idx
  ON public.event_transfers (transferred_at DESC);
CREATE INDEX IF NOT EXISTS event_transfers_event_idx
  ON public.event_transfers (event_id);

ALTER TABLE public.event_transfers ENABLE ROW LEVEL SECURITY;

-- Admins read the history. No INSERT/UPDATE/DELETE policies: rows are
-- written only by admin_transfer_event (definer) and are never edited.
DROP POLICY IF EXISTS "Admins can read event transfers" ON public.event_transfers;
CREATE POLICY "Admins can read event transfers"
  ON public.event_transfers
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.user_id = auth.uid() AND p.is_admin = true
    )
  );

-- ─────────────────────────────────────────────────────────────────────
-- 2. admin_get_event — look up any event by id or slug. Admins have no
--    RLS access to other users' events, so the transfer page needs this.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_event(p_ref TEXT)
RETURNS TABLE (
  id                UUID,
  name              TEXT,
  slug              TEXT,
  status            TEXT,
  event_date        DATE,
  owner_id          UUID,
  owner_email       TEXT,
  paid_at           TIMESTAMPTZ,
  comp_grant_id     UUID,
  stripe_payment_id TEXT,
  route_count       INT,
  poi_count         INT,
  updated_at        TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp, auth
AS $$
DECLARE
  v_ref TEXT := trim(coalesce(p_ref, ''));
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid() AND p.is_admin = true
  ) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT e.id, e.name, e.slug, e.status::text, e.event_date,
           e.user_id, u.email::text,
           e.paid_at, e.comp_grant_id, e.stripe_payment_id::text,
           COALESCE(jsonb_array_length(e.routes), 0),
           COALESCE(jsonb_array_length(e.pois), 0),
           e.updated_at
      FROM public.events e
      LEFT JOIN auth.users u ON u.id = e.user_id
     WHERE (v_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            AND e.id = v_ref::uuid)
        OR e.slug = v_ref
     LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_event(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_event(TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 3. admin_transfer_event — the handoff, in one transaction.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_transfer_event(
  p_event_id UUID,
  p_to_email TEXT,
  p_note     TEXT DEFAULT NULL
)
RETURNS TABLE (
  event_id   UUID,
  event_slug TEXT,
  event_name TEXT,
  to_email   TEXT,
  pro_source TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp, auth
AS $$
DECLARE
  v_event      public.events%ROWTYPE;
  v_to_id      UUID;
  v_to_email   TEXT;
  v_from_email TEXT;
  v_grant_id   UUID;
  v_pro_source TEXT;
  v_note       TEXT := NULLIF(trim(coalesce(p_note, '')), '');
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid() AND p.is_admin = true
  ) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  IF v_note IS NOT NULL AND length(v_note) > 500 THEN
    RAISE EXCEPTION 'Note must be 500 characters or fewer' USING ERRCODE = '22023';
  END IF;

  -- Lock the row so a concurrent autosave or second transfer can't race us.
  SELECT * INTO v_event FROM public.events e WHERE e.id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT u.id, u.email::text INTO v_to_id, v_to_email
    FROM auth.users u
   WHERE lower(u.email) = lower(trim(coalesce(p_to_email, '')))
   LIMIT 1;
  IF v_to_id IS NULL THEN
    RAISE EXCEPTION 'No Hereday account uses %. Ask them to sign up at hereday.io/signup first.',
      trim(coalesce(p_to_email, '')) USING ERRCODE = 'P0002';
  END IF;

  IF v_to_id = v_event.user_id THEN
    RAISE EXCEPTION '% already owns this event.', v_to_email USING ERRCODE = '22023';
  END IF;

  SELECT u.email::text INTO v_from_email FROM auth.users u WHERE u.id = v_event.user_id;

  -- Pro travels with the map.
  IF v_event.stripe_payment_id IS NOT NULL THEN
    v_pro_source := 'stripe';
  ELSIF v_event.comp_grant_id IS NOT NULL THEN
    v_pro_source := 'comp_detached';
  ELSIF v_event.paid_at IS NOT NULL THEN
    v_pro_source := 'paid_other';
  ELSE
    SELECT g.id INTO v_grant_id
      FROM public.comp_grants g
     WHERE g.user_id = v_to_id AND g.revoked_at IS NULL
     ORDER BY g.granted_at DESC
     LIMIT 1;
    v_pro_source := CASE WHEN v_grant_id IS NOT NULL THEN 'comp_recipient' ELSE 'free' END;
  END IF;

  UPDATE public.events e
     SET user_id       = v_to_id,
         comp_grant_id = CASE v_pro_source
                           WHEN 'comp_detached'  THEN NULL
                           WHEN 'comp_recipient' THEN v_grant_id
                           ELSE e.comp_grant_id
                         END,
         paid_at       = CASE WHEN v_pro_source = 'comp_recipient' THEN now() ELSE e.paid_at END,
         plan          = CASE WHEN v_pro_source = 'comp_recipient' THEN 'pro' ELSE e.plan END
   WHERE e.id = p_event_id;

  UPDATE public.poi_volunteer_tokens t
     SET created_by = v_to_id
   WHERE t.event_id = p_event_id;

  INSERT INTO public.event_transfers (
    event_id, event_name, event_slug,
    from_user_id, from_email, to_user_id, to_email,
    transferred_by, pro_source, note
  ) VALUES (
    p_event_id, v_event.name, v_event.slug,
    v_event.user_id, v_from_email, v_to_id, v_to_email,
    auth.uid(), v_pro_source, v_note
  );

  INSERT INTO public.product_events (event_type, user_id, event_id, properties)
  VALUES (
    'event_transferred', auth.uid(), p_event_id,
    jsonb_build_object(
      'from_user_id', v_event.user_id,
      'to_user_id',   v_to_id,
      'pro_source',   v_pro_source
    )
  );

  RETURN QUERY SELECT p_event_id, v_event.slug, v_event.name, v_to_email, v_pro_source;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_transfer_event(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_transfer_event(UUID, TEXT, TEXT) TO authenticated;
