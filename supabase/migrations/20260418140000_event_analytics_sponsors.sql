-- Extend get_event_analytics with per-sponsor aggregates.
--
-- Sponsor POIs live inside the events.pois JSONB column. We extract
-- them with jsonb_array_elements, filter to branded sponsor entries
-- (those with a `sponsor` block), and LEFT JOIN the product_events
-- counts keyed off `properties->>'poi_id'` so a freshly-authored
-- sponsor with zero engagement still shows up in the list.
--
-- Returns, in addition to the existing stats:
--   sponsors: [{ poi_id, title, logo_url, brand_color,
--                impressions, clicks, promo_copies }]
-- ordered by clicks desc, impressions desc — so the analytics card
-- ranks by outcome without extra frontend work.
--
-- SECURITY DEFINER is preserved to match the existing function.

CREATE OR REPLACE FUNCTION public.get_event_analytics(p_event_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE result JSON;
BEGIN
  -- Ownership gate: only the event owner can view analytics
  IF NOT EXISTS (
    SELECT 1 FROM public.events
    WHERE id = p_event_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT json_build_object(
    'views_total',       (SELECT COUNT(*) FROM product_events WHERE event_id = p_event_id AND event_type = 'public_view'),
    'views_runner',      (SELECT COUNT(*) FROM product_events WHERE event_id = p_event_id AND event_type = 'public_view' AND properties->>'mode' = 'runner'),
    'views_spectator',   (SELECT COUNT(*) FROM product_events WHERE event_id = p_event_id AND event_type = 'public_view' AND properties->>'mode' = 'spectator'),
    'subscribers_total', (SELECT COUNT(*) FROM event_subscribers WHERE event_id = p_event_id AND unsubscribed_at IS NULL),
    'qr_generated',      (SELECT COUNT(*) FROM product_events WHERE event_id = p_event_id AND event_type = 'qr_generated'),
    'qr_downloaded',     (SELECT COUNT(*) FROM product_events WHERE event_id = p_event_id AND event_type = 'qr_downloaded'),
    'tracking_sessions', (SELECT COUNT(*) FROM tracking_sessions WHERE event_id = p_event_id),
    'tracking_runners',  (SELECT COUNT(DISTINCT runner_name) FROM tracking_sessions WHERE event_id = p_event_id),
    'views_by_day', (
      SELECT COALESCE(json_agg(row_to_json(d)), '[]'::json)
      FROM (
        SELECT created_at::date AS day, COUNT(*) AS count
        FROM product_events
        WHERE event_id = p_event_id AND event_type = 'public_view'
        GROUP BY day ORDER BY day LIMIT 30
      ) d
    ),
    'sponsors', (
      SELECT COALESCE(json_agg(row_to_json(s) ORDER BY s.clicks DESC, s.impressions DESC), '[]'::json)
      FROM (
        SELECT
          p->>'id' AS poi_id,
          COALESCE(NULLIF(p->>'title', ''), 'Sponsor') AS title,
          p->'sponsor'->>'logoUrl' AS logo_url,
          p->'sponsor'->>'brandColor' AS brand_color,
          (SELECT COUNT(*) FROM product_events
             WHERE event_id = p_event_id
               AND event_type = 'sponsor_impression'
               AND properties->>'poi_id' = p->>'id')::int AS impressions,
          (SELECT COUNT(*) FROM product_events
             WHERE event_id = p_event_id
               AND event_type = 'sponsor_click'
               AND properties->>'poi_id' = p->>'id')::int AS clicks,
          (SELECT COUNT(*) FROM product_events
             WHERE event_id = p_event_id
               AND event_type = 'sponsor_promo_copied'
               AND properties->>'poi_id' = p->>'id')::int AS promo_copies
        FROM public.events e,
             jsonb_array_elements(e.pois) p
        WHERE e.id = p_event_id
          AND p->>'type' = 'sponsor'
          AND p ? 'sponsor'
      ) s
    )
  ) INTO result;

  RETURN result;
END;
$$;
