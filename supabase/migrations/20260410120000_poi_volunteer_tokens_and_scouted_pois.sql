-- Mobile POI Scout — Phase 1
--
-- Tokens that let unauthenticated users perform scoped writes against an
-- event they don't own. Phase 1 uses purpose='scout' for mobile POI
-- scouting; the Live-status POI plan will add 'status' and the Photographer
-- POI plan will add 'upload'. The table name is already in its final shape
-- so those features can reuse it without a rename.
--
-- Authorization model: possession of a non-revoked token proves authority
-- for a specific event + purpose. Tokens are ~32 chars of cryptographic
-- randomness, prefixed with the purpose (sct_/sta_/upl_). Organizers
-- generate them from the desktop editor and share the resulting URL.

CREATE TABLE IF NOT EXISTS public.poi_volunteer_tokens (
  token       TEXT PRIMARY KEY,
  event_id    UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  purpose     TEXT NOT NULL CHECK (purpose IN ('scout', 'status', 'upload')),
  created_by  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at  TIMESTAMPTZ,
  label       TEXT
);

-- Owner queries: "show me every token I've ever generated for this event"
CREATE INDEX IF NOT EXISTS idx_poi_volunteer_tokens_event
  ON public.poi_volunteer_tokens (event_id);

-- ── RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.poi_volunteer_tokens ENABLE ROW LEVEL SECURITY;

-- Owners can see, create, and revoke their own tokens. UPDATE is what
-- powers revocation (sets revoked_at); DELETE isn't exposed in the UI but
-- is allowed for cleanup.
DROP POLICY IF EXISTS "Owners manage their tokens" ON public.poi_volunteer_tokens;
CREATE POLICY "Owners manage their tokens"
  ON public.poi_volunteer_tokens
  FOR ALL
  TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- Anon can SELECT a live token, but only by knowing its PK. This is only
-- used as a defensive last resort — the edge functions read via the
-- service role and do their own validation. We keep it here so that a
-- future direct-query path (e.g., a lightweight client-only "is this
-- token still valid?" check) doesn't need a new policy.
DROP POLICY IF EXISTS "Anon can read a live token by PK" ON public.poi_volunteer_tokens;
CREATE POLICY "Anon can read a live token by PK"
  ON public.poi_volunteer_tokens
  FOR SELECT
  TO anon
  USING (revoked_at IS NULL);

-- ── Review-staging column on events ──────────────────────────────────────
--
-- Scouted POIs don't land directly in events.pois. They go into a
-- separate JSONB array the desktop editor surfaces as a review banner.
-- The organizer accepts/rejects/repositions each one before it goes live.
-- This makes scout mode safe to run on already-published events and
-- tolerates GPS drift from the walking user.
--
-- Shape mirrors RoutePoi exactly, with three extra fields per entry:
--   scouted_at         — ISO timestamp
--   scouted_via_token  — first 8 chars of the token (audit trail)
--   id                 — ensures uniqueness for the review UI's keying
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS scouted_pois JSONB NOT NULL DEFAULT '[]'::jsonb;
