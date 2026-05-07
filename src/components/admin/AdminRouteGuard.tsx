import { ReactNode, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useIsAdmin } from '@/hooks/useIsAdmin';

interface AdminRouteGuardProps {
  children: ReactNode;
}

const AdminRouteGuard = ({ children }: AdminRouteGuardProps) => {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, loading: adminLoading } = useIsAdmin();
  const navigate = useNavigate();

  useEffect(() => {
    if (authLoading || adminLoading) return;
    if (!user) {
      navigate('/login');
      return;
    }
    if (!isAdmin) {
      navigate('/dashboard');
    }
  }, [authLoading, adminLoading, user, isAdmin, navigate]);

  if (authLoading || adminLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">Loading…</div>
      </div>
    );
  }

  if (!user || !isAdmin) return null;

  return <>{children}</>;
};

export default AdminRouteGuard;
