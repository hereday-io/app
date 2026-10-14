-- Clean public URLs for new events.
--
-- New events used to get an 8-hex suffix from the browser
-- (lincolnwood-turkey-trot-dcfd2264) because the browser can't check
-- whether a slug is taken: RLS only shows an organizer their own
-- events. This moves the collision check into the database, where it
-- can see every row.
--
-- events_unique_slug() runs BEFORE INSERT. It normalizes the requested
-- slug (or derives one from the name when none is given) and, if
-- another event already has it, appends -2, -3, … until one is free.
-- The UNIQUE constraint on events.slug stays as the last word, so two
-- creates racing for the same name can still raise 23505; the client
-- retries once.
--
-- INSERT only, on purpose. When an organizer types a slug in Edit
-- details (or at publish), a silent "-2" would hand them a URL they
-- didn't choose. Those updates keep failing with 23505 so the UI can
-- say "that link is taken".
--
-- Existing slugs are untouched: published links and printed QR codes
-- keep working.
--
-- Apply on its own in the SQL editor; never `supabase db push`.
-- Tested by supabase/tests/events_clean_slugs.check.mjs.

CREATE OR REPLACE FUNCTION public.events_unique_slug()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_base TEXT;
  v_candidate TEXT;
  v_n INT := 1;
BEGIN
  -- Same rules as the client's normalizeSlug: lowercase a-z, 0-9 and
  -- single hyphens, no leading or trailing hyphen.
  v_base := lower(coalesce(nullif(btrim(NEW.slug), ''), NEW.name, ''));
  v_base := regexp_replace(v_base, '[^a-z0-9]+', '-', 'g');
  v_base := regexp_replace(v_base, '(^-+|-+$)', '', 'g');
  -- Leave room for a "-NNN" suffix; 80 chars is plenty for a race name.
  v_base := left(v_base, 80);
  v_base := regexp_replace(v_base, '-+$', '');
  IF v_base = '' THEN
    v_base := 'event';
  END IF;

  v_candidate := v_base;
  -- SECURITY DEFINER, so this sees every event, not just the caller's.
  WHILE EXISTS (SELECT 1 FROM public.events WHERE slug = v_candidate AND id <> NEW.id) LOOP
    v_n := v_n + 1;
    IF v_n > 500 THEN
      -- Pathological name reuse: fall back to a random suffix rather
      -- than looping forever.
      v_candidate := v_base || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 6);
      EXIT;
    END IF;
    v_candidate := v_base || '-' || v_n;
  END LOOP;

  NEW.slug := v_candidate;
  RETURN NEW;
END;
$$;

-- A trigger function; nobody should call it directly.
REVOKE ALL ON FUNCTION public.events_unique_slug() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS events_unique_slug ON public.events;
CREATE TRIGGER events_unique_slug
  BEFORE INSERT ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.events_unique_slug();
