-- Auto-expire public event pages the day after the event date.
--
-- We do not flip events.status or run a cron job. Instead the
-- public_events view computes a has_ended boolean at read time.
-- Rationale:
--   - No background job to maintain, no drift between scheduled and
--     actual state.
--   - Re-running the race next year only requires the organizer to
--     update event_date; the page automatically comes back.
--   - events.status stays authoritative for the *organizer's* mental
--     model (draft vs published), decoupled from the viewer's
--     timeline state.
--
-- Rule: has_ended is true iff event_date is set AND is strictly before
-- today (UTC). Events without a date never expire. The day-of the race
-- stays live; the day after, the page flips to the "event ended" screen.

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
  public.event_owner_is_paid(e.user_id) AS owner_is_paid,
  (e.event_date IS NOT NULL AND e.event_date < CURRENT_DATE) AS has_ended
FROM public.events e
WHERE e.status = 'published';

GRANT SELECT ON public.public_events TO anon, authenticated;
