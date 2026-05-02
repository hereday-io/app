-- Pin search_path on enforce_pro_event_gates so a malicious user cannot
-- manipulate the per-session search_path to shadow jsonb_array_length or
-- other functions referenced inside the trigger body. Caught by the
-- Supabase advisor 0011_function_search_path_mutable after the previous
-- migration shipped the trigger without an explicit search_path.

CREATE OR REPLACE FUNCTION public.enforce_pro_event_gates()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE
  v_route_count INT;
  v_poi_count   INT;
BEGIN
  IF NEW.paid_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF (NEW.branding_style IS NOT NULL AND NEW.branding_style != 'none')
     AND (TG_OP = 'INSERT' OR COALESCE(OLD.branding_style, 'none') = 'none') THEN
    RAISE EXCEPTION 'Custom branding requires Pro upgrade ($49 per event)'
      USING ERRCODE = 'P0001';
  END IF;

  IF (NEW.logo_url IS NOT NULL AND NEW.logo_url != '')
     AND (TG_OP = 'INSERT' OR COALESCE(OLD.logo_url, '') = '') THEN
    RAISE EXCEPTION 'Custom logo requires Pro upgrade ($49 per event)'
      USING ERRCODE = 'P0001';
  END IF;

  v_route_count := COALESCE(jsonb_array_length(NEW.routes), 0);
  IF v_route_count > 3
     AND (TG_OP = 'INSERT' OR COALESCE(jsonb_array_length(OLD.routes), 0) <= 3) THEN
    RAISE EXCEPTION 'Free tier limited to 3 routes per event. Upgrade to Pro for unlimited.'
      USING ERRCODE = 'P0001';
  END IF;

  v_poi_count := COALESCE(jsonb_array_length(NEW.pois), 0);
  IF v_poi_count > 30
     AND (TG_OP = 'INSERT' OR COALESCE(jsonb_array_length(OLD.pois), 0) <= 30) THEN
    RAISE EXCEPTION 'Free tier limited to 30 markers per event. Upgrade to Pro for unlimited.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;
