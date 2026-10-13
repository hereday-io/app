import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRightLeft,
  Ban,
  Flag,
  Hand,
  ListChecks,
  Link2,
  MessageSquarePlus,
  Undo2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useToast } from '@/hooks/use-toast';
import { useCrmAction, useDeal, useStaff } from '@/hooks/crm/useCrm';
import type { DealDetail } from '@/lib/crm/types';
import { daysUntil, fmtDate, fmtShort } from '@/lib/crm/format';
import { ORG_TYPE_LABELS } from '@/lib/crm/vocab';
import StageBadge from './StageBadge';
import HeredayStatus from './HeredayStatus';
import ContactSection from './ContactSection';
import DealFieldsSection from './DealFieldsSection';
import DealTimeline from './DealTimeline';
import StageDialog from './StageDialog';
import LogActivityDialog from './LogActivityDialog';
import DncDialog from './DncDialog';
import LinkEventDialog from './LinkEventDialog';

const UNASSIGNED = '__pool__';

const Section = ({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) => (
  <section className="border-t border-border pt-4">
    <div className="flex items-center justify-between gap-3 mb-2.5">
      <h3 className="font-display font-semibold text-[15px]">{title}</h3>
      {action}
    </div>
    {children}
  </section>
);

const Ownership = ({ detail, isAdmin }: { detail: DealDetail; isAdmin: boolean }) => {
  const { toast } = useToast();
  const { deal, allowed } = detail;
  const claim = useCrmAction('crm_claim_deal');
  const release = useCrmAction('crm_release_deal');
  const assign = useCrmAction('crm_assign_deal');
  const { data: staff } = useStaff();
  const busy = claim.isPending || release.isPending || assign.isPending;
  const fail = (title: string) => (e: Error) => toast({ title, description: e.message, variant: 'destructive' });
  const expires = daysUntil(deal.claim_expires_at);

  return (
    <div className="flex flex-wrap items-center gap-2 text-[13px]">
      <span className="text-muted-foreground">
        {deal.owner_id ? (
          <>
            Owner: <span className="text-foreground font-medium">{deal.is_mine ? 'you' : deal.owner_name}</span>
            {deal.claim_open
              ? ' · claim expired'
              : expires !== null
                ? ` · claim ends ${fmtShort(deal.claim_expires_at)}`
                : ''}
          </>
        ) : (
          'Unclaimed'
        )}
      </span>
      {allowed.claim && (
        <Button
          size="sm"
          className="gap-1.5 h-8"
          disabled={busy}
          onClick={() => claim.mutate({ p_deal_id: deal.id }, { onError: fail("Couldn't claim it") })}
        >
          <Hand className="h-3.5 w-3.5" />
          {deal.owner_id ? 'Take over' : 'Claim'}
        </Button>
      )}
      {allowed.release && deal.is_mine && (
        <Button
          size="sm"
          variant="ghost"
          className="gap-1.5 h-8"
          disabled={busy}
          onClick={() => release.mutate({ p_deal_id: deal.id }, { onError: fail("Couldn't release it") })}
        >
          <Undo2 className="h-3.5 w-3.5" />
          Release
        </Button>
      )}
      {isAdmin && staff && (
        <Select
          value={deal.owner_id ?? UNASSIGNED}
          disabled={busy}
          onValueChange={(v) =>
            assign.mutate(
              { p_deal_id: deal.id, p_owner_id: v === UNASSIGNED ? null : v },
              { onError: fail("Couldn't reassign it") },
            )
          }
        >
          <SelectTrigger className="h-8 w-[170px] text-[12.5px]" aria-label="Assign to">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNASSIGNED}>Unclaimed (pool)</SelectItem>
            {staff.map((s) => (
              <SelectItem key={s.user_id} value={s.user_id}>
                {s.display_name}
                {s.role === 'admin' ? ' (admin)' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
};

interface DealSheetProps {
  slug: string | null;
  isAdmin: boolean;
  onClose: () => void;
}

const DealSheet = ({ slug, isAdmin, onClose }: DealSheetProps) => {
  const { toast } = useToast();
  const { data: detail, isLoading, error } = useDeal(slug);
  const log = useCrmAction('crm_log_activity');
  const [dialog, setDialog] = useState<null | 'stage' | 'log' | 'dnc' | 'link'>(null);

  const deal = detail?.deal;
  // Prefill for /admin/transfers. Passed as router state, not a query
  // string, so the director's email never lands in a URL or history.
  const handoffPrefill = {
    event: detail?.events.find((e) => e.owner_is_staff && e.slug)?.slug ?? null,
    email: detail?.contact?.email ?? null,
  };

  const requestHandoff = () => {
    if (!deal) return;
    log.mutate(
      { p_deal_id: deal.id, p_type: 'handoff_requested', p_body: 'Director wants to edit the map in their own account.' },
      {
        onSuccess: () => toast({ title: 'Handoff requested', description: 'An admin will move the map to their account.' }),
        onError: (e) => toast({ title: "Couldn't request it", description: e.message, variant: 'destructive' }),
      },
    );
  };

  return (
    <Sheet open={!!slug} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-[720px] overflow-y-auto p-0">
        {isLoading || !detail || !deal ? (
          <div className="p-6">
            <SheetHeader>
              <SheetTitle className="font-display">{error ? "Couldn't load this deal" : 'Loading…'}</SheetTitle>
              <SheetDescription>{error ? error.message : ' '}</SheetDescription>
            </SheetHeader>
          </div>
        ) : (
          <div className="p-6 space-y-5">
            <SheetHeader className="space-y-1.5 text-left">
              <div className="flex items-start gap-2 flex-wrap pr-8">
                <SheetTitle className="font-display text-[22px] leading-tight">{deal.race_name}</SheetTitle>
                <StageBadge stage={deal.effective_stage} outcome={deal.outcome} dnc={deal.is_dnc} className="mt-1" />
              </div>
              <SheetDescription className="text-[13px]">
                {[
                  deal.race_date ? fmtDate(deal.race_date) : null,
                  deal.town,
                  deal.tier ? `Tier ${deal.tier}` : null,
                  detail.account?.org_type ? ORG_TYPE_LABELS[detail.account.org_type] : null,
                  deal.source === 'inbound' ? 'Inbound signup' : deal.source === 'discovered' ? 'Found by weekly discovery' : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                <span className="block font-mono text-[11.5px] mt-0.5">{deal.slug}</span>
              </SheetDescription>
            </SheetHeader>

            {deal.is_dnc && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800 flex gap-2">
                <Ban className="h-4 w-4 shrink-0 mt-px" />
                <span>
                  Do not contact.
                  {(detail.contact?.dnc_reason || detail.account?.dnc_reason) && (
                    <> “{detail.contact?.dnc_reason ?? detail.account?.dnc_reason}”</>
                  )}{' '}
                  No outreach of any kind.
                </span>
              </div>
            )}

            <Ownership detail={detail} isAdmin={isAdmin} />

            {detail.allowed.edit && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" className="gap-1.5" onClick={() => setDialog('log')}>
                  <MessageSquarePlus className="h-3.5 w-3.5" />
                  Log activity
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setDialog('stage')}>
                  <ListChecks className="h-3.5 w-3.5" />
                  Change stage
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setDialog('link')}>
                  <Link2 className="h-3.5 w-3.5" />
                  Link map
                </Button>
                {isAdmin ? (
                  <Button size="sm" variant="outline" className="gap-1.5" asChild>
                    <Link to="/admin/transfers" state={{ prefill: handoffPrefill }}>
                      <ArrowRightLeft className="h-3.5 w-3.5" />
                      Hand off
                    </Link>
                  </Button>
                ) : (
                  deal.map_built &&
                  !deal.handed_off_at && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      disabled={log.isPending || deal.handoff_pending}
                      onClick={requestHandoff}
                    >
                      <ArrowRightLeft className="h-3.5 w-3.5" />
                      {deal.handoff_pending ? 'Handoff requested' : 'Request handoff'}
                    </Button>
                  )
                )}
                {!deal.is_dnc && (
                  <Button size="sm" variant="ghost" className="gap-1.5 text-rose-700 hover:text-rose-800" onClick={() => setDialog('dnc')}>
                    <Flag className="h-3.5 w-3.5" />
                    Do not contact
                  </Button>
                )}
              </div>
            )}

            {!detail.allowed.view_details && (
              <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-[13px] text-muted-foreground">
                {deal.owner_id
                  ? `${deal.owner_name} owns this deal. Its contact details and history are theirs until the claim ends${
                      deal.claim_expires_at ? ` on ${fmtDate(deal.claim_expires_at)}` : ''
                    }.`
                  : 'Claim this deal to see the contact details and history.'}
              </p>
            )}

            <Section title="On Hereday">
              <HeredayStatus detail={detail} />
            </Section>

            <Section title="Contact">
              <ContactSection detail={detail} />
            </Section>

            <Section title="Details">
              <DealFieldsSection detail={detail} />
            </Section>

            {detail.allowed.view_details && (
              <Section title="Timeline">
                <DealTimeline items={detail.timeline} canVoid={detail.allowed.void} />
              </Section>
            )}

            <StageDialog deal={deal} open={dialog === 'stage'} onOpenChange={(o) => setDialog(o ? 'stage' : null)} />
            <LogActivityDialog deal={deal} open={dialog === 'log'} onOpenChange={(o) => setDialog(o ? 'log' : null)} />
            <DncDialog detail={detail} open={dialog === 'dnc'} onOpenChange={(o) => setDialog(o ? 'dnc' : null)} />
            <LinkEventDialog deal={deal} open={dialog === 'link'} onOpenChange={(o) => setDialog(o ? 'link' : null)} />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
};

export default DealSheet;
