-- Volunteer Roster — lightweight per-event crew list.
--
-- Three additive columns on events. The roster itself lives as JSONB
-- (same pattern as events.pois / events.scouted_pois), and two integer
-- columns control the activity-window thresholds the Ops Center uses
-- when deriving Active / Idle / Silent state from poi_status_history
-- matches.
--
-- Defaults: 60-minute active window, 6-hour idle window. Sized for a
-- typical 2–6 hour race — most aid stations see an update cadence of
-- 30–90 minutes, and 6 hours gracefully covers pre-race setup through
-- the long tail of a marathon. Organizers tune per-event if they want.
--
-- No RLS gymnastics — organizers already own their events row via the
-- existing events policy; these new columns inherit that access.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS volunteer_roster         JSONB   NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS volunteer_active_minutes INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS volunteer_idle_hours     INTEGER NOT NULL DEFAULT 6;
