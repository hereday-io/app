-- Product analytics + billing scaffolding.
-- See feature_roadmap.md: "Now — make it buyable" section.

-- ── 1. product_events: client-logged analytics ─────────────────────
-- Every notable user action lands here. Start with a tiny schema and
-- grow the event_type vocabulary as we go. Query in Supabase SQL.
CREATE TABLE public.product_events (
  id           BIGSERIAL PRIMARY KEY,
  event_type   TEXT NOT NULL,
  user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  event_id     UUID,  -- nullable; not a FK because events can be deleted
  properties   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX product_events_type_time_idx
  ON public.product_events (event_type, created_at DESC);
CREATE INDEX product_events_user_time_idx
  ON public.product_events (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

ALTER TABLE public.product_events ENABLE ROW LEVEL SECURITY;

-- Anyone (including anon) can INSERT — we log public page views from
-- unauthenticated spectators. We do not allow SELECT from clients; all
-- reads happen via the Supabase dashboard SQL editor as operators.
CREATE POLICY "Anyone can log product events"
  ON public.product_events
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Users can read their own events (for eventual "your activity" views).
CREATE POLICY "Users can read their own product events"
  ON public.product_events
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- ── 2. Billing columns on profiles ─────────────────────────────────
-- Scaffolding for Stripe. Columns land now; webhook integration lands
-- in a follow-up once a pricing model is chosen. is_paid is kept for
-- backwards compatibility — the paywall hook will switch to plan once
-- the new columns are populated.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'plan'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN plan TEXT NOT NULL DEFAULT 'free'
      CHECK (plan IN ('free', 'pro'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'stripe_customer_id'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN stripe_customer_id TEXT UNIQUE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'stripe_subscription_id'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN stripe_subscription_id TEXT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'current_period_end'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN current_period_end TIMESTAMPTZ;
  END IF;
END$$;

-- Backfill: any existing is_paid=true user becomes plan='pro'.
UPDATE public.profiles SET plan = 'pro' WHERE is_paid = true AND plan = 'free';
