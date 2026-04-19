-- Pro waitlist — captures interest while `PAYMENTS_LIVE = false` in
-- UpgradeModal. Every upgrade CTA that can't transact (Ops Center lock,
-- paywall hits, publish-time upsell) instead surfaces an email capture
-- that writes into this table. Once Stripe unblocks, this list is the
-- first outbound audience.
--
-- Intentionally denormalized: event_id is nullable because some
-- capture surfaces (landing-page pricing CTA, editor paywall hits
-- without a specific event context) want to record interest without a
-- bound event. trigger is a short free-form tag identifying the
-- capture surface (see CAPTURE_SOURCES in the client helper).
--
-- Dedup is enforced at the row level via a partial unique index on
-- (email, event_id) where event_id IS NOT NULL; per-email-global
-- dedup handled client-side with a friendly message.

CREATE TABLE IF NOT EXISTS public.pro_waitlist (
  id          BIGSERIAL PRIMARY KEY,
  email       TEXT NOT NULL,
  event_id    UUID REFERENCES public.events(id) ON DELETE SET NULL,
  trigger     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pro_waitlist_email
  ON public.pro_waitlist (lower(email));

CREATE UNIQUE INDEX IF NOT EXISTS uniq_pro_waitlist_email_event
  ON public.pro_waitlist (lower(email), event_id)
  WHERE event_id IS NOT NULL;

ALTER TABLE public.pro_waitlist ENABLE ROW LEVEL SECURITY;

-- Anon INSERT allowed — this is a pre-account signup form.
DROP POLICY IF EXISTS "Anyone can join the waitlist" ON public.pro_waitlist;
CREATE POLICY "Anyone can join the waitlist"
  ON public.pro_waitlist
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- No SELECT / UPDATE / DELETE policies — operators read via the
-- dashboard SQL editor.
