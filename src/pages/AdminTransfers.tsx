import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRightLeft, Check, ChevronRight, Copy, ExternalLink, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import AdminHeader from '@/components/admin/AdminHeader';
import AdminRouteGuard from '@/components/admin/AdminRouteGuard';
import TransferEventDialog, { type TransferResult } from '@/components/admin/TransferEventDialog';

// Links handed to race directors always point at production, even when
// an admin is working from localhost.
const SITE_URL = 'https://hereday.io';

interface AdminEvent {
  id: string;
  name: string;
  slug: string | null;
  status: string;
  event_date: string | null;
  owner_id: string;
  owner_email: string | null;
  paid_at: string | null;
  comp_grant_id: string | null;
  stripe_payment_id: string | null;
  route_count: number;
  poi_count: number;
  updated_at: string;
}

interface UserLookup {
  user_id: string;
  email: string;
  display_name: string | null;
  created_at: string;
}

interface TransferRow {
  id: string;
  event_id: string;
  event_name: string;
  event_slug: string | null;
  from_email: string | null;
  to_email: string;
  transferred_at: string;
  pro_source: string;
  note: string | null;
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * Accepts whatever the admin has on hand — an editor URL
 * (`/editor?id=<uuid>`), a public URL (`/event/<slug>`), a bare id or a
 * bare slug — and returns the id or slug for admin_get_event.
 */
const parseEventRef = (raw: string): string => {
  const value = raw.trim();
  const slugMatch = value.match(/\/event\/([^/?#\s]+)/i);
  if (slugMatch) return decodeURIComponent(slugMatch[1]);
  const idMatch = value.match(UUID_RE);
  if (idMatch) return idMatch[0];
  return value;
};

const formatDateTime = (value: string | null): string => {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const proStatus = (ev: AdminEvent): { label: string; summary: string } => {
  if (ev.stripe_payment_id) return { label: 'Pro · paid via Stripe', summary: 'Stays Pro.' };
  if (ev.comp_grant_id) {
    return {
      label: 'Pro · comp',
      summary: "Stays Pro, and is no longer tied to the current owner's comp.",
    };
  }
  if (ev.paid_at) return { label: 'Pro', summary: 'Stays Pro.' };
  return {
    label: 'Free',
    summary: 'Stays Free, unless the new owner has an active comp, in which case it becomes Pro.',
  };
};

const PRO_SOURCE_LABELS: Record<string, string> = {
  stripe: 'Pro (Stripe)',
  comp_detached: 'Pro (comp kept)',
  comp_recipient: "Pro (recipient's comp)",
  paid_other: 'Pro',
  free: 'Free',
};

const CopyRow = ({ label, value }: { label: string; value: string }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked; the value is visible and selectable.
    }
  };
  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
        <p className="text-sm text-foreground break-words select-all">{value}</p>
      </div>
      <Button variant="outline" size="sm" onClick={copy} className="gap-1 shrink-0">
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
};

const AdminTransfersInner = () => {
  const { toast } = useToast();

  const [eventQuery, setEventQuery] = useState('');
  const [eventLoading, setEventLoading] = useState(false);
  const [event, setEvent] = useState<AdminEvent | null>(null);
  const [eventError, setEventError] = useState<string | null>(null);

  const [emailQuery, setEmailQuery] = useState('');
  const [userLoading, setUserLoading] = useState(false);
  const [recipient, setRecipient] = useState<UserLookup | null>(null);
  const [userError, setUserError] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [result, setResult] = useState<TransferResult | null>(null);

  const [history, setHistory] = useState<TransferRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    const { data, error } = await supabase
      // event_transfers is added in 20261011121000_admin_event_transfer.sql.
      .from('event_transfers' as never)
      .select('*')
      .order('transferred_at', { ascending: false })
      .limit(50);
    setHistoryLoading(false);
    if (error) {
      toast({ title: "Couldn't load transfer history", description: error.message, variant: 'destructive' });
      return;
    }
    setHistory((data ?? []) as unknown as TransferRow[]);
  }, [toast]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const handleFindEvent = async () => {
    const ref = parseEventRef(eventQuery);
    if (!ref) return;
    setEventLoading(true);
    setEventError(null);
    setEvent(null);
    setResult(null);

    const { data, error } = await supabase.rpc('admin_get_event' as never, { p_ref: ref } as never);
    setEventLoading(false);

    if (error) {
      setEventError(error.message);
      return;
    }
    const rows = (data ?? []) as unknown as AdminEvent[];
    if (rows.length === 0) {
      setEventError('No event matches that link, slug or id.');
      return;
    }
    setEvent(rows[0]);
  };

  const handleFindUser = async () => {
    const q = emailQuery.trim();
    if (!q) return;
    setUserLoading(true);
    setUserError(null);
    setRecipient(null);
    setResult(null);

    const { data, error } = await supabase.rpc(
      'admin_lookup_user_by_email' as never,
      { p_email: q } as never,
    );
    setUserLoading(false);

    const rows = (data ?? []) as unknown as UserLookup[];
    if (error || rows.length === 0) {
      setUserError(`No Hereday account uses ${q} yet. Ask them to sign up at hereday.io/signup first.`);
      return;
    }
    setRecipient(rows[0]);
  };

  const resetAll = () => {
    setEventQuery('');
    setEvent(null);
    setEventError(null);
    setEmailQuery('');
    setRecipient(null);
    setUserError(null);
    setResult(null);
  };

  const sameOwner = !!event && !!recipient && event.owner_id === recipient.user_id;
  const canTransfer = !!event && !!recipient && !sameOwner;
  const pro = event ? proStatus(event) : null;

  const publicUrl = result?.event_slug ? `${SITE_URL}/event/${result.event_slug}` : null;
  const editorUrl = result ? `${SITE_URL}/editor?id=${result.event_id}` : null;
  const replyLine = result
    ? `Done. ${result.event_name} is in your Hereday account now. Sign in at hereday.io with ${result.to_email} and you'll find it on your dashboard, ready to edit. The public link hasn't changed${publicUrl ? `: ${publicUrl}` : '.'}`
    : '';

  return (
    <div className="min-h-screen" style={{ background: 'hsl(210 20% 98%)' }}>
      <AdminHeader />

      <main className="max-w-[1180px] mx-auto px-6 pt-9 pb-16">
        <div className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground mb-3">
          <Link to="/admin" className="hover:text-foreground transition-colors">
            Admin
          </Link>
          <ChevronRight className="h-3 w-3" />
          <span className="text-foreground font-medium">Transfers</span>
        </div>

        <h1 className="font-display font-bold text-[32px] leading-none tracking-tight mb-1.5 text-foreground flex items-center gap-3">
          <ArrowRightLeft className="h-7 w-7 text-primary" />
          Admin · Transfers
        </h1>
        <p className="text-[14.5px] text-muted-foreground mb-7 max-w-[62ch] leading-relaxed">
          Hand a map you built to the race director's own account. They become the only owner, it leaves
          the builder's dashboard, and the public link doesn't change. They need to sign up first.
        </p>

        {/* ── Success ──────────────────────────────────────────── */}
        {result && (
          <Card className="p-6 mb-8 border-primary/40">
            <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
              <div>
                <h2 className="font-display font-semibold text-lg flex items-center gap-2">
                  <Check className="h-5 w-5 text-primary" />
                  {result.event_name} now belongs to {result.to_email}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {PRO_SOURCE_LABELS[result.pro_source] ?? result.pro_source}. Reply in your outreach thread
                  to let them know.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={resetAll}>
                Transfer another
              </Button>
            </div>
            <div className="space-y-4">
              <CopyRow label="Reply to paste" value={replyLine} />
              {publicUrl && <CopyRow label="Public link (unchanged)" value={publicUrl} />}
              {editorUrl && <CopyRow label="Editor link (works once they're signed in)" value={editorUrl} />}
            </div>
          </Card>
        )}

        {/* ── 1. Event ─────────────────────────────────────────── */}
        <Card className="p-6 mb-6">
          <h2 className="font-display font-semibold text-lg mb-1">1. Find the map</h2>
          <p className="text-sm text-muted-foreground mb-3">Paste the public link, the editor link, or the slug.</p>
          <div className="flex flex-wrap gap-2 items-center">
            <Input
              placeholder="https://hereday.io/event/…"
              value={eventQuery}
              onChange={(e) => setEventQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleFindEvent();
              }}
              className="max-w-xl"
              disabled={eventLoading}
            />
            <Button onClick={handleFindEvent} disabled={eventLoading || !eventQuery.trim()} className="gap-1.5">
              <Search className="h-4 w-4" />
              {eventLoading ? 'Finding…' : 'Find'}
            </Button>
            {(event || eventError) && (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1"
                onClick={() => {
                  setEventQuery('');
                  setEvent(null);
                  setEventError(null);
                }}
              >
                <X className="h-3.5 w-3.5" />
                Clear
              </Button>
            )}
          </div>

          {eventError && <p className="text-sm text-muted-foreground mt-3">{eventError}</p>}

          {event && pro && (
            <div className="mt-5 border-t border-border pt-5 flex items-start justify-between flex-wrap gap-4">
              <div className="space-y-0.5 min-w-0">
                <p className="text-[15px] font-medium text-foreground">{event.name}</p>
                <p className="text-sm text-muted-foreground">
                  Owner: <span className="text-foreground">{event.owner_email ?? event.owner_id}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {event.status === 'published' ? 'Published' : 'Draft'}
                  {event.event_date ? ` · race ${event.event_date}` : ''} · {event.route_count} route
                  {event.route_count === 1 ? '' : 's'} · {event.poi_count} marker{event.poi_count === 1 ? '' : 's'}
                  {' '}· updated {formatDateTime(event.updated_at)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium px-2 py-1 rounded bg-primary/10 text-primary">{pro.label}</span>
                {event.slug && event.status === 'published' && (
                  <a
                    href={`${SITE_URL}/event/${event.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                  >
                    View <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
          )}
        </Card>

        {/* ── 2. Recipient ─────────────────────────────────────── */}
        <Card className="p-6 mb-6">
          <h2 className="font-display font-semibold text-lg mb-1">2. New owner</h2>
          <p className="text-sm text-muted-foreground mb-3">The email they signed up to Hereday with.</p>
          <div className="flex flex-wrap gap-2 items-center">
            <Input
              type="email"
              placeholder="director@example.com"
              value={emailQuery}
              onChange={(e) => setEmailQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleFindUser();
              }}
              className="max-w-md"
              disabled={userLoading}
            />
            <Button onClick={handleFindUser} disabled={userLoading || !emailQuery.trim()} className="gap-1.5">
              <Search className="h-4 w-4" />
              {userLoading ? 'Looking up…' : 'Look up'}
            </Button>
          </div>

          {userError && <p className="text-sm text-muted-foreground mt-3">{userError}</p>}

          {recipient && (
            <div className="mt-5 border-t border-border pt-5 space-y-0.5">
              <p className="text-[15px] font-medium text-foreground">
                {recipient.display_name || '(no display name)'}
              </p>
              <p className="text-sm text-muted-foreground">{recipient.email}</p>
              <p className="text-xs text-muted-foreground">Joined {formatDateTime(recipient.created_at)}</p>
              {sameOwner && (
                <p className="text-sm text-destructive mt-2">They already own this event.</p>
              )}
            </div>
          )}
        </Card>

        <div className="flex justify-end mb-10">
          <Button onClick={() => setDialogOpen(true)} disabled={!canTransfer} className="gap-1.5">
            <ArrowRightLeft className="h-4 w-4" />
            Transfer map
          </Button>
        </div>

        {/* ── History ──────────────────────────────────────────── */}
        <Card className="p-6">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="font-display font-semibold text-lg">Transfer history</h2>
            <span className="text-xs text-muted-foreground">Last {history.length}</span>
          </div>

          {historyLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No transfers yet.</p>
          ) : (
            <div className="divide-y divide-border">
              {history.map((t) => (
                <div key={t.id} className="py-3 flex items-start justify-between gap-4 flex-wrap">
                  <div className="space-y-0.5 min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate">{t.event_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {t.from_email ?? 'unknown'} → {t.to_email} · {formatDateTime(t.transferred_at)}
                    </p>
                    {t.note && <p className="text-xs text-muted-foreground italic truncate">{t.note}</p>}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {PRO_SOURCE_LABELS[t.pro_source] ?? t.pro_source}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </main>

      <TransferEventDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        eventId={event?.id ?? null}
        eventName={event?.name ?? null}
        fromEmail={event?.owner_email ?? null}
        toEmail={recipient?.email ?? null}
        proSummary={pro?.summary ?? ''}
        onTransferred={(r) => {
          setResult(r);
          setEvent(null);
          setRecipient(null);
          setEventQuery('');
          setEmailQuery('');
          fetchHistory();
        }}
      />
    </div>
  );
};

const AdminTransfers = () => (
  <AdminRouteGuard>
    <AdminTransfersInner />
  </AdminRouteGuard>
);

export default AdminTransfers;
