-- CRM read RPCs, plus the internal helpers the write RPCs share.
-- Requires 20261012121000_crm_schema.sql.
--
-- Every RPC is SECURITY DEFINER with the repo's search_path, gates on
-- is_staff() / is_admin() in its first statement, and is revoked from
-- PUBLIC and anon. Reads return jsonb so PostgREST hands the client one
-- document, and no RETURNS TABLE column can collide with a table column.
--
-- Visibility (decided 2026-10-12): every staff member sees that a deal
-- exists, its owner, stage, claim state, do-not-contact flag and the app
-- milestones. Contact details, notes, the timeline, objections and draft
-- ids are visible only to the deal's owner and to admins. That stops two
-- people contacting the same race while keeping each owner's
-- relationships private. Claiming a deal is what unlocks its details.
--
-- Error codes used across the CRM RPCs:
--   42501 not authorized       P0002 not found       22023 bad input
--   CR001 held by someone else (claim, email, event link)
--   CR002 do not contact       CR003 stale write     CR004 duplicate deal

-- ─────────────────────────────────────────────────────────────────────
-- 1. Shared helpers (internal schema; callable only from definer RPCs).
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION crm_internal.require_staff()
RETURNS VOID
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_catalog, pg_temp
AS $$
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION crm_internal.require_admin()
RETURNS VOID
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_catalog, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- Pipeline order, used so automatic stage changes only move forward.
CREATE OR REPLACE FUNCTION crm_internal.stage_rank(p_stage TEXT)
RETURNS INT
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE p_stage
           WHEN 'new'         THEN 0
           WHEN 'no_contact'  THEN 0
           WHEN 'researched'  THEN 1
           WHEN 'drafted'     THEN 2
           WHEN 'sent'        THEN 3
           WHEN 'followed_up' THEN 4
           WHEN 'replied'     THEN 5
           WHEN 'closed'      THEN 6
         END;
$$;

CREATE OR REPLACE FUNCTION crm_internal.user_label(p_user_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog, pg_temp, auth
AS $$
  SELECT coalesce(NULLIF(btrim(p.display_name), ''), split_part(u.email, '@', 1))
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.user_id = u.id
   WHERE u.id = p_user_id;
$$;

-- Owner or admin.
CREATE OR REPLACE FUNCTION crm_internal.can_view(p_owner_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog, pg_temp
AS $$
  SELECT public.is_admin() OR (p_owner_id IS NOT NULL AND p_owner_id = auth.uid());
$$;

-- Locks the deal row for the rest of the transaction and checks the
-- caller may change it. Every write RPC goes through here.
CREATE OR REPLACE FUNCTION crm_internal.lock_deal_for_edit(p_deal_id UUID)
RETURNS public.crm_deals
LANGUAGE plpgsql
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE
  v_deal public.crm_deals%ROWTYPE;
BEGIN
  SELECT * INTO v_deal FROM public.crm_deals d WHERE d.id = p_deal_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Deal not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT crm_internal.can_view(v_deal.owner_id) THEN
    RAISE EXCEPTION 'Claim this deal before changing it.' USING ERRCODE = '42501';
  END IF;
  RETURN v_deal;
END;
$$;

CREATE OR REPLACE FUNCTION crm_internal.deal_is_dnc(p_deal_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog, pg_temp
AS $$
  SELECT COALESCE(a.do_not_contact, false) OR COALESCE(c.do_not_contact, false)
    FROM public.crm_deals d
    LEFT JOIN public.crm_accounts a ON a.id = d.account_id
    LEFT JOIN public.crm_contacts c ON c.id = d.primary_contact_id
   WHERE d.id = p_deal_id;
$$;

CREATE OR REPLACE FUNCTION crm_internal.log_activity(
  p_deal_id     UUID,
  p_type        TEXT,
  p_body        TEXT        DEFAULT NULL,
  p_quote       TEXT        DEFAULT NULL,
  p_meta        JSONB       DEFAULT '{}'::jsonb,
  p_occurred_at TIMESTAMPTZ DEFAULT now()
)
RETURNS UUID
LANGUAGE plpgsql
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.crm_activities (deal_id, contact_id, type, occurred_at, body, quote, meta, actor_id)
  SELECT p_deal_id, d.primary_contact_id, p_type, coalesce(p_occurred_at, now()),
         NULLIF(btrim(p_body), ''), NULLIF(btrim(p_quote), ''),
         coalesce(p_meta, '{}'::jsonb), auth.uid()
    FROM public.crm_deals d
   WHERE d.id = p_deal_id
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- The one place a deal is serialized, so the list, the detail view and
-- the CLI mask exactly the same fields.
CREATE OR REPLACE FUNCTION crm_internal.deal_json(p_deal_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog, pg_temp, auth
AS $$
  SELECT jsonb_build_object(
           'id',                 d.id,
           'slug',               d.slug,
           'race_name',          d.race_name,
           'race_date',          d.race_date,
           'date_verified',      d.date_verified,
           'town',               d.town,
           'tier',               d.tier,
           'priority',           d.priority,
           'source',             d.source,
           'stage',              d.stage,
           'effective_stage',    f.effective_stage,
           'stage_changed_at',   d.stage_changed_at,
           'outcome',            d.outcome,
           'closed_at',          d.closed_at,
           'owner_id',           d.owner_id,
           'owner_name',         crm_internal.user_label(d.owner_id),
           'claimed_at',         d.claimed_at,
           'claim_open',         f.claim_open,
           'claim_expires_at',   f.claim_expires_at,
           'is_mine',            d.owner_id IS NOT NULL AND d.owner_id = auth.uid(),
           'can_view_details',   v.can_view,
           'channel',            d.channel,
           'sent_at',            d.sent_at,
           'followed_up_at',     d.followed_up_at,
           'next_step_at',       d.next_step_at,
           'is_due',             f.is_due,
           'is_dnc',             f.is_dnc,
           'fit_flags',          to_jsonb(d.fit_flags),
           'map_type',           d.map_type,
           'course_map_url',     d.course_map_url,
           'hereday_link',       d.hereday_link,
           'account_id',         d.account_id,
           'account_name',       a.name,
           'org_type',           a.org_type,
           'has_email',          c.email IS NOT NULL,
           'has_phone',          c.phone IS NOT NULL,
           'previous_deal_id',   d.previous_deal_id,
           'created_at',         d.created_at,
           'updated_at',         d.updated_at
         )
         || jsonb_build_object(
           'map_built',           f.map_built,
           'map_published',       f.map_published,
           'customer_owns_event', f.customer_owns_event,
           'customer_published',  f.customer_published,
           'signed_up_at',        f.signed_up_at,
           'paid_at',             f.paid_at,
           'comped',              f.comped,
           'refunded',            f.refunded,
           'handed_off_at',       f.handed_off_at,
           'last_activity_at',    act.last_activity_at,
           'handoff_requested_at', act.handoff_requested_at,
           'handoff_pending',     act.handoff_requested_at IS NOT NULL
                                  AND act.handoff_requested_at > coalesce(f.handed_off_at, '-infinity'::timestamptz)
         )
         -- Owner/admin only.
         || CASE WHEN v.can_view THEN jsonb_build_object(
           'contact_id',          c.id,
           'contact_name',        c.full_name,
           'contact_email',       c.email,
           'contact_phone',       c.phone,
           'next_step',           d.next_step,
           'objection',           d.objection,
           'notes',               d.notes,
           'gmail_draft_id',      d.gmail_draft_id,
           'gmail_draft_mailbox', d.gmail_draft_mailbox,
           'gmail_thread_id',     d.gmail_thread_id
         ) ELSE '{}'::jsonb END
    FROM public.crm_deals d
    JOIN crm_internal.deal_facts f ON f.deal_id = d.id
    LEFT JOIN public.crm_accounts a ON a.id = d.account_id
    LEFT JOIN public.crm_contacts c ON c.id = d.primary_contact_id
    CROSS JOIN LATERAL (SELECT crm_internal.can_view(d.owner_id) AS can_view) v
    LEFT JOIN LATERAL (
      SELECT max(x.occurred_at)                                              AS last_activity_at,
             max(x.occurred_at) FILTER (WHERE x.type = 'handoff_requested') AS handoff_requested_at
        FROM public.crm_activities x
       WHERE x.deal_id = d.id AND x.voided_at IS NULL
    ) act ON true
   WHERE d.id = p_deal_id;
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA crm_internal FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 2. staff_list — owners for filters, assignment and the sheet import.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_list_staff()
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
             'user_id',      p.user_id,
             'email',        u.email,
             'display_name', crm_internal.user_label(p.user_id),
             'role',         CASE WHEN p.is_admin THEN 'admin' ELSE 'sales' END
           ) ORDER BY p.is_admin DESC, crm_internal.user_label(p.user_id))
      FROM public.profiles p
      JOIN auth.users u ON u.id = p.user_id
     WHERE p.is_admin OR p.is_sales
  ), '[]'::jsonb);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 3. crm_list_deals — the pipeline. Closed deals are left out unless
--    asked for, except customers (signed up or later), which always show.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_list_deals(p_include_closed BOOLEAN DEFAULT false)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp, auth
AS $$
BEGIN
  PERFORM crm_internal.require_staff();
  RETURN coalesce((
    SELECT jsonb_agg(crm_internal.deal_json(d.id)
                     ORDER BY d.priority NULLS LAST, d.race_date NULLS LAST, d.created_at)
      FROM public.crm_deals d
      JOIN crm_internal.deal_facts f ON f.deal_id = d.id
     WHERE coalesce(p_include_closed, false)
        OR d.stage <> 'closed'
        OR f.effective_stage IN ('signed_up', 'published', 'paid')
  ), '[]'::jsonb);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 4. crm_get_deal — one deal with its account, contact, linked events,
--    timeline and the actions the caller may take.
--
--    The timeline merges stored activities with facts read live from
--    the app (event created/published, transfers, purchases, refunds,
--    the contact's signup), tagged source = 'app'.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_get_deal(p_slug TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp, auth
AS $$
DECLARE
  v_deal     public.crm_deals%ROWTYPE;
  v_facts    crm_internal.deal_facts%ROWTYPE;
  v_view     BOOLEAN;
  v_admin    BOOLEAN := public.is_admin();
  v_account  JSONB;
  v_contact  JSONB;
  v_events   JSONB;
  v_timeline JSONB := '[]'::jsonb;
BEGIN
  PERFORM crm_internal.require_staff();

  SELECT * INTO v_deal FROM public.crm_deals d WHERE d.slug = btrim(coalesce(p_slug, ''));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Deal not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_facts FROM crm_internal.deal_facts f WHERE f.deal_id = v_deal.id;
  v_view := crm_internal.can_view(v_deal.owner_id);

  SELECT jsonb_build_object(
           'id', a.id, 'name', a.name, 'org_type', a.org_type,
           'org_description', a.org_description, 'town', a.town, 'website', a.website,
           'do_not_contact', a.do_not_contact, 'dnc_at', a.dnc_at
         ) || CASE WHEN v_view THEN jsonb_build_object('notes', a.notes, 'dnc_reason', a.dnc_reason)
                   ELSE '{}'::jsonb END
    INTO v_account
    FROM public.crm_accounts a WHERE a.id = v_deal.account_id;

  SELECT jsonb_build_object(
           'id', c.id, 'has_email', c.email IS NOT NULL, 'has_phone', c.phone IS NOT NULL,
           'do_not_contact', c.do_not_contact, 'dnc_at', c.dnc_at,
           'signed_up_at', v_facts.signed_up_at,
           'other_deal_count', (SELECT count(*) FROM public.crm_deals o
                                 WHERE o.primary_contact_id = c.id AND o.id <> v_deal.id)
         ) || CASE WHEN v_view THEN jsonb_build_object(
           'full_name', c.full_name, 'role_title', c.role_title,
           'email', c.email, 'email_source', c.email_source,
           'phone', c.phone, 'phone_source', c.phone_source,
           'notes', c.notes, 'dnc_reason', c.dnc_reason,
           'user_id', coalesce(c.user_id, v_facts.signup_user_id)
         ) ELSE '{}'::jsonb END
    INTO v_contact
    FROM public.crm_contacts c WHERE c.id = v_deal.primary_contact_id;

  -- Linked events. Non-owners see that a map exists and its state, not
  -- whose account it is in.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'event_id', f.event_id, 'name', f.name, 'slug', f.slug, 'status', f.status,
           'event_date', f.event_date, 'created_at', f.created_at,
           'owner_is_staff', f.owner_is_staff,
           'owner_email', CASE WHEN v_view THEN f.owner_email END,
           'is_paid', f.is_paid, 'is_comped', f.is_comped, 'is_refunded', f.is_refunded,
           'paid_at', f.paid_at, 'first_published_at', f.first_published_at,
           'last_transferred_at', f.last_transferred_at,
           'link_source', l.link_source, 'linked_at', l.linked_at
         ) ORDER BY f.created_at), '[]'::jsonb)
    INTO v_events
    FROM public.crm_event_links l
    JOIN crm_internal.event_facts f ON f.event_id = l.event_id
   WHERE l.deal_id = v_deal.id AND l.disposition = 'linked';

  IF v_view THEN
    WITH linked AS (
      SELECT l.event_id FROM public.crm_event_links l
       WHERE l.deal_id = v_deal.id AND l.disposition = 'linked'
    ), items AS (
      SELECT x.id::text AS id, 'crm' AS source, x.type, x.occurred_at, x.body, x.quote, x.meta,
             crm_internal.user_label(x.actor_id) AS actor_name, x.voided_at, x.void_reason
        FROM public.crm_activities x
       WHERE x.deal_id = v_deal.id
      UNION ALL
      SELECT 'ev-created-' || f.event_id, 'app', 'app_event_created', f.created_at,
             f.name, NULL, jsonb_build_object('event_id', f.event_id, 'slug', f.slug,
                                               'owner_is_staff', f.owner_is_staff),
             NULL, NULL, NULL
        FROM crm_internal.event_facts f JOIN linked USING (event_id)
      UNION ALL
      SELECT 'ev-published-' || f.event_id, 'app', 'app_event_published', f.first_published_at,
             f.name, NULL, jsonb_build_object('event_id', f.event_id, 'slug', f.slug,
                                               'owner_is_staff', f.owner_is_staff),
             NULL, NULL, NULL
        FROM crm_internal.event_facts f JOIN linked USING (event_id)
       WHERE f.first_published_at IS NOT NULL
      UNION ALL
      SELECT 'transfer-' || t.id, 'app', 'app_transferred', t.transferred_at,
             coalesce(t.from_email, 'unknown') || ' → ' || t.to_email, NULL,
             jsonb_build_object('event_id', t.event_id, 'pro_source', t.pro_source, 'note', t.note),
             crm_internal.user_label(t.transferred_by), NULL, NULL
        FROM public.event_transfers t JOIN linked USING (event_id)
      UNION ALL
      SELECT 'pe-' || pe.id, 'app',
             CASE pe.event_type WHEN 'purchase_completed' THEN 'app_purchase' ELSE 'app_refund' END,
             pe.created_at, NULL, NULL,
             jsonb_build_object('event_id', pe.event_id,
                                'amount_total', pe.properties->'amount_total',
                                'currency', pe.properties->'currency',
                                'promo_code', pe.properties->'promo_code'),
             NULL, NULL, NULL
        FROM public.product_events pe JOIN linked USING (event_id)
       WHERE pe.event_type IN ('purchase_completed', 'purchase_refunded')
      UNION ALL
      SELECT 'signup-' || v_deal.id, 'app', 'app_signed_up', v_facts.signed_up_at,
             NULL, NULL, '{}'::jsonb, NULL, NULL, NULL
       WHERE v_facts.signed_up_at IS NOT NULL
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'id', i.id, 'source', i.source, 'type', i.type, 'occurred_at', i.occurred_at,
             'body', i.body, 'quote', i.quote, 'meta', i.meta, 'actor_name', i.actor_name,
             'voided_at', i.voided_at, 'void_reason', i.void_reason
           ) ORDER BY i.occurred_at DESC, i.id), '[]'::jsonb)
      INTO v_timeline
      FROM items i;
  END IF;

  RETURN jsonb_build_object(
    'deal',     crm_internal.deal_json(v_deal.id),
    'account',  v_account,
    'contact',  v_contact,
    'events',   v_events,
    'timeline', v_timeline,
    'allowed',  jsonb_build_object(
      'view_details', v_view,
      'edit',         v_view,
      'claim',        v_facts.claim_open AND NOT v_facts.is_dnc
                      AND (v_deal.owner_id IS NULL OR v_deal.owner_id <> auth.uid()),
      'release',      v_view AND v_deal.owner_id IS NOT NULL,
      'assign',       v_admin,
      'mark_dnc',     v_view,
      'link_event',   v_view,
      'unlink_event', v_admin,
      'void',         v_admin
    )
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 5. Grants.
-- ─────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.crm_list_staff()          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crm_list_deals(BOOLEAN)   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crm_get_deal(TEXT)        FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_list_staff()        TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_list_deals(BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_get_deal(TEXT)      TO authenticated;
