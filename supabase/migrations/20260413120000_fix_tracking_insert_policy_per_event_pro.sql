-- Fix tracking_sessions INSERT policy to use per-event paid_at
-- instead of the old user-level event_owner_is_paid() check.
-- This aligns with the pricing model: Pro is per-event, not per-user.

DROP POLICY IF EXISTS "Anyone can start tracking within tracking window"
  ON public.tracking_sessions;

CREATE POLICY "Anyone can start tracking within tracking window"
  ON public.tracking_sessions FOR INSERT TO anon, authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_id
        AND e.status = 'published'
        AND e.paid_at IS NOT NULL
        AND e.tracking_start IS NOT NULL
        AND e.tracking_end IS NOT NULL
        AND now() >= e.tracking_start
        AND now() <= e.tracking_end
    )
  );
