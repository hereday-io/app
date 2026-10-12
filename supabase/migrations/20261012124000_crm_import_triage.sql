-- CRM signups triage and CSV import (admin only).
-- Requires 20261012123000_crm_write_rpcs.sql.
--
-- Signups: every non-staff account that owns an event is a customer.
-- crm_list_signups shows the ones whose events aren't linked to a deal
-- yet, with suggested matches; crm_triage_event links, creates or
-- dismisses. Nothing is written automatically on signup — no trigger on
-- auth.users or events.
--
-- Import: the browser parses outreach/leads.csv or the reps' sheet and
-- maps each row (src/lib/crm/leadImport.ts); crm_import writes them.
-- A dry run executes exactly the same code, constraints included, and
-- then rolls back, so its report is what applying would do.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Signups
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_list_signups(p_scope TEXT DEFAULT 'untriaged')
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp, auth
AS $$
BEGIN
  PERFORM crm_internal.require_admin();
  IF p_scope NOT IN ('untriaged', 'all', 'staff_maps') THEN
    RAISE EXCEPTION 'Scope must be untriaged, all or staff_maps.' USING ERRCODE = '22023';
  END IF;

  RETURN coalesce((
    WITH ev AS (
      SELECT f.*, l.disposition, l.deal_id, l.reason AS dismiss_reason
        FROM crm_internal.event_facts f
        LEFT JOIN public.crm_event_links l ON l.event_id = f.event_id
       WHERE CASE p_scope
               WHEN 'staff_maps' THEN f.owner_is_staff AND l.event_id IS NULL
               ELSE NOT f.owner_is_staff
             END
    ), owners AS (
      SELECT ev.owner_id, max(ev.created_at) AS last_event_at
        FROM ev
       GROUP BY ev.owner_id
      HAVING p_scope <> 'untriaged' OR bool_or(ev.disposition IS NULL)
    )
    SELECT jsonb_agg(jsonb_build_object(
             'user_id',           o.owner_id,
             'email',             u.email,
             'display_name',      p.display_name,
             'organization_name', p.organization_name,
             'signed_up_at',      u.created_at,
             'utm_source',        p.utm_source,
             'first_referrer',    p.first_referrer,
             'events', (
               SELECT jsonb_agg(jsonb_build_object(
                        'event_id', e2.event_id, 'name', e2.name, 'slug', e2.slug,
                        'status', e2.status, 'event_date', e2.event_date, 'city', e2.city,
                        'created_at', e2.created_at, 'is_paid', e2.is_paid,
                        'is_comped', e2.is_comped, 'disposition', e2.disposition,
                        'dismiss_reason', e2.dismiss_reason,
                        'deal_slug', d2.slug, 'deal_race_name', d2.race_name
                      ) ORDER BY e2.created_at DESC)
                 FROM ev e2
                 LEFT JOIN public.crm_deals d2 ON d2.id = e2.deal_id
                WHERE e2.owner_id = o.owner_id
             ),
             'suggestions', coalesce((
               SELECT jsonb_agg(s.j) FROM (
                 SELECT DISTINCT ON (d.id)
                        jsonb_build_object('deal_id', d.id, 'slug', d.slug,
                                           'race_name', d.race_name, 'reason', m.reason) AS j
                   FROM (
                     -- The contact on the deal uses this account or its email.
                     SELECT dd.id AS deal_id, 'contact' AS reason, 1 AS rank
                       FROM public.crm_deals dd
                       JOIN public.crm_contacts c ON c.id = dd.primary_contact_id
                      WHERE c.user_id = o.owner_id OR lower(c.email) = lower(u.email)
                     UNION ALL
                     -- A map from this deal was transferred to them.
                     SELECT l.deal_id, 'transfer', 2
                       FROM public.event_transfers t
                       JOIN public.crm_event_links l
                         ON l.event_id = t.event_id AND l.disposition = 'linked'
                      WHERE t.to_user_id = o.owner_id
                     UNION ALL
                     -- Their event's name starts like the race's name.
                     SELECT dd.id, 'name', 3
                       FROM public.crm_deals dd
                       JOIN ev e3 ON e3.owner_id = o.owner_id AND e3.disposition IS NULL
                      WHERE length(crm_internal.race_key(dd.race_name)) >= 6
                        AND (crm_internal.race_key(e3.name) LIKE crm_internal.race_key(dd.race_name) || '%'
                             OR crm_internal.race_key(dd.race_name) LIKE crm_internal.race_key(e3.name) || '%')
                   ) m
                   JOIN public.crm_deals d ON d.id = m.deal_id
                  ORDER BY d.id, m.rank
                  LIMIT 5
               ) s
             ), '[]'::jsonb)
           ) ORDER BY o.last_event_at DESC)
      FROM owners o
      JOIN auth.users u ON u.id = o.owner_id
      LEFT JOIN public.profiles p ON p.user_id = o.owner_id
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION crm_internal.unique_slug(p_base TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE
  v_base TEXT := crm_internal.slugify(p_base);
  v_slug TEXT := v_base;
  v_n    INT  := 1;
BEGIN
  WHILE EXISTS (SELECT 1 FROM public.crm_deals d WHERE d.slug = v_slug) LOOP
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  END LOOP;
  RETURN v_slug;
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_triage_event(
  p_event_id UUID,
  p_action   TEXT,
  p_deal_id  UUID DEFAULT NULL,
  p_reason   TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp, auth
AS $$
DECLARE
  v_event   crm_internal.event_facts%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_link    public.crm_event_links%ROWTYPE;
  v_reason  TEXT := NULLIF(btrim(coalesce(p_reason, '')), '');
  v_result  TEXT;
  v_deal_id UUID := p_deal_id;
  v_contact UUID;
  v_account UUID;
BEGIN
  PERFORM crm_internal.require_admin();
  IF p_action NOT IN ('create', 'link', 'dismiss') THEN
    RAISE EXCEPTION 'Action must be create, link or dismiss.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_event FROM crm_internal.event_facts f WHERE f.event_id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_link FROM public.crm_event_links l WHERE l.event_id = p_event_id FOR UPDATE;
  IF FOUND AND v_link.disposition = 'linked' THEN
    RAISE EXCEPTION 'That event is already linked. Unlink it first.' USING ERRCODE = 'CR001';
  END IF;

  IF p_action = 'dismiss' THEN
    IF v_reason IS NULL OR length(v_reason) > 500 THEN
      RAISE EXCEPTION 'Say why (test event, duplicate, spam…), in under 500 characters.' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.crm_event_links (event_id, disposition, link_source, reason, linked_by)
    VALUES (p_event_id, 'dismissed', 'triage', v_reason, auth.uid())
    ON CONFLICT (event_id) DO UPDATE
      SET reason = EXCLUDED.reason, linked_by = EXCLUDED.linked_by, linked_at = now();
    RETURN jsonb_build_object('event_id', p_event_id, 'disposition', 'dismissed');
  END IF;

  IF p_action = 'create' THEN
    SELECT * INTO v_profile FROM public.profiles p WHERE p.user_id = v_event.owner_id;
    v_account := crm_internal.upsert_account(v_profile.organization_name, NULL);

    SELECT c.id INTO v_contact FROM public.crm_contacts c
     WHERE c.user_id = v_event.owner_id OR lower(c.email) = lower(v_event.owner_email)
     ORDER BY (c.user_id = v_event.owner_id) DESC NULLS LAST
     LIMIT 1;
    IF v_contact IS NULL THEN
      INSERT INTO public.crm_contacts (account_id, full_name, email, email_source, user_id, created_by)
      VALUES (v_account, NULLIF(btrim(v_profile.display_name), ''), v_event.owner_email,
              'hereday_signup', v_event.owner_id, auth.uid())
      RETURNING id INTO v_contact;
    END IF;

    INSERT INTO public.crm_deals (slug, race_name, race_date, town, priority, source, stage,
                                  owner_id, claimed_at, account_id, primary_contact_id, created_by)
    VALUES (crm_internal.unique_slug(v_event.name || coalesce('-' || extract(year FROM v_event.event_date)::int, '')),
            v_event.name, v_event.event_date, NULLIF(btrim(v_event.city), ''),
            (SELECT coalesce(max(priority), 0) + 1 FROM public.crm_deals),
            'inbound', 'new', auth.uid(), now(), v_account, v_contact, auth.uid())
    RETURNING id INTO v_deal_id;
    PERFORM crm_internal.log_activity(v_deal_id, 'note', 'Created from a Hereday signup.', NULL,
      jsonb_build_object('event_id', p_event_id));
  ELSIF v_deal_id IS NULL THEN
    RAISE EXCEPTION 'Pick the deal to link it to.' USING ERRCODE = '22023';
  END IF;

  v_result := crm_internal.link_event(v_deal_id, p_event_id, 'triage', true);
  IF v_result LIKE 'conflict:%' THEN
    RAISE EXCEPTION 'That map is already linked to %.', substr(v_result, 10) USING ERRCODE = 'CR001';
  END IF;

  -- Tie the deal's contact to this account when it isn't tied to one,
  -- so "signed up" shows even if they used a different email.
  IF p_action = 'link' AND NOT v_event.owner_is_staff THEN
    UPDATE public.crm_contacts c
       SET user_id = v_event.owner_id
      FROM public.crm_deals d
     WHERE d.id = v_deal_id AND c.id = d.primary_contact_id AND c.user_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.crm_contacts o WHERE o.user_id = v_event.owner_id);
  END IF;

  RETURN jsonb_build_object('event_id', p_event_id, 'disposition', 'linked',
                            'deal', crm_internal.deal_json(v_deal_id));
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Import
--
-- Row shape (built by src/lib/crm/leadImport.ts):
--   slug, race_name, race_date, date_verified, town, tier, priority,
--   account { name, org_type, org_description },
--   contact { full_name, email, email_source, phone, phone_source, do_not_contact },
--   stage, outcome, owner_id, claimed_at, channel, sent_at, followed_up_at,
--   next_step, next_step_at, objection, fit_flags[], course_map_url,
--   map_type, hereday_link, gmail_draft_id, notes,
--   tracker_claims[] ('published' | 'paid'), raw { original row }
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION crm_internal.valid_source(p_source TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT p_source ~* '^https?://\S+$'
      OR p_source IN ('hereday_signup', 'inbound_email', 'inbound_call');
$$;

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
    CASE WHEN v_stage = 'closed' THEN NULL ELSE NULLIF(btrim(coalesce(r->>'next_step', '')), '') END,
    CASE WHEN v_stage = 'closed' THEN NULL ELSE NULLIF(r->>'next_step_at', '')::date END,
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

CREATE OR REPLACE FUNCTION public.crm_import(
  p_rows    JSONB,
  p_source  TEXT,
  p_mode    TEXT    DEFAULT 'insert_only',
  p_dry_run BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp, auth
AS $$
DECLARE
  v_report JSONB := '[]'::jsonb;
  v_row    JSONB;
  v_result JSONB;
  v_errors INT := 0;
BEGIN
  PERFORM crm_internal.require_admin();
  IF p_source NOT IN ('leads_csv', 'sales_sheet') THEN
    RAISE EXCEPTION 'Source must be leads_csv or sales_sheet.' USING ERRCODE = '22023';
  END IF;
  IF p_mode NOT IN ('insert_only', 'fill_blanks') THEN
    RAISE EXCEPTION 'Mode must be insert_only or fill_blanks.' USING ERRCODE = '22023';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) > 2000 THEN
    RAISE EXCEPTION 'Rows must be an array of at most 2000.' USING ERRCODE = '22023';
  END IF;

  BEGIN
    FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
      BEGIN
        v_result := crm_internal.import_row(v_row, p_source, p_mode);
      EXCEPTION WHEN OTHERS THEN
        v_errors := v_errors + 1;
        v_result := jsonb_build_object('slug', v_row->>'slug', 'action', 'error',
                                       'error', SQLERRM, 'warnings', '[]'::jsonb);
      END;
      v_report := v_report || jsonb_build_array(v_result);
    END LOOP;

    -- Undo everything above while keeping the report (PL/pgSQL keeps
    -- variable values when a block's changes are rolled back).
    IF p_dry_run THEN
      RAISE EXCEPTION 'dry run' USING ERRCODE = 'CRDRY';
    END IF;
    IF v_errors > 0 THEN
      RAISE EXCEPTION 'errors' USING ERRCODE = 'CRERR';
    END IF;
  EXCEPTION
    WHEN SQLSTATE 'CRDRY' THEN
      NULL;
    WHEN SQLSTATE 'CRERR' THEN
      RAISE EXCEPTION '% row(s) failed, so nothing was imported. Run a dry run to see why.', v_errors
        USING ERRCODE = '22023';
  END;

  RETURN jsonb_build_object(
    'dry_run', p_dry_run,
    'source',  p_source,
    'mode',    p_mode,
    'counts',  (SELECT coalesce(jsonb_object_agg(a.action, a.n), '{}'::jsonb)
                  FROM (SELECT x->>'action' AS action, count(*) AS n
                          FROM jsonb_array_elements(v_report) x GROUP BY 1) a),
    'rows',    v_report
  );
END;
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA crm_internal FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.crm_list_signups(TEXT)                       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crm_triage_event(UUID, TEXT, UUID, TEXT)     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crm_import(JSONB, TEXT, TEXT, BOOLEAN)       FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_list_signups(TEXT)                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_triage_event(UUID, TEXT, UUID, TEXT)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_import(JSONB, TEXT, TEXT, BOOLEAN)    TO authenticated;
