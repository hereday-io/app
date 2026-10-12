import { ReactNode, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useStaffRole } from '@/hooks/useStaffRole';

interface AdminRouteGuardProps {
  children: ReactNode;
  /**
   * 'admin' (default): Overview, Comps, Transfers. Sales reps are sent to
   * the CRM instead. 'staff': admins and sales reps (the CRM).
   */
  allow?: 'admin' | 'staff';
}

const AdminRouteGuard = ({ children, allow = 'admin' }: AdminRouteGuardProps) => {
  const { user, loading: authLoading } = useAuth();
  const { role, loading: roleLoading } = useStaffRole();
  const navigate = useNavigate();

  const permitted = role === 'admin' || (allow === 'staff' && role === 'sales');

  useEffect(() => {
    if (authLoading || roleLoading) return;
    if (!user) {
      navigate('/login');
      return;
    }
    if (!permitted) {
      navigate(role === 'sales' ? '/admin/crm' : '/dashboard', { replace: true });
    }
  }, [authLoading, roleLoading, user, permitted, role, navigate]);

  if (authLoading || roleLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">Loading…</div>
      </div>
    );
  }

  if (!user || !permitted) return null;

  return <>{children}</>;
};

export default AdminRouteGuard;
