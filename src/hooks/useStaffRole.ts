import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import type { StaffRole } from '@/lib/crm/types';

/**
 * The signed-in user's staff role: 'admin', 'sales' (CRM only) or null.
 *
 * Reads the caller's own profiles row rather than calling staff_role(),
 * so the app keeps working if this ships before
 * 20261012120000_staff_sales_role.sql is applied: `select('*')` simply
 * has no is_sales yet, and admins still resolve from is_admin. This is
 * UX only — every admin and CRM RPC checks the role server-side.
 */
export const useStaffRole = (): { role: StaffRole | null; loading: boolean } => {
  const { user, loading: authLoading } = useAuth();

  const query = useQuery({
    queryKey: ['staff-role', user?.id],
    enabled: !authLoading && !!user,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async (): Promise<StaffRole | null> => {
      const { data } = await supabase.from('profiles').select('*').eq('user_id', user!.id).maybeSingle();
      const row = data as unknown as { is_admin?: boolean; is_sales?: boolean } | null;
      if (row?.is_admin === true) return 'admin';
      if (row?.is_sales === true) return 'sales';
      return null;
    },
  });

  if (authLoading) return { role: null, loading: true };
  if (!user) return { role: null, loading: false };
  return { role: query.data ?? null, loading: query.isLoading };
};
