import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, LogOut, Search, ShieldCheck, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import AdminRouteGuard from '@/components/admin/AdminRouteGuard';
import CompGrantDialog from '@/components/admin/CompGrantDialog';
import CompRevokeDialog from '@/components/admin/CompRevokeDialog';

interface UserLookup {
  user_id: string;
  email: string;
  display_name: string | null;
  created_at: string;
}

interface CompGrantRow {
  id: string;
  user_id: string;
  granted_by: string;
  granted_at: string;
  grant_reason: string;
  revoked_at: string | null;
  revoked_by: string | null;
  revoke_reason: string | null;
}

const formatDateTime = (value: string | null): string => {
  if (!value) return '—';
  const d = new Date(value);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const AdminCompsInner = () => {
  const { user, signOut } = useAuth();
  const { toast } = useToast();

  const [emailQuery, setEmailQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<UserLookup | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [activeGrants, setActiveGrants] = useState<CompGrantRow[]>([]);
  const [revokedGrants, setRevokedGrants] = useState<CompGrantRow[]>([]);
  const [grantsLoading, setGrantsLoading] = useState(true);

  const [grantDialogOpen, setGrantDialogOpen] = useState(false);
  const [revokeDialogOpen, setRevokeDialogOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<{ grantId: string; email: string | null } | null>(null);

  const userInitials = useMemo(() => {
    return user?.email ? user.email.slice(0, 2).toUpperCase() : '?';
  }, [user]);

  const fetchGrants = useCallback(async () => {
    setGrantsLoading(true);
    const { data, error } = await supabase
      .from('comp_grants' as never)
      .select('*')
      .order('granted_at', { ascending: false });
    setGrantsLoading(false);
    if (error) {
      toast({
        title: "Couldn't load comp grants",
        description: error.message,
        variant: 'destructive',
      });
      return;
    }
    const rows = (data ?? []) as unknown as CompGrantRow[];
    setActiveGrants(rows.filter((g) => !g.revoked_at));
    setRevokedGrants(rows.filter((g) => g.revoked_at));
  }, [toast]);

  useEffect(() => {
    fetchGrants();
  }, [fetchGrants]);

  const handleSearch = async () => {
    const q = emailQuery.trim();
    if (!q) return;
    setSearching(true);
    setSearchError(null);
    setSearchResult(null);

    const { data, error } = await supabase.rpc(
      'admin_lookup_user_by_email' as never,
      { p_email: q } as never,
    );

    setSearching(false);

    if (error) {
      setSearchError('User not found.');
      return;
    }
    const rows = (data ?? []) as unknown as UserLookup[];
    if (rows.length === 0) {
      setSearchError('User not found.');
      return;
    }
    setSearchResult(rows[0]);
  };

  const clearSearch = () => {
    setEmailQuery('');
    setSearchResult(null);
    setSearchError(null);
  };

  const activeGrantForResult = searchResult
    ? activeGrants.find((g) => g.user_id === searchResult.user_id) ?? null
    : null;

  // Build a small lookup table (user_id → email) for the active-grants table.
  // We only know the email for the searched user; for others we display
  // the user_id prefix. This keeps the UI honest about what's loaded
  // without round-tripping a per-row email lookup (auth.users isn't
  // exposed via RLS).
  const emailFor = (uid: string): string => {
    if (searchResult && searchResult.user_id === uid) return searchResult.email;
    return `${uid.slice(0, 8)}…`;
  };

  return (
    <div className="min-h-screen" style={{ background: 'hsl(210 20% 98%)' }}>
      {/* ── Header ───────────────────────────────────────────────── */}
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
      </header>

      {/* ── Main ─────────────────────────────────────────────────── */}
      <main className="max-w-[1180px] mx-auto px-6 pt-9 pb-16">
        <div className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground mb-3">
          <span>Admin</span>
          <ChevronRight className="h-3 w-3" />
          <span className="text-foreground font-medium">Comps</span>
        </div>

        <h1 className="font-display font-bold text-[32px] leading-none tracking-tight mb-1.5 text-foreground flex items-center gap-3">
          <ShieldCheck className="h-7 w-7 text-primary" />
          Admin · Comps
        </h1>
        <p className="text-[14.5px] text-muted-foreground mb-7 max-w-[62ch] leading-relaxed">
          Grant a user free Pro access on every event they own — current and future. Revocations preserve
          events the user actually paid for via Stripe.
        </p>

        {/* ── Search card ──────────────────────────────────────── */}
        <Card className="p-6 mb-8">
          <h2 className="font-display font-semibold text-lg mb-3">Look up a user</h2>
          <div className="flex flex-wrap gap-2 items-center">
            <Input
              type="email"
              placeholder="user@example.com"
              value={emailQuery}
              onChange={(e) => setEmailQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSearch();
              }}
              className="max-w-md"
              disabled={searching}
            />
            <Button onClick={handleSearch} disabled={searching || !emailQuery.trim()} className="gap-1.5">
              <Search className="h-4 w-4" />
              {searching ? 'Searching…' : 'Look up'}
            </Button>
            {(searchResult || searchError) && (
              <Button variant="ghost" onClick={clearSearch} size="sm" className="gap-1">
                <X className="h-3.5 w-3.5" />
                Clear
              </Button>
            )}
          </div>

          {searchError && (
            <p className="text-sm text-muted-foreground mt-3">{searchError}</p>
          )}

          {searchResult && (
            <div className="mt-5 border-t border-border pt-5">
              <div className="flex items-start justify-between flex-wrap gap-4">
                <div className="space-y-0.5">
                  <p className="text-[15px] font-medium text-foreground">
                    {searchResult.display_name || '(no display name)'}
                  </p>
                  <p className="text-sm text-muted-foreground">{searchResult.email}</p>
                  <p className="text-xs text-muted-foreground">
                    Joined {formatDateTime(searchResult.created_at)}
                  </p>
                  <p className="text-xs text-muted-foreground font-mono mt-1">{searchResult.user_id}</p>
                </div>
                <div className="flex items-center gap-2">
                  {activeGrantForResult ? (
                    <>
                      <span className="text-xs text-primary font-medium px-2 py-1 rounded bg-primary/10">
                        Comp active since {formatDateTime(activeGrantForResult.granted_at)}
                      </span>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setRevokeTarget({
                            grantId: activeGrantForResult.id,
                            email: searchResult.email,
                          });
                          setRevokeDialogOpen(true);
                        }}
                        className="border-destructive/40 text-destructive hover:bg-destructive/10"
                      >
                        Revoke
                      </Button>
                    </>
                  ) : (
                    <Button onClick={() => setGrantDialogOpen(true)}>Grant comp</Button>
                  )}
                </div>
              </div>
              {activeGrantForResult?.grant_reason && (
                <p className="text-xs text-muted-foreground mt-3 italic">
                  Reason: {activeGrantForResult.grant_reason}
                </p>
              )}
            </div>
          )}
        </Card>

        {/* ── Active grants ────────────────────────────────────── */}
        <Card className="p-6 mb-8">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="font-display font-semibold text-lg">Active comps</h2>
            <span className="text-xs text-muted-foreground">{activeGrants.length} active</span>
          </div>

          {grantsLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : activeGrants.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active comp grants.</p>
          ) : (
            <div className="divide-y divide-border">
              {activeGrants.map((g) => (
                <div key={g.id} className="py-3 flex items-start justify-between gap-4 flex-wrap">
                  <div className="space-y-0.5 min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate">{emailFor(g.user_id)}</p>
                    <p className="text-xs text-muted-foreground">
                      Granted {formatDateTime(g.granted_at)}
                    </p>
                    <p className="text-xs text-muted-foreground italic truncate">{g.grant_reason}</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setRevokeTarget({
                        grantId: g.id,
                        email: searchResult?.user_id === g.user_id ? searchResult.email : null,
                      });
                      setRevokeDialogOpen(true);
                    }}
                    className="border-destructive/40 text-destructive hover:bg-destructive/10"
                  >
                    Revoke
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* ── Revoked history ──────────────────────────────────── */}
        <Card className="p-6">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="font-display font-semibold text-lg">Revoked history</h2>
            <span className="text-xs text-muted-foreground">{revokedGrants.length} total</span>
          </div>

          {grantsLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : revokedGrants.length === 0 ? (
            <p className="text-sm text-muted-foreground">No revoked grants.</p>
          ) : (
            <div className="divide-y divide-border">
              {revokedGrants.map((g) => (
                <div key={g.id} className="py-3 flex items-start justify-between gap-4 flex-wrap">
                  <div className="space-y-0.5 min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate">{emailFor(g.user_id)}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(g.granted_at)} → revoked {formatDateTime(g.revoked_at)}
                    </p>
                    <p className="text-xs text-muted-foreground italic truncate">
                      Granted: {g.grant_reason}
                    </p>
                    {g.revoke_reason && (
                      <p className="text-xs text-muted-foreground italic truncate">
                        Revoked: {g.revoke_reason}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </main>

      <CompGrantDialog
        open={grantDialogOpen}
        onOpenChange={setGrantDialogOpen}
        targetUserId={searchResult?.user_id ?? null}
        targetEmail={searchResult?.email ?? null}
        onGranted={fetchGrants}
      />

      <CompRevokeDialog
        open={revokeDialogOpen}
        onOpenChange={(next) => {
          setRevokeDialogOpen(next);
          if (!next) setRevokeTarget(null);
        }}
        grantId={revokeTarget?.grantId ?? null}
        targetEmail={revokeTarget?.email ?? null}
        onRevoked={fetchGrants}
      />
    </div>
  );
};

const AdminComps = () => (
  <AdminRouteGuard>
    <AdminCompsInner />
  </AdminRouteGuard>
);

export default AdminComps;
