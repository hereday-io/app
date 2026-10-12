-- Volunteer / scout tokens: scope by EVENT OWNER, not by token creator.
--
-- The original policy (20260410120000) was
--     USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid())
-- which never checked that the caller owns the event. public_events
-- exposes event ids, so any signed-in user could insert a token for
-- someone else's event and then drive update-poi-status /
-- submit-scouted-poi with it — those edge functions validate the token
-- (service role), not the caller. In practice: anyone could mark another
-- race's water stations "closed" on the live map.
--
-- New rule: you can see, create and revoke tokens only for events you
-- currently own. Scoping reads by event owner (not creator) also keeps
-- tokens correct when an event changes hands via admin_transfer_event.
--
-- Edge functions are unchanged: they read tokens with the service role,
-- and with insert locked down a live token implies the owner minted it.
--
-- Before applying, audit for tokens minted against someone else's event
-- (expect zero rows; report any to Kevin rather than deleting):
--
--   SELECT t.token, t.purpose, t.event_id, t.created_by, e.user_id AS owner,
--          t.created_at, t.revoked_at
--     FROM public.poi_volunteer_tokens t
--     JOIN public.events e ON e.id = t.event_id
--    WHERE t.created_by <> e.user_id;

DROP POLICY IF EXISTS "Owners manage their tokens" ON public.poi_volunteer_tokens;
DROP POLICY IF EXISTS "Event owners manage tokens" ON public.poi_volunteer_tokens;
CREATE POLICY "Event owners manage tokens"
  ON public.poi_volunteer_tokens
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
       WHERE e.id = poi_volunteer_tokens.event_id
         AND e.user_id = auth.uid()
    )
  )
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.events e
       WHERE e.id = poi_volunteer_tokens.event_id
         AND e.user_id = auth.uid()
    )
  );
