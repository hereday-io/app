-- Admin overview metrics — one aggregate call behind the is_admin gate.
--
-- Powers /admin (AdminOverview.tsx). Everything here is computed
-- server-side and returned as a single JSON blob: the client never
-- reads raw product_events rows (there is deliberately no admin SELECT
-- policy on that table — see 20260404130000_product_events_and_billing).
--
-- SECURITY DEFINER for two reasons:
--   a. auth.users is not reachable from the client at all.
--   b. anonymous public_view rows have user_id = NULL and are invisible
--      under the per-user SELECT policy on product_events.
-- The explicit is_admin check is the privilege gate — same pattern as
-- admin_lookup_user_by_email in 20260504120000_comp_grants.sql.
--
-- Day buckets are UTC (created_at::date). Good enough for trend shape;
-- don't read a single day's bar as "my local yesterday".

-- product_events is queried here by time across ALL event types, which
-- neither (event_type, created_at) nor (user_id, created_at) serves —
-- the active-user counts filter on date alone.
CREATE INDEX IF NOT EXISTS product_events_created_at_idx
  ON public.product_events (created_at DESC);

CREATE OR REPLACE FUNCTION public.get_admin_overview(p_days INT DEFAULT 30)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp, auth
AS $$
DECLARE
  v_days   INT;
  v_since  TIMESTAMPTZ;
  v_prev   TIMESTAMPTZ;
  v_result JSON;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid() AND p.is_admin = true
  ) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  v_days  := GREATEST(1, LEAST(COALESCE(p_days, 30), 365));
  v_since := now() - make_interval(days => v_days);
  v_prev  := now() - make_interval(days => v_days * 2);

  SELECT json_build_object(
    'window_days',  v_days,
    'generated_at', now(),

    -- ── Users ────────────────────────────────────────────────────
    'users', json_build_object(
      'total', (SELECT count(*)::int FROM auth.users),
      'new_in_window', (
        SELECT count(*)::int FROM auth.users WHERE created_at >= v_since),
      -- Same-length window immediately before this one, for the delta.
      'new_prev_window', (
        SELECT count(*)::int FROM auth.users
         WHERE created_at >= v_prev AND created_at < v_since),
      'new_by_day', (
        SELECT COALESCE(json_agg(row_to_json(d) ORDER BY d.day), '[]'::json)
          FROM (SELECT created_at::date AS day, count(*)::int AS count
                  FROM auth.users WHERE created_at >= v_since
                 GROUP BY 1) d)
    ),

    -- ── Active users ─────────────────────────────────────────────
    -- "Active" = fired at least one product_event while signed in.
    -- Anonymous spectators on public event pages are counted under
    -- 'public' below; they are traffic, not users.
    'active', json_build_object(
      'dau', (SELECT count(DISTINCT user_id)::int FROM product_events
               WHERE user_id IS NOT NULL AND created_at >= now() - interval '1 day'),
      'wau', (SELECT count(DISTINCT user_id)::int FROM product_events
               WHERE user_id IS NOT NULL AND created_at >= now() - interval '7 days'),
      'mau', (SELECT count(DISTINCT user_id)::int FROM product_events
               WHERE user_id IS NOT NULL AND created_at >= now() - interval '30 days'),
      'in_window', (SELECT count(DISTINCT user_id)::int FROM product_events
                     WHERE user_id IS NOT NULL AND created_at >= v_since),
      'prev_window', (SELECT count(DISTINCT user_id)::int FROM product_events
                       WHERE user_id IS NOT NULL
                         AND created_at >= v_prev AND created_at < v_since),
      'by_day', (
        SELECT COALESCE(json_agg(row_to_json(d) ORDER BY d.day), '[]'::json)
          FROM (SELECT created_at::date AS day, count(DISTINCT user_id)::int AS count
                  FROM product_events
                 WHERE user_id IS NOT NULL AND created_at >= v_since
                 GROUP BY 1) d)
    ),

    -- ── Activation ───────────────────────────────────────────────
    -- % of signups that published within 7 days. Only cohorts that have
    -- HAD 7 full days count, otherwise every fresh signup drags the
    -- number down and the metric looks like it's falling when it isn't.
    -- Publish time is approximated by events.created_at on a row whose
    -- status is now 'published' — same approximation the operator query
    -- pack uses; there is no published_at column to be exact with.
    'activation', (
      WITH cohort AS (
        SELECT u.id,
               u.created_at AS signed_up,
               min(e.created_at) FILTER (WHERE e.status = 'published') AS first_publish
          FROM auth.users u
          LEFT JOIN public.events e ON e.user_id = u.id
         WHERE u.created_at >= v_since
           AND u.created_at <= now() - interval '7 days'
         GROUP BY u.id, u.created_at
      )
      SELECT json_build_object(
        'cohort_size', count(*)::int,
        'activated',   (count(*) FILTER (
                         WHERE first_publish <= signed_up + interval '7 days'))::int,
        'pct', CASE WHEN count(*) = 0 THEN NULL
                    ELSE round(100.0 * count(*) FILTER (
                           WHERE first_publish <= signed_up + interval '7 days')
                         / count(*), 1) END
      ) FROM cohort
    ),

    -- ── Funnel (in window) ───────────────────────────────────────
    'funnel', json_build_object(
      'signup_page_views', (SELECT count(*)::int FROM product_events
                             WHERE event_type = 'signup_page_viewed' AND created_at >= v_since),
      'signups', (SELECT count(*)::int FROM auth.users WHERE created_at >= v_since),
      'created_event', (SELECT count(DISTINCT user_id)::int FROM public.events
                         WHERE created_at >= v_since),
      'published', (SELECT count(DISTINCT user_id)::int FROM product_events
                     WHERE event_type = 'event_published' AND created_at >= v_since),
      'hit_paywall', (SELECT count(DISTINCT user_id)::int FROM product_events
                       WHERE event_type = 'paywall_hit' AND created_at >= v_since),
      -- Comp'd events also stamp paid_at, so exclude them: this step is
      -- intent converting to money, not access being handed out.
      'paid', (SELECT count(*)::int FROM public.events
                WHERE paid_at >= v_since AND comp_grant_id IS NULL)
    ),

    -- ── Billing ──────────────────────────────────────────────────
    -- Counts only. Stripe holds the real amounts (promo codes and
    -- refunds never reach this table), so any dollar figure the UI
    -- derives from these is labelled a list-price estimate.
    'billing', json_build_object(
      'paid_events_in_window', (SELECT count(*)::int FROM public.events
                                 WHERE paid_at >= v_since AND comp_grant_id IS NULL),
      'paid_events_prev_window', (SELECT count(*)::int FROM public.events
                                   WHERE paid_at >= v_prev AND paid_at < v_since
                                     AND comp_grant_id IS NULL),
      'paid_events_total', (SELECT count(*)::int FROM public.events
                             WHERE paid_at IS NOT NULL AND comp_grant_id IS NULL),
      'comps_active', (SELECT count(*)::int FROM public.comp_grants WHERE revoked_at IS NULL)
    ),

    -- ── Events ───────────────────────────────────────────────────
    'events', json_build_object(
      'total', (SELECT count(*)::int FROM public.events),
      'published_total', (SELECT count(*)::int FROM public.events WHERE status = 'published'),
      'created_in_window', (SELECT count(*)::int FROM public.events WHERE created_at >= v_since)
    ),

    -- ── Where signups come from ──────────────────────────────────
    -- Only populated for signups after first-touch attribution shipped
    -- (June 2026); older rows land in 'direct / unknown'.
    'sources', (
      SELECT COALESCE(json_agg(row_to_json(s) ORDER BY s.signups DESC), '[]'::json)
        FROM (SELECT coalesce(p.utm_source, p.first_referrer, 'direct / unknown') AS source,
                     count(*)::int AS signups
                FROM public.profiles p
               WHERE p.created_at >= v_since
               GROUP BY 1 ORDER BY 2 DESC LIMIT 10) s
    ),
    'landing_pages', (
      SELECT COALESCE(json_agg(row_to_json(l) ORDER BY l.signups DESC), '[]'::json)
        FROM (SELECT p.first_landing_page AS path, count(*)::int AS signups
                FROM public.profiles p
               WHERE p.created_at >= v_since AND p.first_landing_page IS NOT NULL
               GROUP BY 1 ORDER BY 2 DESC LIMIT 10) l
    ),

    -- ── Public event pages: the viral loop ───────────────────────
    'public', json_build_object(
      'views_in_window', (SELECT count(*)::int FROM product_events
                           WHERE event_type = 'public_view' AND created_at >= v_since),
      'views_prev_window', (SELECT count(*)::int FROM product_events
                             WHERE event_type = 'public_view'
                               AND created_at >= v_prev AND created_at < v_since),
      'shares_in_window', (SELECT count(*)::int FROM product_events
                            WHERE event_type IN ('public_share', 'share_link_copied')
                              AND created_at >= v_since),
      'views_by_day', (
        SELECT COALESCE(json_agg(row_to_json(d) ORDER BY d.day), '[]'::json)
          FROM (SELECT created_at::date AS day, count(*)::int AS count
                  FROM product_events
                 WHERE event_type = 'public_view' AND created_at >= v_since
                 GROUP BY 1) d),
      'top_events', (
        SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.views DESC), '[]'::json)
          FROM (SELECT e.id, e.name, e.slug, count(*)::int AS views
                  FROM product_events pe
                  JOIN public.events e ON e.id = pe.event_id
                 WHERE pe.event_type = 'public_view' AND pe.created_at >= v_since
                 GROUP BY e.id, e.name, e.slug
                 ORDER BY 4 DESC LIMIT 8) t)
    ),

    -- ── Raw feature usage ────────────────────────────────────────
    'top_actions', (
      SELECT COALESCE(json_agg(row_to_json(a) ORDER BY a.count DESC), '[]'::json)
        FROM (SELECT event_type,
                     count(*)::int AS count,
                     count(DISTINCT user_id)::int AS users
                FROM product_events
               WHERE created_at >= v_since
               GROUP BY 1 ORDER BY 2 DESC LIMIT 15) a
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_overview(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_overview(INT) TO authenticated;
