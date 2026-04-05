-- Expose owner plan through public_events so free-tier public pages can
-- show a "Made with Hereday" footer while paid events hide it.
--
-- We can't join profiles directly inside a security_invoker view because
-- anon's RLS on profiles limits it to its own row (of which there is
-- none). Instead we wrap the lookup in a SECURITY DEFINER function that
-- returns just a boolean — no user_id or other PII crosses the trust
-- boundary.

CREATE OR REPLACE FUNCTION public.event_owner_is_paid(owner_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT (plan = 'pro') OR is_paid = true
     FROM public.profiles
     WHERE user_id = owner_id),
    false
  );
$$;

GRANT EXECUTE ON FUNCTION public.event_owner_is_paid(uuid) TO anon, authenticated;

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
  public.event_owner_is_paid(e.user_id) AS owner_is_paid
FROM public.events e
WHERE e.status = 'published';

GRANT SELECT ON public.public_events TO anon, authenticated;
