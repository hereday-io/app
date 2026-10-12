-- CRM write RPCs. Requires 20261012122000_crm_read_rpcs.sql.
--
-- Rules enforced here (from outreach/sales-kit/06-lead-tracker-fields.md):
--   * Claim before you research. Changing a deal needs ownership (or
--     admin). A claim expires after 7 days while the deal is still 'new';
--     that is computed in deal_facts, so no cron.
--   * No source URL, no contact — the crm_contacts CHECKs.
--   * Objections are their words, verbatim — activities.quote.
--   * Do not contact is permanent and overrides everything (CR002).
--
-- Automatic stage changes (logging a send, a call, a reply) only ever
-- move a deal forward. crm_set_stage is the manual correction tool and
-- may move it anywhere.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Claim / release / assign
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_claim_deal(p_deal_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp, auth
AS $$
DECLARE
  v_deal  public.crm_deals%ROWTYPE;
  v_facts crm_internal.deal_facts%ROWTYPE;
BEGIN
  PERFORM crm_internal.require_staff();

  SELECT * INTO v_deal FROM public.crm_deals d WHERE d.id = p_deal_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Deal not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_deal.owner_id = auth.uid() THEN
    RETURN crm_internal.deal_json(v_deal.id);
  END IF;

  SELECT * INTO v_facts FROM crm_internal.deal_facts f WHERE f.deal_id = v_deal.id;
  IF v_facts.is_dnc THEN
    RAISE EXCEPTION 'Do not contact: % asked not to be contacted.', v_deal.race_name
      USING ERRCODE = 'CR002';
  END IF;
  IF NOT v_facts.claim_open THEN
    RAISE EXCEPTION '%', format('%s is claimed by %s%s.', v_deal.race_name,
      coalesce(crm_internal.user_label(v_deal.owner_id), 'someone'),
      CASE WHEN v_facts.claim_expires_at IS NOT NULL
           THEN ' until ' || to_char(v_facts.claim_expires_at AT TIME ZONE 'America/Chicago', 'Mon FMDD')
           ELSE '' END)
      USING ERRCODE = 'CR001';
  END IF;

  UPDATE public.crm_deals SET owner_id = auth.uid(), claimed_at = now() WHERE id = v_deal.id;
  PERFORM crm_internal.log_activity(v_deal.id, 'claim', NULL, NULL,
    jsonb_build_object('previous_owner_id', v_deal.owner_id,
                       'took_over_expired', v_deal.owner_id IS NOT NULL));
  RETURN crm_internal.deal_json(v_deal.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_release_deal(p_deal_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp, auth
AS $$
DECLARE
  v_deal public.crm_deals%ROWTYPE;
BEGIN
  PERFORM crm_internal.require_staff();
  v_deal := crm_internal.lock_deal_for_edit(p_deal_id);
  IF v_deal.owner_id IS NULL THEN
    RETURN crm_internal.deal_json(v_deal.id);
  END IF;

  UPDATE public.crm_deals SET owner_id = NULL, claimed_at = NULL WHERE id = v_deal.id;
  PERFORM crm_internal.log_activity(v_deal.id, 'release', p_reason, NULL,
    jsonb_build_object('previous_owner_id', v_deal.owner_id));
  RETURN crm_internal.deal_json(v_deal.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_assign_deal(p_deal_id UUID, p_owner_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp, auth
AS $$
DECLARE
  v_deal public.crm_deals%ROWTYPE;
BEGIN
  PERFORM crm_internal.require_admin();
  v_deal := crm_internal.lock_deal_for_edit(p_deal_id);

  IF p_owner_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.user_id = p_owner_id AND (p.is_admin OR p.is_sales)
  ) THEN
    RAISE EXCEPTION 'Deals can only be assigned to staff.' USING ERRCODE = '22023';
  END IF;
  IF p_owner_id IS NOT DISTINCT FROM v_deal.owner_id THEN
    RETURN crm_internal.deal_json(v_deal.id);
  END IF;

  UPDATE public.crm_deals
     SET owner_id = p_owner_id,
         claimed_at = CASE WHEN p_owner_id IS NULL THEN NULL ELSE now() END
   WHERE id = v_deal.id;
  PERFORM crm_internal.log_activity(v_deal.id, 'assign', NULL, NULL,
    jsonb_build_object('previous_owner_id', v_deal.owner_id, 'owner_id', p_owner_id));
  RETURN crm_internal.deal_json(v_deal.id);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Event links
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION crm_internal.link_event(
  p_deal_id     UUID,
  p_event_id    UUID,
  p_link_source TEXT,
  p_override    BOOLEAN DEFAULT false
)
RETURNS TEXT  -- 'linked' | 'already_linked' | 'conflict:<slug>' | 'dismissed'
LANGUAGE plpgsql
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE
  v_link  public.crm_event_links%ROWTYPE;
  v_slug  TEXT;
  v_event RECORD;
BEGIN
  SELECT * INTO v_link FROM public.crm_event_links l WHERE l.event_id = p_event_id FOR UPDATE;
  IF FOUND THEN
    IF v_link.disposition = 'linked' AND v_link.deal_id = p_deal_id THEN
      RETURN 'already_linked';
    END IF;
    IF v_link.disposition = 'linked' THEN
      SELECT d.slug INTO v_slug FROM public.crm_deals d WHERE d.id = v_link.deal_id;
      RETURN 'conflict:' || coalesce(v_slug, '?');
    END IF;
    IF NOT p_override THEN
      RETURN 'dismissed';
    END IF;
    DELETE FROM public.crm_event_links WHERE event_id = p_event_id;
  END IF;

  INSERT INTO public.crm_event_links (event_id, deal_id, disposition, link_source, linked_by)
  VALUES (p_event_id, p_deal_id, 'linked', p_link_source, auth.uid());

  SELECT e.name, e.slug, e.status INTO v_event FROM public.events e WHERE e.id = p_event_id;
  PERFORM crm_internal.log_activity(p_deal_id, 'event_linked', v_event.name, NULL,
    jsonb_build_object('event_id', p_event_id, 'slug', v_event.slug, 'link_source', p_link_source));

  -- Fill the deal's public link from the first published map.
  UPDATE public.crm_deals d
     SET hereday_link = 'https://hereday.io/event/' || v_event.slug
   WHERE d.id = p_deal_id AND d.hereday_link IS NULL
     AND v_event.slug IS NOT NULL AND v_event.status = 'published';
  RETURN 'linked';
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_link_event(p_deal_id UUID, p_event_ref TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp, auth
AS $$
DECLARE
  v_deal     public.crm_deals%ROWTYPE;
  v_event_id UUID;
  v_owner    UUID;
  v_signup   UUID;
  v_result   TEXT;
BEGIN
  PERFORM crm_internal.require_staff();
  v_deal := crm_internal.lock_deal_for_edit(p_deal_id);

  v_event_id := crm_internal.resolve_event(p_event_ref);
  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'No Hereday event matches that link, slug or id.' USING ERRCODE = 'P0002';
  END IF;

  -- Reps may link their own maps and maps owned by this deal's contact.
  -- Anything else is an admin decision (it reveals whose event it is).
  IF NOT public.is_admin() THEN
    SELECT e.user_id INTO v_owner FROM public.events e WHERE e.id = v_event_id;
    SELECT f.signup_user_id INTO v_signup FROM crm_internal.deal_facts f WHERE f.deal_id = v_deal.id;
    IF v_owner IS DISTINCT FROM auth.uid() AND v_owner IS DISTINCT FROM v_signup THEN
      RAISE EXCEPTION 'You can link maps you built, or the contact''s own map. Ask an admin for anything else.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  v_result := crm_internal.link_event(v_deal.id, v_event_id,
                                      'manual', public.is_admin());
  IF v_result LIKE 'conflict:%' THEN
    RAISE EXCEPTION 'That map is already linked to %.', substr(v_result, 10) USING ERRCODE = 'CR001';
  ELSIF v_result = 'dismissed' THEN
    RAISE EXCEPTION 'An admin dismissed that map as not a customer.' USING ERRCODE = 'CR001';
  END IF;
  RETURN jsonb_build_object('result', v_result, 'deal', crm_internal.deal_json(v_deal.id));
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_unlink_event(p_event_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp, auth
AS $$
DECLARE
  v_link public.crm_event_links%ROWTYPE;
BEGIN
  PERFORM crm_internal.require_admin();
  DELETE FROM public.crm_event_links l WHERE l.event_id = p_event_id RETURNING * INTO v_link;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That event is not linked.' USING ERRCODE = 'P0002';
  END IF;
  IF v_link.deal_id IS NOT NULL THEN
    PERFORM crm_internal.log_activity(v_link.deal_id, 'event_unlinked', NULL, NULL,
      jsonb_build_object('event_id', p_event_id));
  END IF;
  RETURN jsonb_build_object('event_id', p_event_id, 'deal_id', v_link.deal_id);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 3. Create / update a deal
-- ─────────────────────────────────────────────────────────────────────

-- Finds or creates an account by name. Town stays NULL: an account is
-- the organization, and the race's town lives on the deal (one
-- race-management company runs races in several towns).
CREATE OR REPLACE FUNCTION crm_internal.upsert_account(p_name TEXT, p_org_type TEXT, p_description TEXT DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE
  v_name TEXT := NULLIF(btrim(coalesce(p_name, '')), '');
  v_id   UUID;
BEGIN
  IF v_name IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT a.id INTO v_id FROM public.crm_accounts a
   WHERE lower(a.name) = lower(v_name) AND a.town IS NULL
   LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.crm_accounts (name, org_type, org_description, created_by)
    VALUES (v_name, NULLIF(p_org_type, ''), NULLIF(btrim(coalesce(p_description, '')), ''), auth.uid())
    RETURNING id INTO v_id;
  ELSIF p_org_type IS NOT NULL THEN
    UPDATE public.crm_accounts a SET org_type = coalesce(a.org_type, NULLIF(p_org_type, ''))
     WHERE a.id = v_id;
  END IF;
  RETURN v_id;
END;
$$;

-- Raises CR004 when the slug, or the same race in the same year, is
-- already in the CRM. Reports only public fields of the existing deal.
CREATE OR REPLACE FUNCTION crm_internal.assert_not_duplicate(p_slug TEXT, p_race_name TEXT, p_race_date DATE)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE
  v_dupe public.crm_deals%ROWTYPE;
BEGIN
  SELECT * INTO v_dupe FROM public.crm_deals d WHERE d.slug = p_slug;
  IF NOT FOUND THEN
    SELECT * INTO v_dupe FROM public.crm_deals d
     WHERE crm_internal.race_key(d.race_name) = crm_internal.race_key(p_race_name)
       AND (p_race_date IS NULL OR d.race_date IS NULL
            OR extract(year FROM d.race_date) = extract(year FROM p_race_date))
     ORDER BY d.created_at DESC
     LIMIT 1;
  END IF;
  IF v_dupe.id IS NOT NULL THEN
    RAISE EXCEPTION '% is already in the CRM (%, owner: %).', v_dupe.race_name, v_dupe.slug,
      coalesce(crm_internal.user_label(v_dupe.owner_id), 'unclaimed')
      USING ERRCODE = 'CR004';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_create_deal(p_deal JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp, auth
AS $$
DECLARE
  v_race   TEXT := NULLIF(btrim(coalesce(p_deal->>'race_name', '')), '');
  v_date   DATE := NULLIF(p_deal->>'race_date', '')::date;
  v_slug   TEXT;
  v_id     UUID;
  v_event  UUID;
  v_link   TEXT;
BEGIN
  PERFORM crm_internal.require_staff();
  IF v_race IS NULL THEN
    RAISE EXCEPTION 'Race name is required.' USING ERRCODE = '22023';
  END IF;

  v_slug := coalesce(NULLIF(btrim(p_deal->>'slug'), ''),
                     crm_internal.slugify(v_race || coalesce('-' || extract(year FROM v_date)::int, '')));
  PERFORM crm_internal.assert_not_duplicate(v_slug, v_race, v_date);

  INSERT INTO public.crm_deals (
    slug, race_name, race_date, date_verified, town, tier, priority, source, stage,
    owner_id, claimed_at, channel, course_map_url, map_type, hereday_link, notes,
    fit_flags, account_id, created_by
  ) VALUES (
    v_slug, v_race, v_date,
    coalesce((p_deal->>'date_verified')::boolean, false),
    NULLIF(btrim(p_deal->>'town'), ''),
    NULLIF(p_deal->>'tier', '')::smallint,
    (SELECT coalesce(max(priority), 0) + 1 FROM public.crm_deals),
    'manual', 'new',
    auth.uid(), now(),
    NULLIF(p_deal->>'channel', ''),
    NULLIF(btrim(p_deal->>'course_map_url'), ''),
    NULLIF(p_deal->>'map_type', ''),
    NULLIF(btrim(p_deal->>'hereday_link'), ''),
    NULLIF(btrim(p_deal->>'notes'), ''),
    coalesce(ARRAY(SELECT jsonb_array_elements_text(coalesce(p_deal->'fit_flags', '[]'::jsonb))), '{}'),
    crm_internal.upsert_account(p_deal->>'account_name', p_deal->>'org_type'),
    auth.uid()
  ) RETURNING id INTO v_id;

  IF p_deal->>'hereday_link' IS NOT NULL THEN
    v_event := crm_internal.resolve_event(p_deal->>'hereday_link');
    IF v_event IS NOT NULL THEN
      v_link := crm_internal.link_event(v_id, v_event, 'hereday_link');
    END IF;
  END IF;

  RETURN jsonb_build_object('deal', crm_internal.deal_json(v_id), 'event_link', v_link);
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_update_deal(
  p_deal_id             UUID,
  p_patch               JSONB,
  p_expected_updated_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp, auth
AS $$
DECLARE
  v_deal    public.crm_deals%ROWTYPE;
  v_allowed TEXT[] := ARRAY['race_name', 'race_date', 'date_verified', 'town', 'tier', 'channel',
                            'next_step', 'next_step_at', 'fit_flags', 'course_map_url', 'map_type',
                            'hereday_link', 'notes', 'account_name', 'org_type'];
  v_bad     TEXT;
  v_event   UUID;
  v_link    TEXT;
  v_account UUID;
BEGIN
  PERFORM crm_internal.require_staff();
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'Patch must be an object.' USING ERRCODE = '22023';
  END IF;
  SELECT k INTO v_bad FROM jsonb_object_keys(p_patch) k WHERE k <> ALL (v_allowed) LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Unknown field: %', v_bad USING ERRCODE = '22023';
  END IF;

  v_deal := crm_internal.lock_deal_for_edit(p_deal_id);
  IF p_expected_updated_at IS NOT NULL AND v_deal.updated_at <> p_expected_updated_at THEN
    RAISE EXCEPTION 'This deal changed since you opened it. Reload and try again.' USING ERRCODE = 'CR003';
  END IF;

  IF p_patch ? 'account_name' THEN
    IF v_deal.account_id IS NOT NULL AND NULLIF(btrim(p_patch->>'account_name'), '') IS NOT NULL THEN
      -- Rename in place only when no other deal shares the account.
      IF NOT EXISTS (SELECT 1 FROM public.crm_deals d
                      WHERE d.account_id = v_deal.account_id AND d.id <> v_deal.id) THEN
        UPDATE public.crm_accounts a SET name = btrim(p_patch->>'account_name') WHERE a.id = v_deal.account_id;
        v_account := v_deal.account_id;
      ELSE
        v_account := crm_internal.upsert_account(p_patch->>'account_name', p_patch->>'org_type');
      END IF;
    ELSE
      v_account := crm_internal.upsert_account(p_patch->>'account_name', p_patch->>'org_type');
    END IF;
  ELSE
    v_account := v_deal.account_id;
  END IF;
  IF p_patch ? 'org_type' AND v_account IS NOT NULL THEN
    UPDATE public.crm_accounts a SET org_type = NULLIF(p_patch->>'org_type', '') WHERE a.id = v_account;
  END IF;

  UPDATE public.crm_deals d SET
    race_name      = CASE WHEN p_patch ? 'race_name'      THEN btrim(p_patch->>'race_name') ELSE d.race_name END,
    race_date      = CASE WHEN p_patch ? 'race_date'      THEN NULLIF(p_patch->>'race_date', '')::date ELSE d.race_date END,
    date_verified  = CASE WHEN p_patch ? 'date_verified'  THEN coalesce((p_patch->>'date_verified')::boolean, false) ELSE d.date_verified END,
    town           = CASE WHEN p_patch ? 'town'           THEN NULLIF(btrim(p_patch->>'town'), '') ELSE d.town END,
    tier           = CASE WHEN p_patch ? 'tier'           THEN NULLIF(p_patch->>'tier', '')::smallint ELSE d.tier END,
    channel        = CASE WHEN p_patch ? 'channel'        THEN NULLIF(p_patch->>'channel', '') ELSE d.channel END,
    next_step      = CASE WHEN p_patch ? 'next_step'      THEN NULLIF(btrim(p_patch->>'next_step'), '') ELSE d.next_step END,
    next_step_at   = CASE WHEN p_patch ? 'next_step_at'   THEN NULLIF(p_patch->>'next_step_at', '')::date ELSE d.next_step_at END,
    fit_flags      = CASE WHEN p_patch ? 'fit_flags'
                          THEN coalesce(ARRAY(SELECT jsonb_array_elements_text(coalesce(p_patch->'fit_flags', '[]'::jsonb))), '{}')
                          ELSE d.fit_flags END,
    course_map_url = CASE WHEN p_patch ? 'course_map_url' THEN NULLIF(btrim(p_patch->>'course_map_url'), '') ELSE d.course_map_url END,
    map_type       = CASE WHEN p_patch ? 'map_type'       THEN NULLIF(p_patch->>'map_type', '') ELSE d.map_type END,
    hereday_link   = CASE WHEN p_patch ? 'hereday_link'   THEN NULLIF(btrim(p_patch->>'hereday_link'), '') ELSE d.hereday_link END,
    notes          = CASE WHEN p_patch ? 'notes'          THEN NULLIF(btrim(p_patch->>'notes'), '') ELSE d.notes END,
    account_id     = v_account
  WHERE d.id = v_deal.id;

  -- A pasted Hereday link links its event when that is unambiguous.
  IF p_patch ? 'hereday_link' AND NULLIF(btrim(p_patch->>'hereday_link'), '') IS NOT NULL THEN
    v_event := crm_internal.resolve_event(p_patch->>'hereday_link');
    v_link := CASE WHEN v_event IS NULL THEN 'not_found'
                   ELSE crm_internal.link_event(v_deal.id, v_event, 'hereday_link') END;
  END IF;

  RETURN jsonb_build_object('deal', crm_internal.deal_json(v_deal.id), 'event_link', v_link);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 4. Contacts
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION crm_internal.close_for_dnc(p_contact_id UUID, p_account_id UUID, p_reason TEXT)
RETURNS JSONB  -- { closed_deal_ids: [...], draft_ids: [...] }
LANGUAGE plpgsql
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE
  v_closed UUID[] := '{}';
  v_drafts TEXT[] := '{}';
  r        RECORD;
BEGIN
  FOR r IN
    SELECT d.id, d.gmail_draft_id, d.stage
      FROM public.crm_deals d
     WHERE (p_contact_id IS NOT NULL AND d.primary_contact_id = p_contact_id)
        OR (p_account_id IS NOT NULL AND d.account_id = p_account_id)
     FOR UPDATE
  LOOP
    IF r.stage <> 'closed' THEN
      UPDATE public.crm_deals
         SET stage = 'closed', outcome = 'do_not_contact', closed_at = now(),
             next_step = NULL, next_step_at = NULL
       WHERE id = r.id;
      v_closed := v_closed || r.id;
    END IF;
    IF r.gmail_draft_id IS NOT NULL THEN
      v_drafts := v_drafts || r.gmail_draft_id;
    END IF;
    PERFORM crm_internal.log_activity(r.id, 'dnc', p_reason, NULL,
      jsonb_build_object('scope', CASE WHEN p_account_id IS NOT NULL THEN 'account' ELSE 'contact' END));
  END LOOP;
  RETURN jsonb_build_object('closed_deal_ids', to_jsonb(v_closed), 'draft_ids', to_jsonb(v_drafts));
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_upsert_contact(p_deal_id UUID, p_contact JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp, auth
AS $$
DECLARE
  v_deal     public.crm_deals%ROWTYPE;
  v_allowed  TEXT[] := ARRAY['full_name', 'role_title', 'email', 'email_source',
                             'phone', 'phone_source', 'notes'];
  v_bad      TEXT;
  v_email    TEXT;
  v_existing public.crm_contacts%ROWTYPE;
  v_blocker  RECORD;
  v_id       UUID;
  v_dnc_hit  BOOLEAN := false;
  v_digits   TEXT;
BEGIN
  PERFORM crm_internal.require_staff();
  IF p_contact IS NULL OR jsonb_typeof(p_contact) <> 'object' THEN
    RAISE EXCEPTION 'Contact must be an object.' USING ERRCODE = '22023';
  END IF;
  SELECT k INTO v_bad FROM jsonb_object_keys(p_contact) k WHERE k <> ALL (v_allowed) LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Unknown field: %', v_bad USING ERRCODE = '22023';
  END IF;

  v_deal := crm_internal.lock_deal_for_edit(p_deal_id);
  v_id := v_deal.primary_contact_id;
  v_email := lower(NULLIF(btrim(coalesce(p_contact->>'email', '')), ''));

  -- The same email already belongs to another contact: attach this deal
  -- to that person rather than duplicating them — but only when the
  -- caller can already see every deal that person is on.
  IF v_email IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.crm_contacts c
     WHERE lower(c.email) = v_email AND c.id IS DISTINCT FROM v_id;
    IF FOUND THEN
      SELECT d.race_name, d.owner_id INTO v_blocker
        FROM public.crm_deals d
       WHERE d.primary_contact_id = v_existing.id
         AND NOT crm_internal.can_view(d.owner_id)
       LIMIT 1;
      IF FOUND THEN
        RAISE EXCEPTION 'That email is already on % (owner: %). Talk to them before reaching out.',
          v_blocker.race_name, coalesce(crm_internal.user_label(v_blocker.owner_id), 'unclaimed')
          USING ERRCODE = 'CR001';
      END IF;
      v_id := v_existing.id;
      UPDATE public.crm_deals SET primary_contact_id = v_id WHERE id = v_deal.id;
    END IF;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.crm_contacts (account_id, created_by) VALUES (v_deal.account_id, auth.uid())
    RETURNING id INTO v_id;
    UPDATE public.crm_deals SET primary_contact_id = v_id WHERE id = v_deal.id;
  END IF;

  UPDATE public.crm_contacts c SET
    full_name    = CASE WHEN p_contact ? 'full_name'    THEN NULLIF(btrim(p_contact->>'full_name'), '') ELSE c.full_name END,
    role_title   = CASE WHEN p_contact ? 'role_title'   THEN NULLIF(btrim(p_contact->>'role_title'), '') ELSE c.role_title END,
    email        = CASE WHEN p_contact ? 'email'        THEN NULLIF(btrim(p_contact->>'email'), '') ELSE c.email END,
    email_source = CASE WHEN p_contact ? 'email_source' THEN NULLIF(btrim(p_contact->>'email_source'), '') ELSE c.email_source END,
    phone        = CASE WHEN p_contact ? 'phone'        THEN NULLIF(btrim(p_contact->>'phone'), '') ELSE c.phone END,
    phone_source = CASE WHEN p_contact ? 'phone_source' THEN NULLIF(btrim(p_contact->>'phone_source'), '') ELSE c.phone_source END,
    notes        = CASE WHEN p_contact ? 'notes'        THEN NULLIF(btrim(p_contact->>'notes'), '') ELSE c.notes END,
    account_id   = coalesce(c.account_id, v_deal.account_id)
  WHERE c.id = v_id;

  -- Suppression: a phone number someone already asked us not to use.
  SELECT regexp_replace(c.phone, '\D', '', 'g') INTO v_digits FROM public.crm_contacts c WHERE c.id = v_id;
  IF v_digits IS NOT NULL AND length(v_digits) >= 7 AND EXISTS (
    SELECT 1 FROM public.crm_contacts o
     WHERE o.id <> v_id AND o.do_not_contact
       AND regexp_replace(o.phone, '\D', '', 'g') = v_digits
  ) THEN
    UPDATE public.crm_contacts
       SET do_not_contact = true, dnc_at = now(), dnc_by = auth.uid(),
           dnc_reason = 'Phone matches a do-not-contact record.'
     WHERE id = v_id AND NOT do_not_contact;
    PERFORM crm_internal.close_for_dnc(v_id, NULL, 'Phone matches a do-not-contact record.');
    v_dnc_hit := true;
  END IF;

  RETURN jsonb_build_object('contact_id', v_id, 'dnc_match', v_dnc_hit,
                            'deal', crm_internal.deal_json(v_deal.id));
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_mark_dnc(p_deal_id UUID, p_scope TEXT, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp, auth
AS $$
DECLARE
  v_deal   public.crm_deals%ROWTYPE;
  v_reason TEXT := NULLIF(btrim(coalesce(p_reason, '')), '');
BEGIN
  PERFORM crm_internal.require_staff();
  IF v_reason IS NULL OR length(v_reason) > 500 THEN
    RAISE EXCEPTION 'Say why, in under 500 characters.' USING ERRCODE = '22023';
  END IF;
  IF p_scope NOT IN ('contact', 'account') THEN
    RAISE EXCEPTION 'Scope must be contact or account.' USING ERRCODE = '22023';
  END IF;
  v_deal := crm_internal.lock_deal_for_edit(p_deal_id);

  IF p_scope = 'contact' THEN
    IF v_deal.primary_contact_id IS NULL THEN
      RAISE EXCEPTION 'This deal has no contact to mark.' USING ERRCODE = '22023';
    END IF;
    UPDATE public.crm_contacts
       SET do_not_contact = true, dnc_at = now(), dnc_by = auth.uid(), dnc_reason = v_reason
     WHERE id = v_deal.primary_contact_id AND NOT do_not_contact;
    RETURN crm_internal.close_for_dnc(v_deal.primary_contact_id, NULL, v_reason);
  END IF;

  IF v_deal.account_id IS NULL THEN
    RAISE EXCEPTION 'This deal has no organization to mark.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.crm_accounts
     SET do_not_contact = true, dnc_at = now(), dnc_by = auth.uid(), dnc_reason = v_reason
   WHERE id = v_deal.account_id AND NOT do_not_contact;
  RETURN crm_internal.close_for_dnc(NULL, v_deal.account_id, v_reason);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 5. Stage and activity
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_set_stage(
  p_deal_id     UUID,
  p_stage       TEXT,
  p_outcome     TEXT DEFAULT NULL,
  p_note        TEXT DEFAULT NULL,
  p_occurred_on DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp, auth
AS $$
DECLARE
  v_deal public.crm_deals%ROWTYPE;
  v_on   DATE := coalesce(p_occurred_on, crm_internal.today());
BEGIN
  PERFORM crm_internal.require_staff();
  IF crm_internal.stage_rank(p_stage) IS NULL THEN
    RAISE EXCEPTION 'Unknown stage: %', p_stage USING ERRCODE = '22023';
  END IF;
  IF p_stage = 'closed' AND NULLIF(p_outcome, '') IS NULL THEN
    RAISE EXCEPTION 'Closing a deal needs an outcome.' USING ERRCODE = '22023';
  END IF;

  v_deal := crm_internal.lock_deal_for_edit(p_deal_id);
  IF p_stage IN ('drafted', 'sent', 'followed_up') AND crm_internal.deal_is_dnc(v_deal.id) THEN
    RAISE EXCEPTION 'Do not contact: % asked not to be contacted.', v_deal.race_name USING ERRCODE = 'CR002';
  END IF;
  IF p_stage = v_deal.stage AND p_outcome IS NOT DISTINCT FROM v_deal.outcome THEN
    RETURN crm_internal.deal_json(v_deal.id);
  END IF;

  UPDATE public.crm_deals d SET
    stage          = p_stage,
    outcome        = CASE WHEN p_stage = 'closed' THEN p_outcome ELSE NULL END,
    closed_at      = CASE WHEN p_stage = 'closed' THEN coalesce(d.closed_at, now()) ELSE NULL END,
    sent_at        = CASE WHEN p_stage IN ('sent', 'followed_up', 'replied') THEN coalesce(d.sent_at, v_on)
                          ELSE d.sent_at END,
    followed_up_at = CASE WHEN p_stage = 'followed_up' THEN coalesce(d.followed_up_at, v_on)
                          ELSE d.followed_up_at END,
    next_step      = CASE WHEN p_stage = 'closed' THEN NULL
                          WHEN p_stage = 'no_contact' AND d.next_step_at IS NULL
                            THEN 'Revisit when spring race pages go up'
                          ELSE d.next_step END,
    next_step_at   = CASE WHEN p_stage = 'closed' THEN NULL
                          WHEN p_stage = 'no_contact' AND d.next_step_at IS NULL
                            THEN make_date(extract(year FROM v_on)::int
                                           + CASE WHEN extract(month FROM v_on) = 12 THEN 1 ELSE 0 END, 12, 1)
                          ELSE d.next_step_at END
  WHERE d.id = v_deal.id;

  PERFORM crm_internal.log_activity(v_deal.id, 'stage_change', p_note, NULL,
    jsonb_build_object('from', v_deal.stage, 'to', p_stage, 'outcome', p_outcome),
    CASE WHEN p_occurred_on IS NULL THEN now()
         ELSE (p_occurred_on + time '12:00') AT TIME ZONE 'America/Chicago' END);
  RETURN crm_internal.deal_json(v_deal.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_log_activity(
  p_deal_id     UUID,
  p_type        TEXT,
  p_body        TEXT        DEFAULT NULL,
  p_quote       TEXT        DEFAULT NULL,
  p_occurred_at TIMESTAMPTZ DEFAULT NULL,
  p_meta        JSONB       DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp, auth
AS $$
DECLARE
  v_deal     public.crm_deals%ROWTYPE;
  v_at       TIMESTAMPTZ := coalesce(p_occurred_at, now());
  v_on       DATE := (coalesce(p_occurred_at, now()) AT TIME ZONE 'America/Chicago')::date;
  v_outbound BOOLEAN := p_type IN ('email_sent', 'followup_sent', 'call', 'voicemail', 'form_submitted');
  v_rank     INT;
  v_id       UUID;
BEGIN
  PERFORM crm_internal.require_staff();
  IF p_type NOT IN ('note', 'email_sent', 'followup_sent', 'call', 'voicemail', 'form_submitted',
                    'reply', 'objection', 'research', 'handoff_requested',
                    'backlink_asked', 'backlink_live') THEN
    RAISE EXCEPTION 'Unknown activity type: %', p_type USING ERRCODE = '22023';
  END IF;
  IF p_type = 'objection' AND NULLIF(btrim(coalesce(p_quote, '')), '') IS NULL THEN
    RAISE EXCEPTION 'An objection needs their exact words.' USING ERRCODE = '22023';
  END IF;
  IF p_meta IS NOT NULL AND jsonb_typeof(p_meta) <> 'object' THEN
    RAISE EXCEPTION 'Meta must be an object.' USING ERRCODE = '22023';
  END IF;
  IF v_at > now() + interval '1 day' THEN
    RAISE EXCEPTION 'That date is in the future.' USING ERRCODE = '22023';
  END IF;

  v_deal := crm_internal.lock_deal_for_edit(p_deal_id);
  IF v_outbound AND crm_internal.deal_is_dnc(v_deal.id) THEN
    RAISE EXCEPTION 'Do not contact: % asked not to be contacted.', v_deal.race_name USING ERRCODE = 'CR002';
  END IF;

  BEGIN
    v_id := crm_internal.log_activity(v_deal.id, p_type, p_body, p_quote, coalesce(p_meta, '{}'::jsonb), v_at);
  EXCEPTION WHEN unique_violation THEN
    -- Same meta.dedupe_key logged twice (CLI re-run): a no-op.
    RETURN jsonb_build_object('activity_id', NULL, 'duplicate', true,
                              'deal', crm_internal.deal_json(v_deal.id));
  END;

  v_rank := crm_internal.stage_rank(v_deal.stage);

  IF p_type IN ('email_sent', 'form_submitted')
     OR (p_type IN ('call', 'voicemail', 'followup_sent') AND v_deal.sent_at IS NULL) THEN
    -- First contact.
    UPDATE public.crm_deals d SET
      stage        = CASE WHEN v_rank < 3 OR d.stage = 'no_contact' THEN 'sent' ELSE d.stage END,
      sent_at      = coalesce(d.sent_at, v_on),
      channel      = coalesce(d.channel, CASE p_type WHEN 'form_submitted' THEN 'form'
                                                     WHEN 'email_sent' THEN 'email'
                                                     ELSE 'phone' END),
      next_step    = CASE WHEN d.sent_at IS NULL THEN 'Follow up once (call if there''s a phone)' ELSE d.next_step END,
      next_step_at = CASE WHEN d.sent_at IS NULL THEN crm_internal.add_business_days(v_on, 5) ELSE d.next_step_at END
    WHERE d.id = v_deal.id;
  ELSIF p_type IN ('followup_sent', 'call', 'voicemail') THEN
    UPDATE public.crm_deals d SET
      stage          = CASE WHEN v_rank < 4 THEN 'followed_up' ELSE d.stage END,
      followed_up_at = coalesce(d.followed_up_at, v_on),
      next_step      = CASE WHEN d.followed_up_at IS NULL AND v_rank < 5
                            THEN 'No reply? Close as no response' ELSE d.next_step END,
      next_step_at   = CASE WHEN d.followed_up_at IS NULL AND v_rank < 5
                            THEN crm_internal.add_business_days(v_on, 5) ELSE d.next_step_at END
    WHERE d.id = v_deal.id;
  ELSIF p_type IN ('reply', 'objection') THEN
    -- A reply reopens a deal closed for silence; it never reopens one
    -- closed because they asked us to stop.
    UPDATE public.crm_deals d SET
      stage        = CASE WHEN v_rank < 5
                            OR (d.stage = 'closed' AND d.outcome IN ('no_response', 'timing', 'other'))
                          THEN 'replied' ELSE d.stage END,
      outcome      = CASE WHEN d.stage = 'closed' AND d.outcome IN ('no_response', 'timing', 'other')
                          THEN NULL ELSE d.outcome END,
      closed_at    = CASE WHEN d.stage = 'closed' AND d.outcome IN ('no_response', 'timing', 'other')
                          THEN NULL ELSE d.closed_at END,
      sent_at      = coalesce(d.sent_at, v_on),
      next_step    = NULL,
      next_step_at = NULL,
      objection    = CASE WHEN p_type = 'objection' THEN btrim(p_quote) ELSE d.objection END
    WHERE d.id = v_deal.id;
  END IF;

  RETURN jsonb_build_object('activity_id', v_id, 'duplicate', false,
                            'deal', crm_internal.deal_json(v_deal.id));
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_void_activity(p_activity_id UUID, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp, auth
AS $$
DECLARE
  v_reason TEXT := NULLIF(btrim(coalesce(p_reason, '')), '');
  v_row    public.crm_activities%ROWTYPE;
BEGIN
  PERFORM crm_internal.require_admin();
  IF v_reason IS NULL OR length(v_reason) > 500 THEN
    RAISE EXCEPTION 'Say why, in under 500 characters.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.crm_activities
     SET voided_at = now(), voided_by = auth.uid(), void_reason = v_reason
   WHERE id = p_activity_id AND voided_at IS NULL
  RETURNING * INTO v_row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Activity not found, or already voided.' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object('activity_id', v_row.id, 'deal_id', v_row.deal_id);
END;
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA crm_internal FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 6. Grants.
-- ─────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.crm_claim_deal(UUID)                               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crm_release_deal(UUID, TEXT)                       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crm_assign_deal(UUID, UUID)                        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crm_link_event(UUID, TEXT)                         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crm_unlink_event(UUID)                             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crm_create_deal(JSONB)                             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crm_update_deal(UUID, JSONB, TIMESTAMPTZ)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crm_upsert_contact(UUID, JSONB)                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crm_mark_dnc(UUID, TEXT, TEXT)                     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crm_set_stage(UUID, TEXT, TEXT, TEXT, DATE)        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crm_log_activity(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crm_void_activity(UUID, TEXT)                      FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.crm_claim_deal(UUID)                               TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_release_deal(UUID, TEXT)                       TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_assign_deal(UUID, UUID)                        TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_link_event(UUID, TEXT)                         TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_unlink_event(UUID)                             TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_create_deal(JSONB)                             TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_update_deal(UUID, JSONB, TIMESTAMPTZ)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_upsert_contact(UUID, JSONB)                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_mark_dnc(UUID, TEXT, TEXT)                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_set_stage(UUID, TEXT, TEXT, TEXT, DATE)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_log_activity(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_void_activity(UUID, TEXT)                      TO authenticated;
