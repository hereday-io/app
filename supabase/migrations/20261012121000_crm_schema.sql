-- CRM schema: accounts, contacts, deals, event links, activity timeline.
--
-- Replaces outreach/leads.csv and the reps' Google Sheet as the single
-- source of truth for customers. Requires 20261012120000_staff_sales_role.sql.
--
-- Access model: RLS on, NO policies, and every privilege revoked from
-- anon and authenticated. All reads and writes go through SECURITY
-- DEFINER RPCs (20261012122000 onwards) because
--   * reads join auth.users, events, comp_grants, event_transfers and
--     product_events, none of which a client role can read;
--   * visibility is per field (reps don't see contact details on deals
--     they don't own), which row-level policies can't express;
--   * claims, do-not-contact and stage side effects must live in one
--     place, shared by the admin UI and the CLI.
--
-- App facts (signed up, map built, published, paid, comped, handed off)
-- are never stored here. They are computed on read from the tables that
-- already record them, in crm_internal.event_facts / deal_facts. No
-- trigger is added to events or product_events: editor autosave and the
-- Stripe webhook write those, and neither may fail because of the CRM.

-- ─────────────────────────────────────────────────────────────────────
-- 0. Internal schema. Not exposed through PostgREST, not usable by any
--    client role. Only the definer RPCs (owned by postgres) touch it.
--    Never put a view that joins auth.users in public: views default to
--    security_invoker = false and pick up default grants.
-- ─────────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS crm_internal;
REVOKE ALL ON SCHEMA crm_internal FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 1. Accounts — the organization (park district, running club, …).
--    Optional on deals: leads.csv has no org-name column, and inventing
--    one would contradict "never invent".
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_accounts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  org_type         TEXT CHECK (org_type IN (
                     'park_district', 'municipal', 'school_booster', 'school_foundation',
                     'school', 'church', 'service_club', 'running_club', 'charity',
                     'chamber', 'business', 'race_mgmt_company', 'other')),
  org_description  TEXT CHECK (org_description IS NULL OR length(org_description) <= 1000),
  town             TEXT CHECK (town IS NULL OR length(town) <= 120),
  website          TEXT CHECK (website IS NULL OR website ~* '^https?://\S+$'),
  do_not_contact   BOOLEAN NOT NULL DEFAULT false,
  dnc_at           TIMESTAMPTZ,
  dnc_by           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  dnc_reason       TEXT CHECK (dnc_reason IS NULL OR length(dnc_reason) <= 500),
  notes            TEXT CHECK (notes IS NULL OR length(notes) <= 20000),
  created_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT crm_accounts_dnc_pair CHECK (do_not_contact = (dnc_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS crm_accounts_name_town_uidx
  ON public.crm_accounts (lower(name), lower(coalesce(town, '')));

-- ─────────────────────────────────────────────────────────────────────
-- 2. Contacts — people. One contact can be on several deals (a
--    race-management company runs three races from one inbox).
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_contacts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       UUID REFERENCES public.crm_accounts(id) ON DELETE SET NULL,
  full_name        TEXT CHECK (full_name IS NULL OR length(full_name) <= 200),
  role_title       TEXT CHECK (role_title IS NULL OR length(role_title) <= 200),
  email            TEXT CHECK (email IS NULL OR email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  email_source     TEXT,
  phone            TEXT CHECK (phone IS NULL OR length(phone) <= 40),
  phone_source     TEXT,
  -- Explicit link to a Hereday account, set by triage. When NULL the
  -- contact is still matched to auth.users by email on read.
  user_id          UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  do_not_contact   BOOLEAN NOT NULL DEFAULT false,
  dnc_at           TIMESTAMPTZ,
  dnc_by           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  dnc_reason       TEXT CHECK (dnc_reason IS NULL OR length(dnc_reason) <= 500),
  notes            TEXT CHECK (notes IS NULL OR length(notes) <= 20000),
  created_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- "No source URL, no contact" (sales kit rule 2), enforced here so the
  -- UI, the CLI and the import can't drift from it.
  CONSTRAINT crm_contacts_email_sourced CHECK (
    email IS NULL
    OR email_source ~* '^https?://\S+$'
    OR email_source IN ('hereday_signup', 'inbound_email', 'inbound_call')
  ),
  CONSTRAINT crm_contacts_phone_sourced CHECK (
    phone IS NULL
    OR phone_source ~* '^https?://\S+$'
    OR phone_source IN ('hereday_signup', 'inbound_email', 'inbound_call')
  ),
  CONSTRAINT crm_contacts_dnc_pair CHECK (do_not_contact = (dnc_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS crm_contacts_email_uidx
  ON public.crm_contacts (lower(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_contacts_phone_digits_idx
  ON public.crm_contacts (regexp_replace(phone, '\D', '', 'g')) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_contacts_account_idx
  ON public.crm_contacts (account_id);

-- ─────────────────────────────────────────────────────────────────────
-- 3. Deals — one per race edition. Pro is bought per event and races
--    recur yearly, so next year's edition is a new deal (previous_deal_id).
--
--    stage is what a person last set. App progress (signed up,
--    published, paid) is derived, never stored; see deal_facts.
--    "Claimed" is not a stage: it is owner_id + claimed_at while the
--    stage is still 'new'.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_deals (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Immutable (trigger below): outreach/research/{slug}.md and
  -- outreach/drafts/{slug}.md are keyed by it, and it is in URLs.
  slug                TEXT NOT NULL UNIQUE
                        CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 80),
  account_id          UUID REFERENCES public.crm_accounts(id) ON DELETE SET NULL,
  primary_contact_id  UUID REFERENCES public.crm_contacts(id) ON DELETE SET NULL,
  race_name           TEXT NOT NULL CHECK (length(btrim(race_name)) BETWEEN 1 AND 200),
  race_date           DATE,
  date_verified       BOOLEAN NOT NULL DEFAULT false,
  town                TEXT CHECK (town IS NULL OR length(town) <= 120),
  tier                SMALLINT CHECK (tier BETWEEN 1 AND 3),
  -- Work order for "next batch". The import keeps file order.
  priority            INTEGER,
  source              TEXT NOT NULL
                        CHECK (source IN ('leads_csv', 'sales_sheet', 'manual', 'inbound', 'renewal')),
  stage               TEXT NOT NULL DEFAULT 'new' CHECK (stage IN (
                        'new', 'researched', 'drafted', 'sent', 'followed_up',
                        'replied', 'closed', 'no_contact')),
  stage_changed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  outcome             TEXT CHECK (outcome IN (
                        'no_response', 'not_interested', 'has_map', 'timing', 'not_a_fit',
                        'bad_contact', 'removed', 'adopted', 'do_not_contact', 'other')),
  closed_at           TIMESTAMPTZ,
  owner_id            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Meaningful only while owner_id is set. No pair CHECK: ON DELETE SET
  -- NULL on owner_id would then make deleting a rep's account fail.
  claimed_at          TIMESTAMPTZ,
  channel             TEXT CHECK (channel IN ('email', 'phone', 'form')),
  sent_at             DATE,
  followed_up_at      DATE,
  next_step           TEXT CHECK (next_step IS NULL OR length(next_step) <= 200),
  next_step_at        DATE,
  -- Latest verbatim objection; the full history is in crm_activities.
  objection           TEXT CHECK (objection IS NULL OR length(objection) <= 5000),
  fit_flags           TEXT[] NOT NULL DEFAULT '{}'
                        CHECK (fit_flags <@ ARRAY['large_field', 'race_mgmt_company',
                          'has_published_map', 'outside_radius', 'no_named_contact', 'other']::TEXT[]),
  course_map_url      TEXT CHECK (course_map_url IS NULL OR length(course_map_url) <= 2000),
  map_type            TEXT CHECK (map_type IN (
                        'image', 'pdf', 'gpx', 'strava', 'mapmyrun', 'rungo', 'google_my_maps',
                        'embedded', 'description', 'none', 'unknown')),
  hereday_link        TEXT CHECK (hereday_link IS NULL OR length(hereday_link) <= 500),
  gmail_draft_id      TEXT CHECK (gmail_draft_id IS NULL OR length(gmail_draft_id) <= 100),
  gmail_draft_mailbox TEXT CHECK (gmail_draft_mailbox IS NULL OR length(gmail_draft_mailbox) <= 320),
  gmail_thread_id     TEXT CHECK (gmail_thread_id IS NULL OR length(gmail_thread_id) <= 100),
  previous_deal_id    UUID REFERENCES public.crm_deals(id) ON DELETE SET NULL,
  notes               TEXT CHECK (notes IS NULL OR length(notes) <= 20000),
  created_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT crm_deals_closed_needs_outcome CHECK (stage <> 'closed' OR outcome IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS crm_deals_owner_open_idx
  ON public.crm_deals (owner_id) WHERE stage <> 'closed';
CREATE INDEX IF NOT EXISTS crm_deals_next_step_idx
  ON public.crm_deals (next_step_at) WHERE stage <> 'closed';
CREATE INDEX IF NOT EXISTS crm_deals_account_idx
  ON public.crm_deals (account_id);
CREATE INDEX IF NOT EXISTS crm_deals_contact_idx
  ON public.crm_deals (primary_contact_id);
-- Dedupe helper: the same race entered twice under different slugs.
CREATE INDEX IF NOT EXISTS crm_deals_race_key_idx
  ON public.crm_deals ((regexp_replace(lower(race_name), '[^a-z0-9]', '', 'g')), race_date);

-- ─────────────────────────────────────────────────────────────────────
-- 4. Event links — which Hereday events belong to which deal.
--    A deal can have several (the outreach map in the builder's account,
--    the director's own rebuild, a duplicate draft). An event belongs to
--    at most one deal. 'dismissed' records "not a customer" triage
--    decisions (test events, spam), so the inbound queue is simply
--    "events with no row here". No FK to events, same reasoning as
--    event_transfers.event_id.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_event_links (
  event_id     UUID PRIMARY KEY,
  deal_id      UUID REFERENCES public.crm_deals(id) ON DELETE CASCADE,
  disposition  TEXT NOT NULL CHECK (disposition IN ('linked', 'dismissed')),
  link_source  TEXT NOT NULL CHECK (link_source IN ('hereday_link', 'import', 'triage', 'manual')),
  reason       TEXT CHECK (reason IS NULL OR length(reason) <= 500),
  linked_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  linked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT crm_event_links_shape CHECK ((disposition = 'linked') = (deal_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS crm_event_links_deal_idx
  ON public.crm_event_links (deal_id);

-- ─────────────────────────────────────────────────────────────────────
-- 5. Activities — append-only timeline. Mistakes are voided, not
--    deleted or edited (trigger below).
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_activities (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id      UUID REFERENCES public.crm_deals(id) ON DELETE CASCADE,
  contact_id   UUID REFERENCES public.crm_contacts(id) ON DELETE SET NULL,
  account_id   UUID REFERENCES public.crm_accounts(id) ON DELETE CASCADE,
  type         TEXT NOT NULL CHECK (type IN (
                 'note', 'email_sent', 'followup_sent', 'call', 'voicemail', 'form_submitted',
                 'reply', 'objection', 'stage_change', 'claim', 'release', 'assign', 'dnc',
                 'event_linked', 'event_unlinked', 'research', 'import',
                 'handoff_requested', 'backlink_asked', 'backlink_live')),
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  body         TEXT CHECK (body IS NULL OR length(body) <= 10000),
  -- The customer's exact words. Objections are recorded verbatim.
  quote        TEXT CHECK (quote IS NULL OR length(quote) <= 5000),
  meta         JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  voided_at    TIMESTAMPTZ,
  voided_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  void_reason  TEXT CHECK (void_reason IS NULL OR length(void_reason) <= 500),
  CONSTRAINT crm_activities_target CHECK (
    deal_id IS NOT NULL OR contact_id IS NOT NULL OR account_id IS NOT NULL
  ),
  CONSTRAINT crm_activities_objection_quote CHECK (type <> 'objection' OR quote IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS crm_activities_deal_time_idx
  ON public.crm_activities (deal_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS crm_activities_type_idx
  ON public.crm_activities (type, occurred_at DESC);
-- Makes the import and a future Gmail sync idempotent: a row carrying
-- meta.dedupe_key can only be written once per deal.
CREATE UNIQUE INDEX IF NOT EXISTS crm_activities_dedupe_idx
  ON public.crm_activities (deal_id, (meta->>'dedupe_key'))
  WHERE meta ? 'dedupe_key';

-- ─────────────────────────────────────────────────────────────────────
-- 6. Lock the tables down. Supabase's default privileges grant every
--    new public table to anon and authenticated, so the REVOKE is
--    required, not belt and braces.
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.crm_accounts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_contacts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_deals       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_event_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_activities  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.crm_accounts, public.crm_contacts, public.crm_deals,
                    public.crm_event_links, public.crm_activities
  FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 7. Triggers (CRM tables only).
--
--    Escape hatch for genuine mistakes, from the SQL editor only:
--      BEGIN; SET LOCAL crm.maintenance = 'on'; <fix>; COMMIT;
--    The trigger functions read that setting inline, not through a
--    crm_internal helper, so they keep working for any role that writes
--    these tables (crm_internal has no USAGE grants).
-- ─────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS crm_accounts_updated_at ON public.crm_accounts;
CREATE TRIGGER crm_accounts_updated_at BEFORE UPDATE ON public.crm_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS crm_contacts_updated_at ON public.crm_contacts;
CREATE TRIGGER crm_contacts_updated_at BEFORE UPDATE ON public.crm_contacts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS crm_deals_updated_at ON public.crm_deals;
CREATE TRIGGER crm_deals_updated_at BEFORE UPDATE ON public.crm_deals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION crm_internal.deals_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW.slug IS DISTINCT FROM OLD.slug AND NOT (coalesce(current_setting('crm.maintenance', true), '') = 'on') THEN
    RAISE EXCEPTION 'A deal slug never changes (research and draft files are keyed by it).'
      USING ERRCODE = '22023';
  END IF;
  IF NEW.stage IS DISTINCT FROM OLD.stage THEN
    NEW.stage_changed_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS crm_deals_guard ON public.crm_deals;
CREATE TRIGGER crm_deals_guard BEFORE UPDATE ON public.crm_deals
  FOR EACH ROW EXECUTE FUNCTION crm_internal.deals_guard();

-- Do not contact is permanent (sales kit rule 4).
CREATE OR REPLACE FUNCTION crm_internal.dnc_is_permanent()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog, pg_temp
AS $$
BEGIN
  IF OLD.do_not_contact AND NOT NEW.do_not_contact AND NOT (coalesce(current_setting('crm.maintenance', true), '') = 'on') THEN
    RAISE EXCEPTION 'Do not contact is permanent.' USING ERRCODE = 'CR002';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS crm_accounts_dnc_permanent ON public.crm_accounts;
CREATE TRIGGER crm_accounts_dnc_permanent BEFORE UPDATE ON public.crm_accounts
  FOR EACH ROW EXECUTE FUNCTION crm_internal.dnc_is_permanent();
DROP TRIGGER IF EXISTS crm_contacts_dnc_permanent ON public.crm_contacts;
CREATE TRIGGER crm_contacts_dnc_permanent BEFORE UPDATE ON public.crm_contacts
  FOR EACH ROW EXECUTE FUNCTION crm_internal.dnc_is_permanent();

-- Activities: no deletes; updates may only fill in the void columns.
CREATE OR REPLACE FUNCTION crm_internal.activities_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog, pg_temp
AS $$
BEGIN
  IF coalesce(current_setting('crm.maintenance', true), '') = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'DELETE' THEN
    -- Deleting the parent deal cascades here; allow that, block the rest.
    IF pg_trigger_depth() > 1 THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Activities are append-only. Void it instead.' USING ERRCODE = '42501';
  END IF;

  IF (NEW.id, NEW.deal_id, NEW.contact_id, NEW.account_id, NEW.type, NEW.occurred_at,
      NEW.body, NEW.quote, NEW.meta, NEW.actor_id, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.deal_id, OLD.contact_id, OLD.account_id, OLD.type, OLD.occurred_at,
      OLD.body, OLD.quote, OLD.meta, OLD.actor_id, OLD.created_at)
  THEN
    -- ON DELETE SET NULL from contacts/users also lands here.
    IF pg_trigger_depth() > 1 THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Activities are append-only. Void it instead.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS crm_activities_append_only ON public.crm_activities;
CREATE TRIGGER crm_activities_append_only BEFORE UPDATE OR DELETE ON public.crm_activities
  FOR EACH ROW EXECUTE FUNCTION crm_internal.activities_append_only();

-- ─────────────────────────────────────────────────────────────────────
-- 8. Helpers.
-- ─────────────────────────────────────────────────────────────────────

-- "Today" for follow-up dates. The sales team works in Illinois.
CREATE OR REPLACE FUNCTION crm_internal.today()
RETURNS DATE
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT (now() AT TIME ZONE 'America/Chicago')::date;
$$;

CREATE OR REPLACE FUNCTION crm_internal.add_business_days(p_from DATE, p_days INT)
RETURNS DATE
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_date DATE := p_from;
  v_left INT  := greatest(p_days, 0);
BEGIN
  WHILE v_left > 0 LOOP
    v_date := v_date + 1;
    IF extract(isodow FROM v_date) < 6 THEN
      v_left := v_left - 1;
    END IF;
  END LOOP;
  RETURN v_date;
END;
$$;

-- Pulls the slug (or id) out of whatever was pasted: a public URL
-- (/event/<slug>), an editor URL (?id=<uuid>), a bare slug or id.
-- Mirrors src/lib/crm/eventRef.ts.
CREATE OR REPLACE FUNCTION crm_internal.parse_event_ref(p_ref TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_value TEXT := btrim(coalesce(p_ref, ''));
  v_match TEXT[];
BEGIN
  v_match := regexp_match(v_value, '/event/([^/?#\s]+)', 'i');
  IF v_match IS NOT NULL THEN
    RETURN v_match[1];
  END IF;
  v_match := regexp_match(v_value, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', 'i');
  IF v_match IS NOT NULL THEN
    RETURN lower(v_match[1]);
  END IF;
  RETURN NULLIF(v_value, '');
END;
$$;

CREATE OR REPLACE FUNCTION crm_internal.resolve_event(p_ref TEXT)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE
  v_ref TEXT := crm_internal.parse_event_ref(p_ref);
  v_id  UUID;
BEGIN
  IF v_ref IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT e.id INTO v_id
    FROM public.events e
   WHERE (v_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          AND e.id = v_ref::uuid)
      OR e.slug = v_ref
   LIMIT 1;
  RETURN v_id;
END;
$$;

-- Normalized race key for dedupe: letters and digits only.
CREATE OR REPLACE FUNCTION crm_internal.race_key(p_name TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]', '', 'g');
$$;

CREATE OR REPLACE FUNCTION crm_internal.slugify(p_text TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT coalesce(
    NULLIF(
      left(
        btrim(regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', '-', 'g'), '-'),
        60
      ),
      ''
    ),
    'deal'
  );
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 9. Facts, computed on read.
--
--    Pro state from events (the webhook leaves stripe_payment_id in
--    place on refund and only clears paid_at):
--      paid     = paid_at AND stripe_payment_id
--      comped   = paid_at AND no stripe_payment_id  (comp grants,
--                 comp_detached transfers, the legacy paid_at backfill)
--      refunded = no paid_at AND stripe_payment_id
--
--    Outreach maps live in the builder's (staff) account, so
--    "owner is staff" means "our map" and anything else means "customer".
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW crm_internal.event_facts AS
SELECT e.id                                                    AS event_id,
       e.name,
       e.slug,
       e.status,
       e.event_date,
       e.city,
       e.created_at,
       e.user_id                                               AS owner_id,
       u.email::text                                           AS owner_email,
       u.created_at                                            AS owner_signed_up_at,
       COALESCE(op.is_admin OR op.is_sales, false)             AS owner_is_staff,
       e.paid_at,
       e.stripe_payment_id,
       e.comp_grant_id,
       (e.paid_at IS NOT NULL AND e.stripe_payment_id IS NOT NULL) AS is_paid,
       (e.paid_at IS NOT NULL AND e.stripe_payment_id IS NULL)     AS is_comped,
       (e.paid_at IS NULL     AND e.stripe_payment_id IS NOT NULL) AS is_refunded,
       (SELECT max(t.transferred_at) FROM public.event_transfers t
         WHERE t.event_id = e.id)                              AS last_transferred_at,
       (SELECT min(pe.created_at) FROM public.product_events pe
         WHERE pe.event_type = 'event_published' AND pe.event_id = e.id) AS first_published_at
  FROM public.events e
  LEFT JOIN auth.users u       ON u.id = e.user_id
  LEFT JOIN public.profiles op ON op.user_id = e.user_id;

CREATE OR REPLACE VIEW crm_internal.deal_facts AS
SELECT d.id                                                    AS deal_id,
       COALESCE(ev.event_count, 0)                             AS event_count,
       COALESCE(ev.event_count, 0) > 0                         AS map_built,
       COALESCE(ev.any_published, false)                       AS map_published,
       COALESCE(ev.customer_owns_event, false)                 AS customer_owns_event,
       COALESCE(ev.customer_published, false)                  AS customer_published,
       ev.paid_at,
       COALESCE(ev.comped, false)                              AS comped,
       COALESCE(ev.refunded, false)                            AS refunded,
       ev.handed_off_at,
       COALESCE(su.signed_up_at, ev.customer_signed_up_at)     AS signed_up_at,
       su.user_id                                              AS signup_user_id,
       (COALESCE(a.do_not_contact, false) OR COALESCE(c.do_not_contact, false)) AS is_dnc,
       x.effective_stage,
       (d.owner_id IS NULL
        OR (x.effective_stage = 'new' AND d.claimed_at < now() - interval '7 days')) AS claim_open,
       CASE WHEN d.owner_id IS NOT NULL AND x.effective_stage = 'new'
            THEN d.claimed_at + interval '7 days' END          AS claim_expires_at,
       (d.next_step_at IS NOT NULL
        AND d.next_step_at <= crm_internal.today()
        AND d.stage <> 'closed'
        AND NOT (COALESCE(a.do_not_contact, false) OR COALESCE(c.do_not_contact, false))) AS is_due
  FROM public.crm_deals d
  LEFT JOIN public.crm_accounts a ON a.id = d.account_id
  LEFT JOIN public.crm_contacts c ON c.id = d.primary_contact_id
  LEFT JOIN LATERAL (
    SELECT count(*)                                              AS event_count,
           bool_or(f.status = 'published')                       AS any_published,
           bool_or(NOT f.owner_is_staff)                         AS customer_owns_event,
           bool_or(NOT f.owner_is_staff AND f.status = 'published') AS customer_published,
           max(f.paid_at) FILTER (WHERE f.is_paid)               AS paid_at,
           bool_or(f.is_comped)                                  AS comped,
           bool_or(f.is_refunded)                                AS refunded,
           max(f.last_transferred_at)                            AS handed_off_at,
           min(f.owner_signed_up_at) FILTER (WHERE NOT f.owner_is_staff) AS customer_signed_up_at
      FROM public.crm_event_links l
      JOIN crm_internal.event_facts f ON f.event_id = l.event_id
     WHERE l.deal_id = d.id AND l.disposition = 'linked'
  ) ev ON true
  LEFT JOIN LATERAL (
    SELECT u.id AS user_id, u.created_at AS signed_up_at
      FROM auth.users u
     WHERE (c.user_id IS NOT NULL AND u.id = c.user_id)
        OR (c.user_id IS NULL AND c.email IS NOT NULL AND lower(u.email) = lower(c.email))
     LIMIT 1
  ) su ON true
  CROSS JOIN LATERAL (
    SELECT CASE
             WHEN ev.paid_at IS NOT NULL                               THEN 'paid'
             WHEN COALESCE(ev.customer_published, false)               THEN 'published'
             WHEN COALESCE(su.signed_up_at, ev.customer_signed_up_at) IS NOT NULL THEN 'signed_up'
             ELSE d.stage
           END AS effective_stage
  ) x;

REVOKE ALL ON ALL TABLES    IN SCHEMA crm_internal FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA crm_internal FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- Rollback (safe until the first import):
--   DROP SCHEMA crm_internal CASCADE;
--   DROP TABLE public.crm_activities, public.crm_event_links,
--              public.crm_deals, public.crm_contacts, public.crm_accounts;
-- ─────────────────────────────────────────────────────────────────────
