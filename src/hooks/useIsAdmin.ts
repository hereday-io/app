import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export const useIsAdmin = (): { isAdmin: boolean | null; loading: boolean } => {
  const { user, loading: authLoading } = useAuth();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setIsAdmin(false);
      setLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('profiles')
        // is_admin is added in migration 20260504120000_comp_grants.sql.
        // Cast through unknown until the generated types catch up.
        .select('is_admin' as unknown as 'plan')
        .eq('user_id', user.id)
        .maybeSingle();

      if (cancelled) return;
      const row = data as unknown as { is_admin?: boolean } | null;
      setIsAdmin(row?.is_admin === true);
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [user, authLoading]);

  return { isAdmin, loading };
};
