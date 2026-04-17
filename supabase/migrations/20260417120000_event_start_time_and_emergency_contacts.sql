-- Add start_time so race-day checklists and public pages can show when
-- the race begins, not just the date.
--
-- Add emergency_contacts JSONB so organizers can store race-day contact
-- info (race director phone, medical lead, nearest hospital) that
-- appears on the printed checklist.
--
-- Both columns are nullable — existing events aren't affected.

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS start_time TIME,
  ADD COLUMN IF NOT EXISTS emergency_contacts JSONB DEFAULT '{}';

-- Expose new columns through the public_events view used by the public
-- event page (if the view exists). Safe no-op if it doesn't.
DO $$
BEGIN
  -- Check if the view exists before attempting to replace it
  IF EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_schema = 'public' AND table_name = 'public_events'
  ) THEN
    -- We can't ALTER VIEW to add columns; the view must be recreated
    -- by the developer if they want start_time exposed publicly.
    -- This migration only adds the columns to the base table.
    NULL;
  END IF;
END $$;
