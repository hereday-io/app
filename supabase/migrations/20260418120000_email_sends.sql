-- Audit log of organizer-triggered email sends (subscriber updates,
-- volunteer updates, etc). One row per send, regardless of audience
-- count — individual recipients are not stored here, only aggregates.
--
-- Used for:
--   1. The 24-hour-per-event rate limit (query by event_id + sent_at).
--   2. Send-history display in the compose dialog so organizers
--      remember what they sent.
--   3. Event-level analytics (volume of outbound messaging).

CREATE TABLE IF NOT EXISTS public.email_sends (
  id                 BIGSERIAL PRIMARY KEY,
  event_id           UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  sent_by_user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  subject            TEXT NOT NULL,
  body_preview       TEXT NOT NULL, -- first ~200 chars for history display
  audiences          TEXT[] NOT NULL DEFAULT '{}'::text[], -- ['subscribers','volunteers']
  recipient_count    INTEGER NOT NULL DEFAULT 0,
  resend_batch_id    TEXT, -- Resend's batch id for support/debugging
  sent_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_sends_event_sent_idx
  ON public.email_sends (event_id, sent_at DESC);

ALTER TABLE public.email_sends ENABLE ROW LEVEL SECURITY;

-- Owner of the event can SELECT their own send history. No direct INSERT
-- from the client — writes happen only from the send-event-update edge
-- function running with the service role.
DROP POLICY IF EXISTS "Owner can read send history" ON public.email_sends;
CREATE POLICY "Owner can read send history"
  ON public.email_sends
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = email_sends.event_id
        AND e.user_id = auth.uid()
    )
  );
