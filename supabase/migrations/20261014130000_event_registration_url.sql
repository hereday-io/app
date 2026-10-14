-- Public event page: say when and where, and link to registration.
--
-- 1. events.registration_url — optional link to the race's own sign-up
--    page (RunSignup, Race Roster, a club site). Rendered as a
--    "Register" button on the public page, so it must be http(s): the
--    CHECK keeps javascript:/data: URLs out of an href that anon
--    visitors click. 2048 is the de-facto URL ceiling.
--
-- 2. public_events gains start_time (added to events in 20260417120000,
--    which deliberately left the view alone) and registration_url.
--    CREATE OR REPLACE can only append columns, so the existing list is
--    repeated exactly in prod's order (checked against the live view on
--    2026-10-13: id … has_ended, matching 20260411120000). The
--    security_invoker = false option from 20260501120000 is restated
--    because CREATE OR REPLACE replaces the view's options wholesale —
--    leaving it out would flip the view back to invoker rights and anon
--    (who has no SELECT policy on events) would see zero rows.
--
-- Apply on its own in the SQL editor; never `supabase db push`.
-- Tested by supabase/tests/event_registration.check.mjs.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS registration_url TEXT;

ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_registration_url_http;
ALTER TABLE public.events
  ADD CONSTRAINT events_registration_url_http CHECK (
    registration_url IS NULL
    OR (registration_url ~* '^https?://[^\s]+$' AND length(registration_url) <= 2048)
  );

CREATE OR REPLACE VIEW public.public_events
WITH (security_invoker = false) AS
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
  (e.paid_at IS NOT NULL) AS owner_is_paid,
  (e.event_date IS NOT NULL AND e.event_date < CURRENT_DATE) AS has_ended,
  e.start_time,
  e.registration_url
FROM public.events e
WHERE e.status = 'published';

GRANT SELECT ON public.public_events TO anon, authenticated;
