-- Scout token rate-limit table.
--
-- The submit-scouted-poi edge function currently counts recent entries
-- in the events.scouted_pois JSON array to rate-limit. That works at
-- small scale but has two problems:
--   1. The counting scan grows with the array; a spammy token puts
--      the organizer's own editor at risk (same array is read there).
--   2. Rate data leaks into the domain object — deleting old scouted
--      POIs would also reset the rate limit, which is not the intent.
--
-- This table gives us a dedicated counter: one row per submission,
-- indexed on (token, created_at). The edge function counts rows in the
-- last hour instead of scanning the JSON. Purging is a cheap DELETE
-- older than N hours (handled by the edge function itself on each
-- insert — no cron needed at this volume).
--
-- Service-role only: no RLS policies granted to anon/authenticated.
-- The edge function uses the service-role client so it bypasses RLS.

CREATE TABLE IF NOT EXISTS public.scout_rate_limits (
  id          BIGSERIAL PRIMARY KEY,
  token       TEXT NOT NULL,
  event_id    UUID NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- (token, created_at) is the hot query path: "how many submissions
-- from this token in the last hour?"
CREATE INDEX IF NOT EXISTS scout_rate_limits_token_time_idx
  ON public.scout_rate_limits (token, created_at DESC);

-- Optional: index on created_at alone for the purge sweep.
CREATE INDEX IF NOT EXISTS scout_rate_limits_created_at_idx
  ON public.scout_rate_limits (created_at);

ALTER TABLE public.scout_rate_limits ENABLE ROW LEVEL SECURITY;
-- No policies: service role only.
