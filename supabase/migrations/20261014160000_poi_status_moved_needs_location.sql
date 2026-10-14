-- A "Moved" status must say where the marker moved to.
--
-- update-poi-status already rejects state='moved' without moved_to, but
-- the Ops Center override wrote poi_statuses / poi_status_history
-- directly (owner RLS) and could save Moved with null coordinates. The
-- UI no longer offers Moved there; this makes the table enforce it for
-- every writer.
--
-- Prod had zero rows in both tables on 2026-10-14, so the constraints
-- are added validated. Safe to re-run.

ALTER TABLE public.poi_statuses
  DROP CONSTRAINT IF EXISTS poi_statuses_moved_needs_location;
ALTER TABLE public.poi_statuses
  ADD CONSTRAINT poi_statuses_moved_needs_location
  CHECK (state <> 'moved' OR (moved_to_lng IS NOT NULL AND moved_to_lat IS NOT NULL));

ALTER TABLE public.poi_status_history
  DROP CONSTRAINT IF EXISTS poi_status_history_moved_needs_location;
ALTER TABLE public.poi_status_history
  ADD CONSTRAINT poi_status_history_moved_needs_location
  CHECK (state <> 'moved' OR (moved_to_lng IS NOT NULL AND moved_to_lat IS NOT NULL));
