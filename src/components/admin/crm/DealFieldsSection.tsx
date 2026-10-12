import { useEffect, useState } from 'react';
import { ExternalLink, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useCrmAction } from '@/hooks/crm/useCrm';
import type { DealDetail } from '@/lib/crm/types';
import { fmtDate } from '@/lib/crm/format';
import {
  CHANNELS,
  FIT_FLAGS,
  FIT_FLAG_LABELS,
  MAP_TYPES,
  MAP_TYPE_LABELS,
  ORG_TYPES,
  ORG_TYPE_LABELS,
  type FitFlag,
} from '@/lib/crm/vocab';

const NONE = '__none__';

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="grid grid-cols-[120px_1fr] gap-3 text-[13px] py-1">
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="text-foreground min-w-0 break-words">{children}</dd>
  </div>
);

const Link = ({ href }: { href: string | null }) =>
  href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline break-all">
      {href.replace(/^https?:\/\//, '')} <ExternalLink className="h-3 w-3 shrink-0" />
    </a>
  ) : (
    <span className="text-muted-foreground">—</span>
  );

/** Race, map and next-step fields. Saves send updated_at, so two editors can't silently overwrite each other. */
const DealFieldsSection = ({ detail }: { detail: DealDetail }) => {
  const { toast } = useToast();
  const update = useCrmAction<{ event_link: string | null }>('crm_update_deal');
  const { deal, account } = detail;
  const [editing, setEditing] = useState(false);
  const initial = () => ({
    race_name: deal.race_name,
    race_date: deal.race_date ?? '',
    date_verified: deal.date_verified,
    town: deal.town ?? '',
    tier: deal.tier ? String(deal.tier) : NONE,
    account_name: account?.name ?? '',
    org_type: account?.org_type ?? NONE,
    channel: deal.channel ?? NONE,
    course_map_url: deal.course_map_url ?? '',
    map_type: deal.map_type ?? NONE,
    hereday_link: deal.hereday_link ?? '',
    next_step: deal.next_step ?? '',
    next_step_at: deal.next_step_at ?? '',
    fit_flags: deal.fit_flags,
    notes: deal.notes ?? '',
  });
  const [form, setForm] = useState(initial);

  useEffect(() => {
    if (!editing) setForm(initial());
    // initial() reads the latest deal; refresh whenever it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal, account, editing]);

  const text = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));
  const choose = (key: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [key]: v }));
  const toggleFlag = (flag: FitFlag, on: boolean) =>
    setForm((f) => ({ ...f, fit_flags: on ? [...f.fit_flags, flag] : f.fit_flags.filter((x) => x !== flag) }));

  const save = () => {
    const orNull = (v: string) => (v === NONE || v.trim() === '' ? null : v.trim());
    const patch: Record<string, unknown> = {
      race_name: form.race_name.trim(),
      race_date: orNull(form.race_date),
      date_verified: form.date_verified,
      town: orNull(form.town),
      tier: form.tier === NONE ? null : Number(form.tier),
      channel: orNull(form.channel),
      course_map_url: orNull(form.course_map_url),
      map_type: orNull(form.map_type),
      hereday_link: orNull(form.hereday_link),
      next_step: orNull(form.next_step),
      next_step_at: orNull(form.next_step_at),
      fit_flags: FIT_FLAGS.filter((f) => form.fit_flags.includes(f)),
      notes: orNull(form.notes),
    };
    if (form.account_name.trim() !== (account?.name ?? '')) patch.account_name = form.account_name.trim();
    if ((form.org_type === NONE ? null : form.org_type) !== (account?.org_type ?? null) && (account || patch.account_name)) {
      patch.org_type = orNull(form.org_type);
    }
    update.mutate(
      { p_deal_id: deal.id, p_patch: patch, p_expected_updated_at: deal.updated_at },
      {
        onSuccess: (r) => {
          const link = r?.event_link;
          toast({
            title: 'Saved',
            description:
              link === 'linked'
                ? 'The Hereday link matched a map, so it is linked now.'
                : link === 'not_found'
                  ? "The Hereday link doesn't match any event yet."
                  : link?.startsWith('conflict:')
                    ? `That map is already linked to ${link.slice(9)}.`
                    : undefined,
          });
          setEditing(false);
        },
        onError: (e) => toast({ title: "Couldn't save", description: e.message, variant: 'destructive' }),
      },
    );
  };

  if (!editing) {
    return (
      <div>
        <dl>
          <Row label="Race date">
            {fmtDate(deal.race_date)}
            {deal.race_date && (
              <span className="text-muted-foreground">{deal.date_verified ? ' · verified' : ' · not verified'}</span>
            )}
          </Row>
          <Row label="Town">{deal.town ?? '—'}</Row>
          <Row label="Organization">
            {account ? (
              <>
                {account.name}
                {account.org_type && <span className="text-muted-foreground"> · {ORG_TYPE_LABELS[account.org_type]}</span>}
              </>
            ) : (
              '—'
            )}
          </Row>
          {account?.org_description && (
            <Row label="About">
              <span className="text-muted-foreground">{account.org_description}</span>
            </Row>
          )}
          <Row label="Tier">{deal.tier ?? '—'}</Row>
          <Row label="Channel">{deal.channel ?? '—'}</Row>
          <Row label="Their map">
            {deal.map_type ? MAP_TYPE_LABELS[deal.map_type] : '—'}
            {deal.course_map_url && (
              <span className="block">
                <Link href={deal.course_map_url} />
              </span>
            )}
          </Row>
          <Row label="Hereday link">
            <Link href={deal.hereday_link} />
          </Row>
          {detail.allowed.view_details && (
            <Row label="Next step">
              {deal.next_step || deal.next_step_at ? (
                <>
                  {deal.next_step ?? 'Follow up'}
                  {deal.next_step_at && <span className="text-muted-foreground"> · {fmtDate(deal.next_step_at)}</span>}
                </>
              ) : (
                '—'
              )}
            </Row>
          )}
          {deal.fit_flags.length > 0 && (
            <Row label="Fit concerns">{deal.fit_flags.map((f) => FIT_FLAG_LABELS[f]).join(', ')}</Row>
          )}
          {deal.gmail_draft_id && <Row label="Gmail draft">{deal.gmail_draft_id}</Row>}
        </dl>
        {deal.notes && (
          <p className="mt-3 text-[13px] text-muted-foreground whitespace-pre-wrap border-t border-border pt-3">{deal.notes}</p>
        )}
        {detail.allowed.edit && (
          <Button variant="outline" size="sm" className="gap-1.5 mt-3" onClick={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5" />
            Edit details
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="d-race">Race name</Label>
          <Input id="d-race" value={form.race_name} onChange={text('race_name')} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="d-date">Race date</Label>
          <Input id="d-date" type="date" value={form.race_date} onChange={text('race_date')} />
          <label className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
            <Checkbox
              checked={form.date_verified}
              onCheckedChange={(v) => setForm((f) => ({ ...f, date_verified: v === true }))}
            />
            Read on the race's own page
          </label>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="d-town">Town</Label>
          <Input id="d-town" value={form.town} onChange={text('town')} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="d-org">Organization</Label>
          <Input id="d-org" value={form.account_name} onChange={text('account_name')} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="d-org-type">Type</Label>
          <Select value={form.org_type} onValueChange={choose('org_type')}>
            <SelectTrigger id="d-org-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>—</SelectItem>
              {ORG_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {ORG_TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="d-tier">Tier</Label>
          <Select value={form.tier} onValueChange={choose('tier')}>
            <SelectTrigger id="d-tier">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>—</SelectItem>
              <SelectItem value="1">1</SelectItem>
              <SelectItem value="2">2</SelectItem>
              <SelectItem value="3">3</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="d-channel">Channel</Label>
          <Select value={form.channel} onValueChange={choose('channel')}>
            <SelectTrigger id="d-channel">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>—</SelectItem>
              {CHANNELS.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="d-map-type">Their map</Label>
          <Select value={form.map_type} onValueChange={choose('map_type')}>
            <SelectTrigger id="d-map-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>—</SelectItem>
              {MAP_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {MAP_TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="d-map-url">Their map's URL</Label>
          <Input id="d-map-url" value={form.course_map_url} onChange={text('course_map_url')} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="d-link">Hereday link</Label>
          <Input id="d-link" value={form.hereday_link} onChange={text('hereday_link')} placeholder="https://hereday.io/event/…" />
          <p className="text-[11.5px] text-muted-foreground">Paste the published map's link and it links itself.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="d-next">Next step</Label>
          <Input id="d-next" value={form.next_step} onChange={text('next_step')} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="d-next-at">Due</Label>
          <Input id="d-next-at" type="date" value={form.next_step_at} onChange={text('next_step_at')} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Fit concerns</Label>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {FIT_FLAGS.map((f) => (
            <label key={f} className="flex items-center gap-1.5 text-[12.5px]">
              <Checkbox checked={form.fit_flags.includes(f)} onCheckedChange={(v) => toggleFlag(f, v === true)} />
              {FIT_FLAG_LABELS[f]}
            </label>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="d-notes">Notes</Label>
        <Textarea id="d-notes" rows={4} value={form.notes} onChange={text('notes')} />
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={!form.race_name.trim() || update.isPending}>
          {update.isPending ? 'Saving…' : 'Save details'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={update.isPending}>
          Cancel
        </Button>
      </div>
    </div>
  );
};

export default DealFieldsSection;
