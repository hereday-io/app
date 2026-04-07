import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export function useMapboxToken() {
  const [token, setToken] = useState(
    (import.meta.env.VITE_MAPBOX_TOKEN as string) || ''
  );
  const [loading, setLoading] = useState(!token);

  useEffect(() => {
    if (token) return;
    supabase.functions.invoke('get-mapbox-token').then(({ data, error }) => {
      if (!error && data?.token) setToken(data.token);
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { token, loading };
}
