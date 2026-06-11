-- First-touch acquisition attribution on profiles.
--
-- Captured client-side on the visitor's first pageview (localStorage),
-- then written here once after the first authenticated session — see
-- src/lib/attribution.ts. The IS NULL guard in the client update plus
-- first-touch-wins capture means these columns are written at most once
-- per user. Existing "Users can update their own profile" RLS policy
-- covers the write; a user can only ever falsify their own attribution.

ALTER TABLE public.profiles
  ADD COLUMN first_referrer TEXT,
  ADD COLUMN first_landing_page TEXT,
  ADD COLUMN utm_source TEXT,
  ADD COLUMN utm_medium TEXT,
  ADD COLUMN utm_campaign TEXT,
  ADD COLUMN utm_term TEXT,
  ADD COLUMN utm_content TEXT,
  ADD COLUMN attribution_captured_at TIMESTAMPTZ;
