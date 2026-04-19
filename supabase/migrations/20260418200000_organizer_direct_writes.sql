-- Organizer direct-write access to their own event's status + subscriber
-- data. Until now, poi_statuses and poi_status_history only accepted
-- writes through the edge functions (via service role, gated by a
-- volunteer token). That's still the volunteer path, but the Ops
-- Center needs organizers to be able to:
--   - override a marker's status without needing a volunteer link
--   - unsubscribe a subscriber manually from their subscriber list
--
-- Both operations are strictly scoped by event ownership (events.user_id
-- = auth.uid()) via the same EXISTS pattern used elsewhere.

-- ── poi_statuses — organizer UPSERT/UPDATE/DELETE their own events ───
DROP POLICY IF EXISTS "Owners manage statuses on their events" ON public.poi_statuses;
CREATE POLICY "Owners manage statuses on their events"
  ON public.poi_statuses
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = poi_statuses.event_id AND e.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = poi_statuses.event_id AND e.user_id = auth.uid()
    )
  );

-- ── poi_status_history — organizer can append to their own history ───
-- (They already have SELECT via the earlier migration for the analytics
-- timeline.)
DROP POLICY IF EXISTS "Owners insert history for their events" ON public.poi_status_history;
CREATE POLICY "Owners insert history for their events"
  ON public.poi_status_history
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = poi_status_history.event_id AND e.user_id = auth.uid()
    )
  );

-- ── event_subscribers — organizer can UPDATE (for unsubscribe) ───────
-- Only allows setting unsubscribed_at; the table has no other mutable
-- fields an organizer should touch. Column-level RLS isn't natively
-- supported in Postgres, so this relies on the client only updating
-- that one column. Edge function path still preferred for volume.
DROP POLICY IF EXISTS "Owners can update their event subscribers" ON public.event_subscribers;
CREATE POLICY "Owners can update their event subscribers"
  ON public.event_subscribers
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_subscribers.event_id AND e.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_subscribers.event_id AND e.user_id = auth.uid()
    )
  );
