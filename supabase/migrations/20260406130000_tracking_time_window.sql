-- Tracking time window: organizer-controlled start/end for live GPS tracking.
-- Also fixes the broken RLS INSERT policy that referenced e.plan (which
-- doesn't exist on the events table — plan lives on profiles).

-- ── 1. Add tracking window columns to events ──────────────────────────
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS tracking_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tracking_end   TIMESTAMPTZ;

-- ── 2. Fix tracking_sessions INSERT policy ────────────────────────────
-- The original policy checked e.plan = 'pro' but that column doesn't
-- exist. Replace with event_owner_is_paid() + time-window enforcement.
DROP POLICY IF EXISTS "Anyone can start tracking on published pro events" ON public.tracking_sessions;

CREATE POLICY "Anyone can start tracking within tracking window"
  ON public.tracking_sessions FOR INSERT TO anon, authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_id
        AND e.status = 'published'
        AND public.event_owner_is_paid(e.user_id) = true
        AND e.tracking_start IS NOT NULL
        AND e.tracking_end IS NOT NULL
        AND now() >= e.tracking_start
        AND now() <= e.tracking_end
    )
  );

-- ── 3. Update public_events view to expose tracking times ─────────────
CREATE OR REPLACE VIEW public.public_events
WITH (security_invoker = true) AS
SELECT
  e.id,
  e.name,
  e.slug,
  e.city,
  e.event_date,
  e.routes,
  e.pois,
  e.route_count,
  e.poi_count,
  e.logo_url,
  e.branding_style,
  e.updated_at,
  e.tracking_start,
  e.tracking_end,
  public.event_owner_is_paid(e.user_id) AS owner_is_paid
FROM public.events e
WHERE e.status = 'published';

GRANT SELECT ON public.public_events TO anon, authenticated;
