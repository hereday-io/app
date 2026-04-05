-- Email capture on public event pages.
--
-- The goal: build a list of interested spectators/runners for each event
-- *before* any email sending infrastructure is wired. When notifications
-- land (race-day updates, next-year announcements), we already have the
-- audience. Collection has standalone value; sending is a later layer.
--
-- Scope for this migration: table + RLS only. No send/unsubscribe flows.

CREATE TABLE public.event_subscribers (
  id                BIGSERIAL PRIMARY KEY,
  event_id          UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  email             TEXT NOT NULL,
  -- Light server-side validation. Not a replacement for client validation;
  -- just guardrails against obviously broken data making it to the table.
  CONSTRAINT event_subscribers_email_format_chk
    CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  source            TEXT,          -- which public view captured it (runner/spectator)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Placeholder for a future unsubscribe flow. Column lands now so we
  -- don't need a follow-up migration when we wire it.
  unsubscribed_at   TIMESTAMPTZ
);

-- One email per event. Case-insensitive so "Kevin@x.com" doesn't create
-- a duplicate row alongside "kevin@x.com".
CREATE UNIQUE INDEX event_subscribers_event_email_uidx
  ON public.event_subscribers (event_id, LOWER(email));

-- Owner-read query: "who signed up for my event?" sorted by most recent.
CREATE INDEX event_subscribers_event_created_idx
  ON public.event_subscribers (event_id, created_at DESC);

ALTER TABLE public.event_subscribers ENABLE ROW LEVEL SECURITY;

-- Anon + authenticated can insert. The form sits on public pages, so
-- anon is the primary caller. We do NOT allow SELECT from the insert
-- path — clients can't read back to check duplicates. Instead the
-- unique index surfaces 23505 and the client treats it as a soft
-- success ("you're already on the list").
CREATE POLICY "Anyone can subscribe to events"
  ON public.event_subscribers
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    -- Only allow subscribing to *published* events. This mirrors the
    -- public_events view and prevents spam against draft events.
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_id AND e.status = 'published'
    )
  );

-- Only the event owner can read their subscriber list.
CREATE POLICY "Owners can read their event subscribers"
  ON public.event_subscribers
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_id AND e.user_id = auth.uid()
    )
  );

-- No UPDATE/DELETE policies — the unsubscribe flow will land later via
-- a signed-token edge function, not direct client access.
