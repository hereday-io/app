-- DB audit hardening: indexes, public-read leak fix, POI image bucket
-- See DB_SCHEMA.md for context.

-- ── 1. Indexes ──────────────────────────────────────────────────────
-- Dashboard query: owner's events sorted by recency
CREATE INDEX IF NOT EXISTS events_user_updated_idx
  ON public.events (user_id, updated_at DESC);

-- Public page lookup — partial index on published rows only
CREATE INDEX IF NOT EXISTS events_slug_published_idx
  ON public.events (slug)
  WHERE status = 'published';

-- ── 2. Public read leak fix ─────────────────────────────────────────
-- The previous policy granted SELECT * to anon on any published row,
-- leaking user_id. Replace with a column-filtered view and revoke
-- direct anon access to the table.

DROP POLICY IF EXISTS "Published events are viewable by everyone" ON public.events;

CREATE OR REPLACE VIEW public.public_events
WITH (security_invoker = true) AS
SELECT
  id,
  name,
  slug,
  city,
  event_date,
  routes,
  pois,
  route_count,
  poi_count,
  logo_url,
  branding_style,
  updated_at
FROM public.events
WHERE status = 'published';

-- Re-add a minimal SELECT policy scoped just to published rows. This
-- is what the view reads through when security_invoker=true.
CREATE POLICY "Anon can read published events (via view)"
  ON public.events
  FOR SELECT
  TO anon
  USING (status = 'published');

GRANT SELECT ON public.public_events TO anon, authenticated;

-- ── 3. POI image storage bucket ─────────────────────────────────────
-- POIs previously stored user-uploaded photos as base64 inside the
-- events.pois JSONB blob — every autosave rewrote the full payload.
-- Move them to storage, mirroring the event-logos bucket layout.

INSERT INTO storage.buckets (id, name, public)
VALUES ('poi-images', 'poi-images', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "POI images are publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id = 'poi-images');

CREATE POLICY "Users can upload POI images"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'poi-images'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can update their own POI images"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'poi-images'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can delete their own POI images"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'poi-images'
  AND auth.uid()::text = (storage.foldername(name))[1]
);
