-- CRM RPCs for the command line (scripts/crm.mjs) and the /outreach-*
-- skills. Requires 20261012124000_crm_import_triage.sql.
--
--   * crm_update_deal also takes gmail_draft_id / gmail_draft_mailbox /
--     gmail_thread_id, so scripts/outreach-gmail.mjs can record the draft
--     it pushed. Refused (CR002) on a do-not-contact deal.
--   * crm_list_objections — every logged objection the caller may see,
--     newest first, for "is this the third time we've heard this?".
--   * crm_export — admin-only full dump (deal, account, contact, sources)
--     for CSV backups. Nothing else returns contact sources in bulk.
--   * crm_import sets the 5-business-day follow-up on imported sends,
--     and a backfill gives already-imported Sent deals theirs.
--
-- The CLI signs in as a real staff user and calls these like the admin
-- UI does; there is no service-role key anywhere in the pipeline.

-- ─────────────────────────────────────────────────────────────────────
-- 1. crm_update_deal — adds the three Gmail fields to the whitelist.
--    Otherwise identical to 20261012123000.
-- ─────────────────────────────────────────────────────────────────────
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
                            'hereday_link', 'notes', 'account_name', 'org_type',
                            'gmail_draft_id', 'gmail_draft_mailbox', 'gmail_thread_id'];
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
  IF NULLIF(btrim(coalesce(p_patch->>'gmail_draft_id', '')), '') IS NOT NULL
     AND crm_internal.deal_is_dnc(v_deal.id) THEN
    RAISE EXCEPTION 'Do not contact: % asked not to be contacted.', v_deal.race_name USING ERRCODE = 'CR002';
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
    gmail_draft_id      = CASE WHEN p_patch ? 'gmail_draft_id'      THEN NULLIF(btrim(p_patch->>'gmail_draft_id'), '') ELSE d.gmail_draft_id END,
    gmail_draft_mailbox = CASE WHEN p_patch ? 'gmail_draft_mailbox' THEN NULLIF(btrim(p_patch->>'gmail_draft_mailbox'), '') ELSE d.gmail_draft_mailbox END,
    gmail_thread_id     = CASE WHEN p_patch ? 'gmail_thread_id'     THEN NULLIF(btrim(p_patch->>'gmail_thread_id'), '') ELSE d.gmail_thread_id END,
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
-- 2. crm_list_objections
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_list_objections()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp, auth
AS $$
BEGIN
  PERFORM crm_internal.require_staff();
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'deal_slug',   d.slug,
             'race_name',   d.race_name,
             'owner_name',  crm_internal.user_label(d.owner_id),
             'occurred_at', x.occurred_at,
             'quote',       x.quote,
             'body',        x.body
           ) ORDER BY x.occurred_at DESC)
      FROM public.crm_activities x
      JOIN public.crm_deals d ON d.id = x.deal_id
     WHERE x.type = 'objection'
       AND x.voided_at IS NULL
       AND crm_internal.can_view(d.owner_id)
  ), '[]'::jsonb);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 3. crm_export — admin only.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_export()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp, auth
AS $$
BEGIN
  PERFORM crm_internal.require_admin();
  RETURN coalesce((
    SELECT jsonb_agg(
             crm_internal.deal_json(d.id)
             || jsonb_build_object(
                  'org_description', a.org_description,
                  'contact_role',    c.role_title,
                  'email_source',    c.email_source,
                  'phone_source',    c.phone_source,
                  'contact_dnc',     c.do_not_contact,
                  'account_dnc',     a.do_not_contact,
                  'dnc_reason',      coalesce(c.dnc_reason, a.dnc_reason)
                )
             ORDER BY d.priority NULLS LAST, d.created_at)
      FROM public.crm_deals d
      LEFT JOIN public.crm_accounts a ON a.id = d.account_id
      LEFT JOIN public.crm_contacts c ON c.id = d.primary_contact_id
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.crm_update_deal(UUID, JSONB, TIMESTAMPTZ) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crm_list_objections()                      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crm_export()                               FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_update_deal(UUID, JSONB, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_list_objections()                      TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_export()                               TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 4. Imported sends get a follow-up date.
--
--    crm_log_activity sets "follow up in 5 business days" when a send is
--    logged, but crm_import copied sent_at without it, so imported Sent
--    deals never showed under Follow-ups due. import_row now applies the
--    same rule (identical to 20261012124000 otherwise), and the backfill
--    below fills the rows already imported. Only empty next steps are
--    touched; running this twice changes nothing.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION crm_internal.import_row(r JSONB, p_source TEXT, p_mode TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_catalog, pg_temp, auth
AS $$
DECLARE
  v_slug     TEXT := btrim(coalesce(r->>'slug', ''));
  v_race     TEXT := NULLIF(btrim(coalesce(r->>'race_name', '')), '');
  v_date     DATE := NULLIF(r->>'race_date', '')::date;
  v_c        JSONB := coalesce(r->'contact', '{}'::jsonb);
  v_warn     JSONB := '[]'::jsonb;
  v_deal     public.crm_deals%ROWTYPE;
  v_dupe     public.crm_deals%ROWTYPE;
  v_account  UUID;
  v_contact  UUID;
  v_email    TEXT := NULLIF(btrim(coalesce(v_c->>'email', '')), '');
  v_phone    TEXT := NULLIF(btrim(coalesce(v_c->>'phone', '')), '');
  v_dnc      BOOLEAN := false;
  v_owner    UUID := NULLIF(r->>'owner_id', '')::uuid;
  v_stage    TEXT := coalesce(NULLIF(r->>'stage', ''), 'new');
  v_outcome  TEXT := NULLIF(r->>'outcome', '');
  v_channel  TEXT := NULLIF(r->>'channel', '');
  v_sent     DATE := NULLIF(r->>'sent_at', '')::date;
  v_followed DATE := NULLIF(r->>'followed_up_at', '')::date;
  v_link     TEXT;
  v_event    UUID;
  v_others   TEXT;
  v_facts    crm_internal.deal_facts%ROWTYPE;
  v_claim    TEXT;
  v_noon     TIME := time '12:00';
BEGIN
  IF v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR length(v_slug) > 80 THEN
    RAISE EXCEPTION 'Bad slug "%": lowercase letters, digits and dashes only.', v_slug USING ERRCODE = '22023';
  END IF;
  IF v_race IS NULL THEN
    RAISE EXCEPTION 'Race name is missing.' USING ERRCODE = '22023';
  END IF;
  IF crm_internal.stage_rank(v_stage) IS NULL THEN
    RAISE EXCEPTION 'Unknown stage "%".', v_stage USING ERRCODE = '22023';
  END IF;

  -- ── Already imported ──────────────────────────────────────────────
  SELECT * INTO v_deal FROM public.crm_deals d WHERE d.slug = v_slug FOR UPDATE;
  IF FOUND THEN
    IF p_mode = 'insert_only' THEN
      RETURN jsonb_build_object('slug', v_slug, 'action', 'exists', 'deal_id', v_deal.id, 'warnings', v_warn);
    END IF;
    -- fill_blanks: only fields the CRM doesn't have yet. Used at cutover
    -- to pick up draft ids and links written to the CSV in the gap.
    UPDATE public.crm_deals d SET
      gmail_draft_id = coalesce(d.gmail_draft_id, NULLIF(r->>'gmail_draft_id', '')),
      hereday_link   = coalesce(d.hereday_link,   NULLIF(r->>'hereday_link', '')),
      sent_at        = coalesce(d.sent_at,        v_sent),
      followed_up_at = coalesce(d.followed_up_at, v_followed),
      course_map_url = coalesce(d.course_map_url, NULLIF(r->>'course_map_url', '')),
      map_type       = coalesce(d.map_type,       NULLIF(r->>'map_type', '')),
      race_date      = coalesce(d.race_date,      v_date),
      town           = coalesce(d.town,           NULLIF(r->>'town', '')),
      channel        = coalesce(d.channel,        v_channel)
    WHERE d.id = v_deal.id;
    IF v_deal.hereday_link IS NULL AND NULLIF(r->>'hereday_link', '') IS NOT NULL THEN
      v_event := crm_internal.resolve_event(r->>'hereday_link');
      v_link := CASE WHEN v_event IS NULL THEN 'not_found'
                     ELSE crm_internal.link_event(v_deal.id, v_event, 'import') END;
    END IF;
    RETURN jsonb_build_object('slug', v_slug, 'action', 'filled', 'deal_id', v_deal.id,
                              'event_link', v_link, 'warnings', v_warn);
  END IF;

  -- ── Same race under another slug (Kevin and a rep both have it) ──
  SELECT * INTO v_dupe FROM public.crm_deals d
   WHERE crm_internal.race_key(d.race_name) = crm_internal.race_key(v_race)
     AND (v_date IS NULL OR d.race_date IS NULL
          OR extract(year FROM d.race_date) = extract(year FROM v_date))
   LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('slug', v_slug, 'action', 'conflict', 'deal_id', v_dupe.id,
      'conflict_with', v_dupe.slug,
      'conflict_owner', coalesce(crm_internal.user_label(v_dupe.owner_id), 'unclaimed'),
      'warnings', v_warn);
  END IF;

  -- ── Account ───────────────────────────────────────────────────────
  v_account := crm_internal.upsert_account(r->'account'->>'name', r->'account'->>'org_type',
                                           r->'account'->>'org_description');

  -- ── Contact ───────────────────────────────────────────────────────
  IF v_email IS NOT NULL AND NOT coalesce(crm_internal.valid_source(v_c->>'email_source'), false) THEN
    v_warn := v_warn || to_jsonb('Email dropped: no source URL.'::text);
    v_email := NULL;
  END IF;
  IF v_phone IS NOT NULL AND NOT coalesce(crm_internal.valid_source(v_c->>'phone_source'), false) THEN
    v_warn := v_warn || to_jsonb('Phone dropped: no source URL.'::text);
    v_phone := NULL;
  END IF;

  IF v_email IS NOT NULL THEN
    SELECT c.id INTO v_contact FROM public.crm_contacts c WHERE lower(c.email) = lower(v_email);
  END IF;
  IF v_contact IS NULL AND v_phone IS NOT NULL AND length(regexp_replace(v_phone, '\D', '', 'g')) >= 7 THEN
    SELECT c.id INTO v_contact FROM public.crm_contacts c
     WHERE regexp_replace(c.phone, '\D', '', 'g') = regexp_replace(v_phone, '\D', '', 'g')
     LIMIT 1;
  END IF;

  IF v_contact IS NOT NULL THEN
    SELECT string_agg(d.slug, ', ') INTO v_others FROM public.crm_deals d WHERE d.primary_contact_id = v_contact;
    IF v_others IS NOT NULL THEN
      v_warn := v_warn || to_jsonb(('Shares a contact with ' || v_others || '.')::text);
    END IF;
  ELSIF v_email IS NOT NULL OR v_phone IS NOT NULL OR NULLIF(btrim(v_c->>'full_name'), '') IS NOT NULL THEN
    INSERT INTO public.crm_contacts (account_id, full_name, email, email_source, phone, phone_source, created_by)
    VALUES (v_account, NULLIF(btrim(v_c->>'full_name'), ''),
            v_email, CASE WHEN v_email IS NOT NULL THEN btrim(v_c->>'email_source') END,
            v_phone, CASE WHEN v_phone IS NOT NULL THEN btrim(v_c->>'phone_source') END,
            auth.uid())
    RETURNING id INTO v_contact;
  END IF;

  IF v_contact IS NOT NULL AND (v_c->>'do_not_contact') = 'true' THEN
    UPDATE public.crm_contacts
       SET do_not_contact = true, dnc_at = now(), dnc_by = auth.uid(),
           dnc_reason = 'Marked do not contact in ' || p_source || '.'
     WHERE id = v_contact AND NOT do_not_contact;
  END IF;
  SELECT coalesce(c.do_not_contact, false) INTO v_dnc FROM public.crm_contacts c WHERE c.id = v_contact;
  v_dnc := coalesce(v_dnc, false)
           OR coalesce((SELECT a.do_not_contact FROM public.crm_accounts a WHERE a.id = v_account), false);

  -- ── Owner, stage ──────────────────────────────────────────────────
  IF v_owner IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.user_id = v_owner AND (p.is_admin OR p.is_sales)
  ) THEN
    v_warn := v_warn || to_jsonb('Owner is not staff; left unclaimed.'::text);
    v_owner := NULL;
  END IF;
  IF v_stage = 'closed' AND v_outcome IS NULL THEN
    v_outcome := 'other';
    v_warn := v_warn || to_jsonb('Closed with no outcome; recorded as other.'::text);
  END IF;
  IF v_dnc AND v_stage <> 'closed' THEN
    v_stage := 'closed';
    v_outcome := 'do_not_contact';
    v_warn := v_warn || to_jsonb('Do not contact: imported as closed.'::text);
  END IF;
  IF v_stage <> 'closed' THEN
    v_outcome := NULL;
  END IF;

  INSERT INTO public.crm_deals (
    slug, account_id, primary_contact_id, race_name, race_date, date_verified, town, tier,
    priority, source, stage, outcome, closed_at, owner_id, claimed_at, channel, sent_at,
    followed_up_at, next_step, next_step_at, objection, fit_flags, course_map_url, map_type,
    hereday_link, gmail_draft_id, notes, created_by
  ) VALUES (
    v_slug, v_account, v_contact, v_race, v_date,
    coalesce((r->>'date_verified')::boolean, false),
    NULLIF(btrim(coalesce(r->>'town', '')), ''),
    NULLIF(r->>'tier', '')::smallint,
    coalesce(NULLIF(r->>'priority', '')::int,
             (SELECT coalesce(max(priority), 0) + 1 FROM public.crm_deals)),
    p_source, v_stage, v_outcome,
    CASE WHEN v_stage = 'closed' THEN now() END,
    v_owner,
    CASE WHEN v_owner IS NOT NULL THEN coalesce(NULLIF(r->>'claimed_at', '')::timestamptz, now()) END,
    v_channel, v_sent, v_followed,
    CASE WHEN v_stage = 'closed' THEN NULL
         ELSE coalesce(NULLIF(btrim(coalesce(r->>'next_step', '')), ''),
                       CASE WHEN v_stage = 'followed_up' AND v_followed IS NOT NULL
                              THEN 'No reply? Close as no response'
                            WHEN v_stage = 'sent' AND v_sent IS NOT NULL
                              THEN 'Follow up once (call if there''s a phone)' END) END,
    CASE WHEN v_stage = 'closed' THEN NULL
         ELSE coalesce(NULLIF(r->>'next_step_at', '')::date,
                       CASE WHEN v_stage = 'followed_up' AND v_followed IS NOT NULL
                              THEN crm_internal.add_business_days(v_followed, 5)
                            WHEN v_stage = 'sent' AND v_sent IS NOT NULL
                              THEN crm_internal.add_business_days(v_sent, 5) END) END,
    NULLIF(btrim(coalesce(r->>'objection', '')), ''),
    coalesce(ARRAY(SELECT jsonb_array_elements_text(coalesce(r->'fit_flags', '[]'::jsonb))), '{}'),
    NULLIF(btrim(coalesce(r->>'course_map_url', '')), ''),
    NULLIF(r->>'map_type', ''),
    NULLIF(btrim(coalesce(r->>'hereday_link', '')), ''),
    NULLIF(btrim(coalesce(r->>'gmail_draft_id', '')), ''),
    NULLIF(btrim(coalesce(r->>'notes', '')), ''),
    auth.uid()
  ) RETURNING * INTO v_deal;

  -- ── Event link ────────────────────────────────────────────────────
  IF v_deal.hereday_link IS NOT NULL THEN
    v_event := crm_internal.resolve_event(v_deal.hereday_link);
    IF v_event IS NULL THEN
      v_link := 'not_found';
      v_warn := v_warn || to_jsonb('hereday_link matches no Hereday event.'::text);
    ELSE
      v_link := crm_internal.link_event(v_deal.id, v_event, 'import');
      IF v_link LIKE 'conflict:%' THEN
        v_warn := v_warn || to_jsonb(('Map is already linked to ' || substr(v_link, 10) || '.')::text);
      END IF;
    END IF;
  END IF;

  -- ── Timeline. Each row carries a dedupe key, so nothing doubles. ──
  INSERT INTO public.crm_activities (deal_id, contact_id, type, occurred_at, body, meta, actor_id)
  VALUES (v_deal.id, v_contact, 'import', now(), 'Imported from ' || p_source || '.',
          jsonb_build_object('dedupe_key', 'import:' || p_source, 'raw', coalesce(r->'raw', '{}'::jsonb)),
          auth.uid());
  IF v_sent IS NOT NULL THEN
    INSERT INTO public.crm_activities (deal_id, contact_id, type, occurred_at, body, meta, actor_id)
    VALUES (v_deal.id, v_contact,
            CASE v_channel WHEN 'phone' THEN 'call' WHEN 'form' THEN 'form_submitted' ELSE 'email_sent' END,
            (v_sent + v_noon) AT TIME ZONE 'America/Chicago', 'From ' || p_source || ' sent date.',
            jsonb_build_object('dedupe_key', 'import:sent', 'synthetic', true), auth.uid());
  END IF;
  IF v_followed IS NOT NULL THEN
    INSERT INTO public.crm_activities (deal_id, contact_id, type, occurred_at, body, meta, actor_id)
    VALUES (v_deal.id, v_contact, 'followup_sent',
            (v_followed + v_noon) AT TIME ZONE 'America/Chicago', 'From ' || p_source || ' follow-up date.',
            jsonb_build_object('dedupe_key', 'import:followup', 'synthetic', true), auth.uid());
  END IF;
  IF v_deal.objection IS NOT NULL THEN
    INSERT INTO public.crm_activities (deal_id, contact_id, type, occurred_at, quote, meta, actor_id)
    VALUES (v_deal.id, v_contact, 'objection', coalesce((v_sent + v_noon) AT TIME ZONE 'America/Chicago', now()),
            v_deal.objection, jsonb_build_object('dedupe_key', 'import:objection'), auth.uid());
  END IF;

  -- ── The tracker said published/paid: does Hereday agree? ─────────
  SELECT * INTO v_facts FROM crm_internal.deal_facts f WHERE f.deal_id = v_deal.id;
  FOR v_claim IN SELECT jsonb_array_elements_text(coalesce(r->'tracker_claims', '[]'::jsonb)) LOOP
    IF v_claim = 'published' AND NOT (v_facts.customer_published OR v_facts.map_published) THEN
      v_warn := v_warn || to_jsonb('Tracker says published, but no linked map is published.'::text);
    ELSIF v_claim = 'paid' AND v_facts.paid_at IS NULL THEN
      v_warn := v_warn || to_jsonb('Tracker says paid, but no linked map is paid.'::text);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('slug', v_slug, 'action', 'created', 'deal_id', v_deal.id,
                            'stage', v_stage, 'outcome', v_outcome, 'event_link', v_link,
                            'warnings', v_warn);
END;
$$;

UPDATE public.crm_deals d
   SET next_step    = coalesce(d.next_step,
                               CASE WHEN d.stage = 'followed_up' THEN 'No reply? Close as no response'
                                    ELSE 'Follow up once (call if there''s a phone)' END),
       next_step_at = crm_internal.add_business_days(
                        CASE WHEN d.stage = 'followed_up' THEN d.followed_up_at ELSE d.sent_at END, 5)
 WHERE d.next_step_at IS NULL
   AND ((d.stage = 'sent' AND d.sent_at IS NOT NULL AND d.followed_up_at IS NULL)
     OR (d.stage = 'followed_up' AND d.followed_up_at IS NOT NULL));

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA crm_internal FROM PUBLIC, anon, authenticated;
