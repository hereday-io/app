import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlarmClock, ChevronRight, Contact, Hand, Plus, Search, Send, Trophy, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import AdminHeader from '@/components/admin/AdminHeader';
import AdminRouteGuard from '@/components/admin/AdminRouteGuard';
import { EmptyRow, SectionCard, StatCard } from '@/components/admin/AdminStats';
import DealTable from '@/components/admin/crm/DealTable';
import DealSheet from '@/components/admin/crm/DealSheet';
import NewDealDialog from '@/components/admin/crm/NewDealDialog';
import ImportDialog from '@/components/admin/crm/ImportDialog';
import SignupsPanel from '@/components/admin/crm/SignupsPanel';
import { useStaffRole } from '@/hooks/useStaffRole';
import { useDeals, useSignups, useStaff } from '@/hooks/crm/useCrm';
import type { Deal } from '@/lib/crm/types';
import { EFFECTIVE_STAGES, STAGE_LABELS, type EffectiveStage } from '@/lib/crm/vocab';
import { cn } from '@/lib/utils';

type View = 'open' | 'mine' | 'due' | 'unclaimed' | 'discovered' | 'customers' | 'inbound' | 'handoffs' | 'fit' | 'closed';

const CUSTOMER_STAGES: EffectiveStage[] = ['signed_up', 'published', 'paid'];
const IN_FLIGHT: EffectiveStage[] = ['sent', 'followed_up', 'replied'];
const ALL = '__all__';
const POOL = '__pool__';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const VIEWS: Array<{ value: View; label: string; admin?: boolean; test: (d: Deal) => boolean }> = [
  { value: 'open', label: 'Open', test: (d) => d.stage !== 'closed' || CUSTOMER_STAGES.includes(d.effective_stage) },
  { value: 'mine', label: 'Mine', test: (d) => d.is_mine },
  { value: 'due', label: 'Follow-ups due', test: (d) => d.is_due },
  { value: 'unclaimed', label: 'Unclaimed', test: (d) => d.claim_open && !d.is_dnc && d.stage !== 'closed' },
  {
    value: 'discovered',
    label: 'New this week',
    // Races /lead-discover found and researched, still waiting for someone to claim them.
    test: (d) =>
      d.source === 'discovered' && d.claim_open && !d.is_dnc && d.stage === 'new' &&
      Date.now() - Date.parse(d.created_at) < WEEK_MS,
  },
  { value: 'customers', label: 'Customers', test: (d) => CUSTOMER_STAGES.includes(d.effective_stage) },
  { value: 'inbound', label: 'Inbound', test: (d) => d.source === 'inbound' },
  { value: 'handoffs', label: 'Handoffs', admin: true, test: (d) => d.handoff_pending },
  { value: 'fit', label: 'Fit concerns', test: (d) => d.fit_flags.length > 0 && d.stage !== 'closed' },
  { value: 'closed', label: 'Closed', test: (d) => d.stage === 'closed' },
];

const AdminCrmInner = () => {
  const { slug } = useParams<{ slug?: string }>();
  const navigate = useNavigate();
  const { role } = useStaffRole();
  const isAdmin = role === 'admin';

  const [view, setView] = useState<View>(isAdmin ? 'open' : 'mine');
  const [stage, setStage] = useState<string>(ALL);
  const [owner, setOwner] = useState<string>(ALL);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'pipeline' | 'signups'>('pipeline');
  const [newOpen, setNewOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const { data: deals = [], isLoading, error } = useDeals(view === 'closed');
  const { data: staff = [] } = useStaff();
  const { data: untriaged = [] } = useSignups('untriaged', isAdmin);

  const openDeal = (s: string) => navigate(`/admin/crm/${encodeURIComponent(s)}`);
  const closeDeal = () => navigate('/admin/crm');

  const stats = useMemo(
    () => ({
      due: deals.filter((d) => d.is_due && (isAdmin || d.is_mine)).length,
      unclaimed: deals.filter((d) => d.claim_open && !d.is_dnc && d.stage !== 'closed').length,
      inFlight: deals.filter((d) => IN_FLIGHT.includes(d.effective_stage)).length,
      customers: deals.filter((d) => CUSTOMER_STAGES.includes(d.effective_stage)).length,
    }),
    [deals, isAdmin],
  );

  const visible = useMemo(() => {
    const test = VIEWS.find((v) => v.value === view)?.test ?? (() => true);
    const q = search.trim().toLowerCase();
    return deals.filter(
      (d) =>
        test(d) &&
        (stage === ALL || d.effective_stage === stage) &&
        (owner === ALL || (owner === POOL ? !d.owner_id : d.owner_id === owner)) &&
        (!q ||
          [d.race_name, d.slug, d.town, d.account_name, d.contact_name, d.contact_email, d.owner_name]
            .filter(Boolean)
            .some((v) => (v as string).toLowerCase().includes(q))),
    );
  }, [deals, view, stage, owner, search]);

  const views = VIEWS.filter((v) => !v.admin || isAdmin);

  return (
    <div className="min-h-screen" style={{ background: 'hsl(210 20% 98%)' }}>
      <AdminHeader />

      <main className="max-w-[1180px] mx-auto px-4 sm:px-6 pt-9 pb-16">
        <div className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground mb-3">
          {isAdmin ? (
            <Link to="/admin" className="hover:text-foreground transition-colors">
              Admin
            </Link>
          ) : (
            <span>Hereday</span>
          )}
          <ChevronRight className="h-3 w-3" />
          <span className="text-foreground font-medium">CRM</span>
        </div>

        <div className="flex flex-wrap items-start justify-between gap-4 mb-7">
          <div>
            <h1 className="font-display font-bold text-[32px] leading-none tracking-tight mb-1.5 text-foreground flex items-center gap-3">
              <Contact className="h-7 w-7 text-primary" />
              {isAdmin ? 'Admin · CRM' : 'CRM'}
            </h1>
            <p className="text-[14.5px] text-muted-foreground max-w-[64ch] leading-relaxed">
              Every race we're talking to and every customer on Hereday. Signed up, published and paid come straight
              from the app. Claim a lead before you research it.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <Button variant="outline" size="sm" className="gap-1.5 h-9" onClick={() => setImportOpen(true)}>
                <Upload className="h-3.5 w-3.5" />
                Import
              </Button>
            )}
            <Button size="sm" className="gap-1.5 h-9" onClick={() => setNewOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              New deal
            </Button>
          </div>
        </div>

        {error && (
          <Card className="p-5 mb-6 border-destructive/40">
            <p className="text-sm font-medium text-destructive">Couldn't load the CRM</p>
            <p className="text-[13px] text-muted-foreground mt-1">{error.message}</p>
            <p className="text-[12.5px] text-muted-foreground mt-2">
              If this says a function doesn't exist, the <code className="text-[11.5px]">crm_*</code> migrations
              haven't been applied yet.
            </p>
          </Card>
        )}

        <Tabs value={tab} onValueChange={(v) => setTab(v as 'pipeline' | 'signups')}>
          {isAdmin && (
            <TabsList className="mb-5">
              <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
              <TabsTrigger value="signups" className="gap-1.5">
                Signups
                {untriaged.length > 0 && (
                  <span className="text-[10.5px] font-semibold bg-primary text-primary-foreground rounded-full px-1.5 leading-4">
                    {untriaged.length}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>
          )}

          <TabsContent value="pipeline" className="mt-0 space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { icon: AlarmClock, tint: 'bg-rose-500/10 text-rose-600', label: isAdmin ? 'Follow-ups due' : 'Your follow-ups due', value: stats.due, view: 'due' as View },
                { icon: Hand, tint: 'bg-amber-500/10 text-amber-600', label: 'Up for grabs', value: stats.unclaimed, view: 'unclaimed' as View },
                { icon: Send, tint: 'bg-primary/10 text-primary', label: 'In conversation', value: stats.inFlight, view: 'open' as View },
                { icon: Trophy, tint: 'bg-emerald-500/10 text-emerald-600', label: 'Customers', value: stats.customers, view: 'customers' as View },
              ].map((s) => (
                <button key={s.label} type="button" className="text-left" onClick={() => setView(s.view)}>
                  <StatCard
                    icon={s.icon}
                    tint={s.tint}
                    label={s.label}
                    value={isLoading ? '…' : error ? '—' : String(s.value)}
                  />
                </button>
              ))}
            </div>

            <SectionCard
              title="Pipeline"
              hint={
                isAdmin
                  ? 'Click a row for the full story. Closed deals stay out of the way unless you pick Closed.'
                  : "You see every race and who has it. Contact details open up on the ones you've claimed."
              }
            >
              <div className="flex flex-wrap gap-1.5 mb-4">
                {views.map((v) => (
                  <button
                    key={v.value}
                    type="button"
                    onClick={() => setView(v.value)}
                    className={cn(
                      'px-2.5 py-1 rounded-full text-[12.5px] font-medium border transition-colors',
                      view === v.value
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-card text-muted-foreground border-border hover:text-foreground',
                    )}
                  >
                    {v.label}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap gap-2 mb-4">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search race, town, organization, person"
                    className="pl-8 h-9"
                  />
                </div>
                <Select value={stage} onValueChange={setStage}>
                  <SelectTrigger className="w-[150px] h-9 text-[13px]" aria-label="Stage">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Any stage</SelectItem>
                    {EFFECTIVE_STAGES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {STAGE_LABELS[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={owner} onValueChange={setOwner}>
                  <SelectTrigger className="w-[150px] h-9 text-[13px]" aria-label="Owner">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Anyone</SelectItem>
                    <SelectItem value={POOL}>Unclaimed</SelectItem>
                    {staff.map((s) => (
                      <SelectItem key={s.user_id} value={s.user_id}>
                        {s.display_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {isLoading ? (
                <div className="space-y-2">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="h-11 rounded-md bg-muted animate-pulse" />
                  ))}
                </div>
              ) : visible.length === 0 ? (
                <EmptyRow>
                  {deals.length === 0
                    ? isAdmin
                      ? 'No deals yet. Import leads.csv or the reps’ sheet to start.'
                      : 'No deals yet.'
                    : 'Nothing matches these filters.'}
                </EmptyRow>
              ) : (
                <DealTable deals={visible} onOpen={openDeal} />
              )}
              {!isLoading && visible.length > 0 && (
                <p className="text-[11.5px] text-muted-foreground mt-3">
                  {visible.length} of {deals.length} deal{deals.length === 1 ? '' : 's'}
                </p>
              )}
            </SectionCard>
          </TabsContent>

          {isAdmin && (
            <TabsContent value="signups" className="mt-0">
              <SignupsPanel onOpenDeal={openDeal} />
            </TabsContent>
          )}
        </Tabs>
      </main>

      <DealSheet slug={slug ? decodeURIComponent(slug) : null} isAdmin={isAdmin} onClose={closeDeal} />
      <NewDealDialog open={newOpen} onOpenChange={setNewOpen} onCreated={openDeal} />
      {isAdmin && <ImportDialog open={importOpen} onOpenChange={setImportOpen} />}
    </div>
  );
};

const AdminCrm = () => (
  <AdminRouteGuard allow="staff">
    <AdminCrmInner />
  </AdminRouteGuard>
);

export default AdminCrm;
