import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Admin-only product metrics. One RPC round-trip per window change —
 * `get_admin_overview` aggregates everything server-side (see
 * supabase/migrations/20260920120000_admin_overview.sql).
 *
 * The RPC raises 42501 for non-admins, so an error here is either
 * "not an admin" or a genuine failure; AdminRouteGuard has already
 * bounced non-admins before this ever runs.
 */

export interface DayCount {
  day: string;
  count: number;
}

export interface AdminOverview {
  window_days: number;
  generated_at: string;
  users: {
    total: number;
    new_in_window: number;
    new_prev_window: number;
    new_by_day: DayCount[];
  };
  active: {
    dau: number;
    wau: number;
    mau: number;
    in_window: number;
    prev_window: number;
    by_day: DayCount[];
  };
  activation: {
    cohort_size: number;
    activated: number;
    pct: number | null;
  };
  funnel: {
    signup_page_views: number;
    signups: number;
    created_event: number;
    published: number;
    hit_paywall: number;
    paid: number;
  };
  billing: {
    paid_events_in_window: number;
    paid_events_prev_window: number;
    paid_events_total: number;
    comps_active: number;
  };
  events: {
    total: number;
    published_total: number;
    created_in_window: number;
  };
  sources: Array<{ source: string; signups: number }>;
  landing_pages: Array<{ path: string; signups: number }>;
  public: {
    views_in_window: number;
    views_prev_window: number;
    shares_in_window: number;
    views_by_day: DayCount[];
    top_events: Array<{ id: string; name: string; slug: string | null; views: number }>;
  };
  top_actions: Array<{ event_type: string; count: number; users: number }>;
}

export function useAdminOverview(days: number) {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchOverview = useCallback(
    async (showLoading: boolean) => {
      if (showLoading) setLoading(true);
      else setRefreshing(true);
      setError(null);

      // Cast through `never`: comp_grants / is_admin / this RPC post-date
      // the generated types in integrations/supabase/types.ts. Same
      // convention as admin_lookup_user_by_email in AdminComps.
      const { data: result, error: rpcError } = await supabase.rpc(
        'get_admin_overview' as never,
        { p_days: days } as never,
      );

      if (rpcError) {
        setError(rpcError.message);
      } else {
        setData(
          (typeof result === 'string' ? JSON.parse(result) : result) as AdminOverview,
        );
      }
      setLoading(false);
      setRefreshing(false);
    },
    [days],
  );

  useEffect(() => {
    void fetchOverview(true);
  }, [fetchOverview]);

  return {
    data,
    loading,
    refreshing,
    error,
    refresh: () => fetchOverview(false),
  };
}
