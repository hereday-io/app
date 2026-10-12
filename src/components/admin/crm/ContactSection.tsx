import { useEffect, useState } from 'react';
import { ExternalLink, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import CopyRow from '@/components/admin/CopyRow';
import { useToast } from '@/hooks/use-toast';
import { useCrmAction } from '@/hooks/crm/useCrm';
import type { DealDetail } from '@/lib/crm/types';
import { fmtDate } from '@/lib/crm/format';

const URL_RE = /^https?:\/\/\S+$/i;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const OTHER_SOURCES = ['hereday_signup', 'inbound_email', 'inbound_call'];
const validSource = (s: string) => URL_RE.test(s.trim()) || OTHER_SOURCES.includes(s.trim());

const SOURCE_HINT = 'The page where you saw it, or inbound_email / inbound_call if they gave it to you.';

const Source = ({ value }: { value: string | null | undefined }) => {
  if (!value) return null;
  if (URL_RE.test(value)) {
    return (
      <a href={value} target="_blank" rel="noopener noreferrer" className="text-[11.5px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1 break-all">
        source <ExternalLink className="h-3 w-3 shrink-0" />
      </a>
    );
  }
  return <span className="text-[11.5px] text-muted-foreground">source: {value.replace(/_/g, ' ')}</span>;
};

/** The deal's contact. "No source URL, no contact" is checked here and by the database. */
const ContactSection = ({ detail }: { detail: DealDetail }) => {
  const { toast } = useToast();
  const upsert = useCrmAction<{ dnc_match: boolean }>('crm_upsert_contact');
  const c = detail.contact;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    full_name: '',
    role_title: '',
    email: '',
    email_source: '',
    phone: '',
    phone_source: '',
    notes: '',
  });

  useEffect(() => {
    setForm({
      full_name: c?.full_name ?? '',
      role_title: c?.role_title ?? '',
      email: c?.email ?? '',
      email_source: c?.email_source ?? '',
      phone: c?.phone ?? '',
      phone_source: c?.phone_source ?? '',
      notes: c?.notes ?? '',
    });
  }, [c, editing]);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const errors = {
    email: form.email.trim() && !EMAIL_RE.test(form.email.trim()) ? "That email doesn't look right." : null,
    email_source: form.email.trim() && !validSource(form.email_source) ? 'Required with an email. ' + SOURCE_HINT : null,
    phone_source: form.phone.trim() && !validSource(form.phone_source) ? 'Required with a phone number. ' + SOURCE_HINT : null,
  };
  const valid = !errors.email && !errors.email_source && !errors.phone_source;

  const save = () => {
    const trimmed = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim() || null]));
    upsert.mutate(
      { p_deal_id: detail.deal.id, p_contact: trimmed },
      {
        onSuccess: (r) => {
          toast(
            r?.dnc_match
              ? {
                  title: 'Saved — and suppressed',
                  description: 'That phone number belongs to someone who asked not to be contacted, so this deal is closed.',
                  variant: 'destructive',
                }
              : { title: 'Contact saved' },
          );
          setEditing(false);
        },
        onError: (e) => toast({ title: "Couldn't save the contact", description: e.message, variant: 'destructive' }),
      },
    );
  };

  if (!detail.allowed.view_details) {
    return (
      <p className="text-[13px] text-muted-foreground">
        {detail.deal.has_email || detail.deal.has_phone
          ? `Has ${[detail.deal.has_email && 'an email', detail.deal.has_phone && 'a phone number'].filter(Boolean).join(' and ')}. `
          : 'No contact details yet. '}
        Claim the deal to see them.
      </p>
    );
  }

  if (!editing) {
    return (
      <div className="space-y-3">
        {!c || (!c.full_name && !c.email && !c.phone) ? (
          <p className="text-[13px] text-muted-foreground">No contact yet.</p>
        ) : (
          <>
            {(c.full_name || c.role_title) && (
              <p className="text-[14px] font-medium text-foreground">
                {c.full_name ?? 'Unnamed'}
                {c.role_title && <span className="font-normal text-muted-foreground"> · {c.role_title}</span>}
              </p>
            )}
            {c.email && (
              <div>
                <CopyRow label="Email" value={c.email} />
                <Source value={c.email_source} />
              </div>
            )}
            {c.phone && (
              <div>
                <CopyRow label="Phone" value={c.phone} />
                <Source value={c.phone_source} />
              </div>
            )}
            {c.signed_up_at && (
              <p className="text-[12.5px] text-emerald-700">Has a Hereday account since {fmtDate(c.signed_up_at)}.</p>
            )}
            {c.other_deal_count > 0 && (
              <p className="text-[12.5px] text-muted-foreground">Also the contact on {c.other_deal_count} other deal(s).</p>
            )}
            {c.notes && <p className="text-[13px] text-muted-foreground whitespace-pre-wrap">{c.notes}</p>}
          </>
        )}
        {detail.allowed.edit && !c?.do_not_contact && (
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5" />
            {c ? 'Edit contact' : 'Add contact'}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="c-name">Name, as published</Label>
          <Input id="c-name" value={form.full_name} onChange={set('full_name')} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="c-role">Role</Label>
          <Input id="c-role" value={form.role_title} onChange={set('role_title')} placeholder="Race director" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="c-email">Email</Label>
          <Input id="c-email" type="email" value={form.email} onChange={set('email')} />
          {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="c-email-src">Where you found it</Label>
          <Input id="c-email-src" value={form.email_source} onChange={set('email_source')} placeholder="https://…" />
          {errors.email_source && <p className="text-xs text-destructive">{errors.email_source}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="c-phone">Phone</Label>
          <Input id="c-phone" value={form.phone} onChange={set('phone')} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="c-phone-src">Where you found it</Label>
          <Input id="c-phone-src" value={form.phone_source} onChange={set('phone_source')} placeholder="https://…" />
          {errors.phone_source && <p className="text-xs text-destructive">{errors.phone_source}</p>}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="c-notes">Notes about them</Label>
        <Textarea id="c-notes" rows={2} value={form.notes} onChange={set('notes')} />
      </div>
      <p className="text-[12px] text-muted-foreground">Never a guess. No source, no contact.</p>
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={!valid || upsert.isPending}>
          {upsert.isPending ? 'Saving…' : 'Save contact'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={upsert.isPending}>
          Cancel
        </Button>
      </div>
    </div>
  );
};

export default ContactSection;
