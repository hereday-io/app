-- Analytics aggregation function for event organizers.
-- Returns pre-aggregated stats for a single event, gated by ownership.
-- Uses SECURITY DEFINER to bypass RLS so we can count anonymous
-- product_events (public_view) that have user_id = NULL.

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
    )
  ) INTO result;

  RETURN result;
END;
$$;
