import { useMemo } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

/**
 * Shared chrome for every /admin page: the app header plus the admin
 * sub-nav. Extracted from AdminComps so a new admin tool is a route and
 * an entry in TABS, not another copy of this markup.
 */

const TABS: Array<{ to: string; label: string; end?: boolean }> = [
  { to: '/admin', label: 'Overview', end: true },
  { to: '/admin/comps', label: 'Comps' },
];

const AdminHeader = () => {
  const { user, signOut } = useAuth();

  const userInitials = useMemo(() => {
    return user?.email ? user.email.slice(0, 2).toUpperCase() : '?';
  }, [user]);

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-card/80 backdrop-blur-md">
      <div className="max-w-[1180px] mx-auto flex items-center justify-between py-2 px-6">
        <Link to="/" className="flex items-center gap-3">
          <img src="/hereday-logo.png" alt="Hereday" className="h-14 w-auto -my-3" />
        </Link>
        <nav className="flex items-center gap-5 text-[13.5px] text-muted-foreground">
          <Link to="/dashboard" className="hover:text-foreground transition-colors">
            Events
          </Link>
          <Link to="/billing" className="hover:text-foreground transition-colors">
            Billing
          </Link>
          <span className="font-medium text-foreground">Admin</span>
          <div className="h-[30px] w-[30px] rounded-full bg-primary text-primary-foreground font-display font-semibold text-[12px] flex items-center justify-center tracking-wide">
            {userInitials}
          </div>
          <Button variant="ghost" size="sm" onClick={signOut} className="gap-1 h-8">
            <LogOut className="h-3.5 w-3.5" />
            <span className="hidden sm:inline text-xs">Sign out</span>
          </Button>
        </nav>
      </div>

      {/* Admin sub-nav */}
      <div className="border-t border-border/60">
        <div className="max-w-[1180px] mx-auto px-6 flex items-center gap-1">
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                cn(
                  'relative py-2.5 px-3 text-[13px] font-medium transition-colors',
                  isActive
                    ? 'text-foreground after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:bg-primary after:rounded-full'
                    : 'text-muted-foreground hover:text-foreground',
                )
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </div>
      </div>
    </header>
  );
};

export default AdminHeader;
