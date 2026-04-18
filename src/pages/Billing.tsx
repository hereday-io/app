import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowUpRight, Check, ChevronRight, Crown, Download, Info, Lock, LogOut, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { PAYWALL_LIMITS } from '@/hooks/usePaywall';
import UpgradeModal from '@/components/UpgradeModal';
import StripeWordmark from '@/components/StripeWordmark';
import { logEvent } from '@/lib/analytics';

// ────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────
interface BillingEvent {
  id: string;
  name: string;
  city: string | null;
  event_date: string | null;
  status: string;
  route_count: number;
  poi_count: number;
  paid_at: string | null;
  stripe_session_id: string | null;
}

interface ChargeRow {
  id: string;
  amount: number;
  amount_refunded: number;
  currency: string;
  created: number;
  status: string;
  receipt_url: string | null;
  card_brand: string | null;
  card_last4: string | null;
  event_id: string | null;
  event_name: string | null;
  promo_code: string | null;
  percent_off: number | null;
  refunded: boolean;
}

interface PaymentMethod {
  id: string;
  brand: string;
  last4: string;
  exp_month: number;
  exp_year: number;
}

interface ActivePromo {
  code: string;
  percent_off: number | null;
  expires_at: string | null;
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────
const formatDate = (value: string | null): string => {
  if (!value) return '';
  const d = new Date(value.includes('T') ? value : value + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const formatMoney = (amountCents: number, currency = 'usd'): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() })
    .format(amountCents / 100);

const shortReceipt = (sessionId: string | null): string => {
  if (!sessionId) return '';
  // Compact display id that feels stable to the user — last 5 chars of
  // the Stripe session id, uppercased, prefixed with `hd_`.
  return `hd_${sessionId.slice(-5).toUpperCase()}`;
};

// Tailwind doesn't know about Visa's corporate navy, so render the card
// brand mark inline. Each brand is its own small gradient/color block.
const BrandMark = ({ brand }: { brand: string | null }) => {
  const key = (brand ?? '').toLowerCase();
  if (key === 'visa') {
    return (
      <div
        className="w-10 h-7 rounded-[5px] shrink-0 text-white font-display font-extrabold text-[10px] tracking-wider flex items-center justify-center"
        style={{
          background:
            'linear-gradient(135deg, #1a1f71 0%, #1a1f71 55%, #f7b600 55%, #f7b600 100%)',
        }}
      >
        VISA
      </div>
    );
  }
  if (key === 'mastercard') {
    return (
      <div className="w-10 h-7 rounded-[5px] shrink-0 bg-neutral-800 text-white font-display font-extrabold text-[9px] flex items-center justify-center relative overflow-hidden">
        <span className="absolute left-1 w-4 h-4 rounded-full bg-[#eb001b] opacity-95" />
        <span className="absolute right-1 w-4 h-4 rounded-full bg-[#f79e1b] opacity-90" />
      </div>
    );
  }
  if (key === 'amex' || key === 'american_express') {
    return (
      <div className="w-10 h-7 rounded-[5px] shrink-0 bg-[#2E77BC] text-white font-display font-extrabold text-[9px] flex items-center justify-center">
        AMEX
      </div>
    );
  }
  return (
    <div className="w-10 h-7 rounded-[5px] shrink-0 bg-muted text-foreground font-display font-semibold text-[9px] uppercase flex items-center justify-center">
      {brand ?? 'Card'}
    </div>
  );
};

// ────────────────────────────────────────────────────────────────────
// Page
// ────────────────────────────────────────────────────────────────────
const Billing = () => {
  const { user, loading: authLoading, signOut } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [events, setEvents] = useState<BillingEvent[] | null>(null);
  const [charges, setCharges] = useState<ChargeRow[] | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);
  const [paymentMethodLoading, setPaymentMethodLoading] = useState(true);
  const [activePromo, setActivePromo] = useState<ActivePromo | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);

  const [promoInput, setPromoInput] = useState('');
  const [promoApplying, setPromoApplying] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);

  const [removeCardOpen, setRemoveCardOpen] = useState(false);
  const [unlockEvent, setUnlockEvent] = useState<BillingEvent | null>(null);

  // ── Auth gate ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!authLoading && !user) navigate('/login');
  }, [authLoading, user, navigate]);

  useEffect(() => {
    if (user) logEvent('billing_viewed');
  }, [user]);

  // ── Scroll to #promo if the modal deep-linked here ────────────────
  useEffect(() => {
    if (window.location.hash === '#promo') {
      setTimeout(() => {
        document.getElementById('promo')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 200);
    }
  }, []);

  // ── Data fetches ──────────────────────────────────────────────────
  const fetchEvents = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('events')
      .select('id, name, city, event_date, status, route_count, poi_count, paid_at, stripe_session_id')
      .eq('user_id', user.id)
      .order('paid_at', { ascending: false, nullsFirst: false })
      .order('updated_at', { ascending: false });
    setEvents((data ?? []) as BillingEvent[]);
  }, [user]);

  const fetchProfile = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('profiles')
      .select('display_name, active_promo_code, active_promo_percent_off, active_promo_expires_at')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!data) return;
    if (data.display_name) setDisplayName(data.display_name);
    if (data.active_promo_code) {
      setActivePromo({
        code: data.active_promo_code,
        percent_off: data.active_promo_percent_off ?? null,
        expires_at: data.active_promo_expires_at ?? null,
      });
    } else {
      setActivePromo(null);
    }
  }, [user]);

  const fetchCharges = useCallback(async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase.functions.invoke('list-charges');
      if (error) throw error;
      setCharges((data?.charges ?? []) as ChargeRow[]);
    } catch {
      // Stripe not yet configured — fail quietly with empty list.
      setCharges([]);
    }
  }, [user]);

  const fetchPaymentMethod = useCallback(async () => {
    if (!user) return;
    setPaymentMethodLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('get-payment-method');
      if (error) throw error;
      setPaymentMethod((data?.paymentMethod ?? null) as PaymentMethod | null);
    } catch {
      setPaymentMethod(null);
    } finally {
      setPaymentMethodLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    fetchEvents();
    fetchProfile();
    fetchCharges();
    fetchPaymentMethod();
  }, [user, fetchEvents, fetchProfile, fetchCharges, fetchPaymentMethod]);

  // ── Derived values ────────────────────────────────────────────────
  const paidEvents = events?.filter((e) => !!e.paid_at) ?? [];
  const unlockedCount = paidEvents.length;
  const refundedCount = charges?.filter((c) => c.refunded).length ?? 0;
  const lifetimeSpend = charges
    ? charges.reduce((sum, c) => sum + (c.refunded ? 0 : c.amount - c.amount_refunded), 0)
    : paidEvents.length * 4900; // fallback before Stripe is live

  const userInitials = useMemo(() => {
    if (displayName) {
      const parts = displayName.trim().split(/\s+/);
      if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
      return parts[0].slice(0, 2).toUpperCase();
    }
    return user?.email ? user.email.slice(0, 2).toUpperCase() : '?';
  }, [displayName, user]);

  // ── Actions ───────────────────────────────────────────────────────
  const handleReceipt = async (chargeId: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('get-receipt', {
        // GET with query string via the invoke body would be ignored;
        // use a URL-built fetch directly against the function host.
        body: { charge_id: chargeId },
      });
      if (error || !data?.url) throw error ?? new Error('No receipt URL');
      window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch {
      toast({
        title: 'Receipt not available',
        description: "We couldn't fetch this receipt. Email legal@hereday.io if you need it.",
        variant: 'destructive',
      });
    }
  };

  const handleEventReceipt = async (event: BillingEvent) => {
    // Look up the charge for this event from the already-loaded list
    // rather than round-tripping through get-receipt, which needs a
    // Stripe charge id (we only have the session id on the event row).
    const match = charges?.find((c) => c.event_id === event.id);
    if (match?.receipt_url) {
      window.open(match.receipt_url, '_blank', 'noopener,noreferrer');
      return;
    }
    if (match) {
      handleReceipt(match.id);
      return;
    }
    toast({
      title: 'Receipt not found',
      description: "We couldn't locate a receipt for this event yet.",
    });
  };

  const handleUpdateCard = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('open-billing-portal', {
        body: { returnUrl: window.location.href },
      });
      if (error || !data?.url) throw error ?? new Error('No portal URL');
      window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch {
      toast({
        title: 'Billing portal unavailable',
        description: 'Stripe portal is offline. Try again in a moment.',
        variant: 'destructive',
      });
    }
  };

  const handleRemoveCard = async () => {
    setRemoveCardOpen(false);
    try {
      const { error } = await supabase.functions.invoke('detach-payment-method');
      if (error) throw error;
      setPaymentMethod(null);
      toast({ title: 'Card removed' });
    } catch {
      toast({
        title: "Couldn't remove card",
        description: 'Please try again.',
        variant: 'destructive',
      });
    }
  };

  const handleApplyPromo = async () => {
    const code = promoInput.trim();
    if (!code) return;
    setPromoApplying(true);
    setPromoError(null);
    try {
      const { data, error } = await supabase.functions.invoke('apply-promo', { body: { code } });
      if (error) throw error;
      if (!data?.valid) {
        setPromoError(data?.error ?? "That code isn't valid or has expired.");
        return;
      }
      setActivePromo({
        code: data.code ?? code.toUpperCase(),
        percent_off: data.percent_off ?? null,
        expires_at: data.expires_at ?? null,
      });
      setPromoInput('');
      toast({ title: 'Promo code applied' });
    } catch {
      setPromoError("That code isn't valid or has expired.");
    } finally {
      setPromoApplying(false);
    }
  };

  const handleRemovePromo = async () => {
    try {
      const { error } = await supabase.functions.invoke('remove-promo');
      if (error) throw error;
      setActivePromo(null);
    } catch {
      toast({
        title: "Couldn't remove code",
        description: 'Please try again.',
        variant: 'destructive',
      });
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">Loading…</div>
      </div>
    );
  }

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
            <span className="font-medium text-foreground">Billing</span>
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
        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground mb-3">
          <span>Settings</span>
          <ChevronRight className="h-3 w-3" />
          <span className="text-foreground font-medium">Billing</span>
        </div>

        <h1 className="font-display font-bold text-[32px] leading-none tracking-tight mb-1.5 text-foreground">
          Billing
        </h1>
        <p className="text-[14.5px] text-muted-foreground mb-7 max-w-[62ch] leading-relaxed">
          Hereday Pro is a one-time $49 upgrade per event —{' '}
          <b className="text-foreground font-medium">no subscription, no auto-renew</b>. Manage unlocked
          events, download receipts, and update the card on file for future unlocks.
        </p>

        {/* Info callout */}
        <div
          className="flex items-start gap-3 rounded-xl px-4 py-3.5 mb-9"
          style={{
            background: 'hsl(217 91% 50% / 0.06)',
            border: '1px solid hsl(217 91% 50% / 0.18)',
          }}
        >
          <div
            className="w-8 h-8 rounded-lg bg-white flex items-center justify-center shrink-0"
            style={{ border: '1px solid hsl(217 91% 50% / 0.22)', color: 'hsl(217 91% 45%)' }}
          >
            <Info className="h-4 w-4" />
          </div>
          <div>
            <div className="font-display font-semibold text-[14px] text-foreground mb-0.5">
              You'll only see a charge here when you unlock an event.
            </div>
            <p className="text-[13px] m-0 leading-[1.55]" style={{ color: 'hsl(215 20% 35%)' }}>
              Free events stay free forever. Upgrades unlock Pro features on a specific event — they
              don't renew and don't transfer. Got a promo code? Apply it on the right. See our{' '}
              <Link
                to="/refund"
                className="no-underline border-b"
                style={{ color: 'hsl(217 91% 45%)', borderColor: 'hsl(217 91% 50% / 0.3)' }}
              >
                refund policy
              </Link>{' '}
              for details on how refunds work.
            </p>
          </div>
        </div>

        {/* ── Two-column grid ──────────────────────────────────── */}
        <div className="grid gap-8 items-start grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px]">
          {/* ── LEFT: events list + purchase history ─────────── */}
          <div>
            <EventsPanel
              events={events}
              charges={charges}
              onUnlock={(e) => setUnlockEvent(e)}
              onReceipt={handleEventReceipt}
            />

            <div className="mt-7">
              <PurchaseHistoryPanel charges={charges} onDownload={handleReceipt} />
            </div>
          </div>

          {/* ── RIGHT: sticky side rail ──────────────────────── */}
          <aside className="flex flex-col gap-4 lg:sticky lg:top-[88px]">
            {/* Lifetime spend */}
            <SidePanel>
              <SidePanelHeading>Lifetime spend</SidePanelHeading>
              <div
                className="font-display font-bold text-[32px] leading-none tracking-tight text-foreground"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {formatMoney(lifetimeSpend)}
              </div>
              <p className="text-[12.5px] text-muted-foreground mt-1.5 mb-3.5">
                Across {unlockedCount} unlocked event{unlockedCount === 1 ? '' : 's'}. You'll never be
                charged unless you unlock another event.
              </p>
              <div className="grid grid-cols-2 gap-2.5 pt-3.5 border-t border-border">
                <div>
                  <div className="font-display font-semibold text-lg text-foreground">
                    {unlockedCount}
                  </div>
                  <div className="text-[11px] text-muted-foreground uppercase tracking-wider font-display font-semibold mt-0.5">
                    Unlocked
                  </div>
                </div>
                <div>
                  <div className="font-display font-semibold text-lg text-foreground">
                    {refundedCount}
                  </div>
                  <div className="text-[11px] text-muted-foreground uppercase tracking-wider font-display font-semibold mt-0.5">
                    Refunded
                  </div>
                </div>
              </div>
            </SidePanel>

            {/* Payment method */}
            <SidePanel>
              <SidePanelHeading>Payment method</SidePanelHeading>
              {paymentMethodLoading ? (
                <Skeleton className="h-[60px] w-full" />
              ) : paymentMethod ? (
                <>
                  <div
                    className="flex items-center gap-3 rounded-[10px] p-[10px_12px]"
                    style={{
                      background: 'hsl(210 20% 99%)',
                      border: '1px solid hsl(var(--border))',
                    }}
                  >
                    <BrandMark brand={paymentMethod.brand} />
                    <div className="flex-1 min-w-0 flex flex-col gap-[1px]">
                      <span
                        className="font-display font-medium text-[13px] text-foreground"
                        style={{ fontVariantNumeric: 'tabular-nums', letterSpacing: '0.01em' }}
                      >
                        •••• •••• •••• {paymentMethod.last4}
                      </span>
                      <span className="text-[11.5px] text-muted-foreground font-display">
                        Expires {String(paymentMethod.exp_month).padStart(2, '0')} /{' '}
                        {paymentMethod.exp_year}
                      </span>
                    </div>
                    <span
                      className="text-[9.5px] uppercase tracking-wider font-display font-semibold"
                      style={{ color: 'hsl(152 60% 32%)' }}
                    >
                      Default
                    </span>
                  </div>
                  <div className="flex gap-2 mt-3">
                    <Button variant="outline" size="sm" className="flex-1 h-8" onClick={handleUpdateCard}>
                      Update
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 h-8"
                      onClick={() => setRemoveCardOpen(true)}
                    >
                      Remove
                    </Button>
                  </div>
                </>
              ) : (
                <Button variant="outline" size="sm" className="w-full h-9" onClick={handleUpdateCard}>
                  + Add payment method
                </Button>
              )}

              <div
                className="flex items-center justify-center gap-1.5 mt-2 py-2 px-3 rounded-[10px] text-[11.5px] text-muted-foreground"
                style={{
                  background: 'hsl(210 20% 99%)',
                  border: '1px solid hsl(var(--border))',
                }}
              >
                <Lock className="h-[11px] w-[11px] text-muted-foreground" />
                Powered by <StripeWordmark />
              </div>
            </SidePanel>

            {/* Promo code */}
            <div id="promo" className="scroll-mt-24">
              <SidePanel>
                <SidePanelHeading>Promo code</SidePanelHeading>
                <p className="text-[12.5px] leading-[1.5] mb-3 mt-0" style={{ color: 'hsl(215 20% 35%)' }}>
                  Got a code from a partner race or community? Redeem it here — it'll auto-apply to your
                  next unlock.
                </p>

                {activePromo && (
                  <div
                    className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 mb-2.5"
                    style={{
                      background: 'hsl(152 60% 42% / 0.08)',
                      border: '1px solid hsl(152 60% 42% / 0.22)',
                    }}
                  >
                    <span
                      className="w-[22px] h-[22px] rounded-full text-white flex items-center justify-center shrink-0"
                      style={{ background: 'hsl(152 60% 42%)' }}
                    >
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div
                        className="font-mono font-semibold text-[12.5px] tracking-wider"
                        style={{ color: 'hsl(152 60% 28%)' }}
                      >
                        {activePromo.code}
                      </div>
                      <div className="text-[11.5px] mt-[1px]" style={{ color: 'hsl(152 60% 32%)' }}>
                        {activePromo.percent_off ? `${activePromo.percent_off}% off your next unlock` : 'Applied to your next unlock'}
                        {activePromo.expires_at ? ` — expires ${formatDate(activePromo.expires_at)}` : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleRemovePromo}
                      aria-label="Remove promo code"
                      className="w-[22px] h-[22px] rounded-md flex items-center justify-center opacity-70 hover:opacity-100 transition-opacity"
                      style={{ color: 'hsl(152 60% 32%)' }}
                    >
                      <X className="h-[13px] w-[13px]" />
                    </button>
                  </div>
                )}

                {activePromo && <p className="text-[11px] text-muted-foreground m-0 mb-2">Add another code:</p>}

                <div className="flex gap-2">
                  <Input
                    value={promoInput}
                    onChange={(e) => setPromoInput(e.target.value)}
                    placeholder="Enter code"
                    className="h-9 font-mono uppercase tracking-wider text-[13px] placeholder:normal-case placeholder:font-body placeholder:tracking-normal"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !promoApplying) handleApplyPromo();
                    }}
                  />
                  <Button
                    onClick={handleApplyPromo}
                    disabled={promoApplying || !promoInput.trim()}
                    className="h-9 bg-foreground text-background hover:bg-foreground/90 font-medium text-[13px] px-3.5"
                  >
                    {promoApplying ? '…' : 'Apply'}
                  </Button>
                </div>
                {promoError && (
                  <p className="text-[11.5px] mt-2" style={{ color: 'hsl(0 72% 55%)' }}>
                    {promoError}
                  </p>
                )}
              </SidePanel>
            </div>

            {/* Help */}
            <SidePanel>
              <SidePanelHeading>Need help?</SidePanelHeading>
              <p className="text-[12.5px] leading-[1.55] mb-3 mt-0" style={{ color: 'hsl(215 20% 35%)' }}>
                Refunds available within 7 days for unpublished events, or for cancelled races within
                30 days.
              </p>
              <a
                href="mailto:legal@hereday.io"
                className="inline-flex items-center gap-1.5 text-[13px] font-medium no-underline"
                style={{ color: 'hsl(217 91% 45%)' }}
              >
                legal@hereday.io
                <ArrowUpRight className="h-[11px] w-[11px]" />
              </a>
            </SidePanel>
          </aside>
        </div>
      </main>

      {/* ── Footer ───────────────────────────────────────────────── */}
      <footer className="border-t border-border bg-card py-8 mt-12">
        <div className="max-w-[1180px] mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <img src="/hereday-logo.png" alt="Hereday" className="h-14 w-auto -my-3 opacity-70" />
          <p className="text-[11.5px] text-muted-foreground m-0">
            &copy; {new Date().getFullYear()} Hereday LLC. All rights reserved.
          </p>
          <div className="flex gap-4 text-[11.5px] text-muted-foreground">
            <Link to="/terms" className="hover:text-foreground transition-colors">Terms</Link>
            <Link to="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
            <Link to="/refund" className="hover:text-foreground transition-colors">Refund</Link>
          </div>
        </div>
      </footer>

      {/* ── Unlock modal ─────────────────────────────────────────── */}
      <UpgradeModal
        open={!!unlockEvent}
        onClose={() => setUnlockEvent(null)}
        trigger="publish"
        eventId={unlockEvent?.id ?? null}
      />

      {/* ── Remove card confirmation ─────────────────────────────── */}
      <AlertDialog open={removeCardOpen} onOpenChange={setRemoveCardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove card on file?</AlertDialogTitle>
            <AlertDialogDescription>
              You'll need to enter a new card the next time you unlock an event. Existing unlocks and
              receipts stay intact.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRemoveCard}>Remove card</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Billing;

// ────────────────────────────────────────────────────────────────────
// Panels
// ────────────────────────────────────────────────────────────────────
const SidePanel = ({ children }: { children: React.ReactNode }) => (
  <div
    className="bg-card rounded-[14px]"
    style={{
      border: '1px solid hsl(var(--border))',
      boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
      padding: '18px 20px',
    }}
  >
    {children}
  </div>
);

const SidePanelHeading = ({ children }: { children: React.ReactNode }) => (
  <h2 className="font-display font-semibold text-[14px] uppercase tracking-wider text-muted-foreground m-0 mb-3">
    {children}
  </h2>
);

// ────────────────────────────────────────────────────────────────────
// Events panel
// ────────────────────────────────────────────────────────────────────
const EventsPanel = ({
  events,
  charges,
  onUnlock,
  onReceipt,
}: {
  events: BillingEvent[] | null;
  charges: ChargeRow[] | null;
  onUnlock: (e: BillingEvent) => void;
  onReceipt: (e: BillingEvent) => void;
}) => {
  const count = events?.length ?? 0;
  const unlockedCount = events?.filter((e) => !!e.paid_at).length ?? 0;
  return (
    <Card
      className="rounded-[14px] overflow-hidden p-0"
      style={{ border: '1px solid hsl(var(--border))', boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}
    >
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border">
        <h2 className="font-display font-semibold text-[15px] tracking-tight m-0 text-foreground">
          Your events
        </h2>
        <span className="text-[12px] text-muted-foreground font-display">
          {count} event{count === 1 ? '' : 's'} · {unlockedCount} unlocked
        </span>
      </div>

      {events === null ? (
        <div className="divide-y divide-border">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center px-5 py-4">
              <Skeleton className="h-12 w-full" />
            </div>
          ))}
        </div>
      ) : events.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-muted-foreground">
          No events yet. <Link to="/dashboard" className="text-primary hover:underline">Create one</Link>.
        </div>
      ) : (
        <div>
          {events.map((ev) => (
            <EventRow
              key={ev.id}
              event={ev}
              charge={charges?.find((c) => c.event_id === ev.id) ?? null}
              onUnlock={() => onUnlock(ev)}
              onReceipt={() => onReceipt(ev)}
            />
          ))}
        </div>
      )}
    </Card>
  );
};

const EventRow = ({
  event,
  charge,
  onUnlock,
  onReceipt,
}: {
  event: BillingEvent;
  charge: ChargeRow | null;
  onUnlock: () => void;
  onReceipt: () => void;
}) => {
  const isPro = !!event.paid_at;
  const isLive = event.status === 'published';
  const isDraft = !isLive;

  const barColor = isPro
    ? 'hsl(217 91% 50%)'
    : isLive
      ? 'hsl(152 60% 42%)'
      : 'hsl(var(--border))';

  const markersLeft = PAYWALL_LIMITS.pois - event.poi_count;
  const showMarkerWarning = !isPro && markersLeft > 0 && markersLeft <= 8;

  const receiptLabel = charge
    ? `Receipt ${shortReceipt(event.stripe_session_id || charge.id)} · ${formatMoney(
        charge.amount - charge.amount_refunded,
        charge.currency,
      )}`
    : event.stripe_session_id
      ? `Receipt ${shortReceipt(event.stripe_session_id)} · $49.00`
      : 'Receipt pending';

  return (
    <div className="relative flex flex-wrap items-stretch border-b border-border last:border-b-0 sm:grid sm:grid-cols-[4px_minmax(0,1fr)_auto_auto] sm:flex-nowrap">
      <div
        className="absolute left-0 top-0 bottom-0 w-1 sm:relative sm:w-1"
        style={{ background: barColor }}
      />

      {/* Body */}
      <div className="pl-5 pr-5 py-4 flex flex-col gap-1 min-w-0 flex-1 sm:pl-5">
        <h3 className="font-display font-semibold text-[15.5px] tracking-tight m-0 text-foreground flex items-center gap-2 flex-wrap">
          {event.name}
          {isLive ? <Chip variant="live" /> : <Chip variant="draft" />}
          {isPro ? <Chip variant="pro" /> : <Chip variant="free" />}
        </h3>
        <div className="text-[12px] text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
          <span>
            {event.event_date ? formatDate(event.event_date) : 'No date'}
            {event.city ? ` · ${event.city}` : ''}
          </span>
          <span>·</span>
          <span>
            <b className="font-medium" style={{ color: 'hsl(215 20% 35%)' }}>
              {event.route_count} route{event.route_count === 1 ? '' : 's'}
            </b>{' '}
            ·{' '}
            <b className="font-medium" style={{ color: 'hsl(215 20% 35%)' }}>
              {event.poi_count} marker{event.poi_count === 1 ? '' : 's'}
            </b>
          </span>
          {showMarkerWarning && (
            <span style={{ color: 'hsl(38 92% 40%)' }}>
              · {markersLeft} marker{markersLeft === 1 ? '' : 's'} until limit
            </span>
          )}
        </div>
      </div>

      {/* Status column — desktop only */}
      <div className="hidden sm:flex px-3 py-4 flex-col justify-center items-end gap-0.5 min-w-[140px]">
        {isPro ? (
          <>
            <div className="font-display font-semibold text-[13px] text-foreground">
              Unlocked {formatDate(event.paid_at)}
            </div>
            <div className="text-[11.5px] text-muted-foreground">{receiptLabel}</div>
          </>
        ) : (
          <>
            <div className="font-display font-semibold text-[13px] text-muted-foreground">
              Not unlocked
            </div>
            <div className="text-[11.5px] text-muted-foreground">
              {isDraft ? 'Draft · Free features only' : 'Free features only'}
            </div>
          </>
        )}
      </div>

      {/* Action column — wraps to its own row on mobile */}
      <div className="w-full sm:w-auto px-5 pb-4 sm:py-4 sm:pl-2 flex items-center">
        {isPro ? (
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={onReceipt}>
            <Download className="h-3 w-3 text-muted-foreground" />
            Receipt
          </Button>
        ) : (
          <Button size="sm" className="h-8 gap-1.5 whitespace-nowrap" onClick={onUnlock}>
            <Crown className="h-3 w-3" />
            Unlock — $49
          </Button>
        )}
      </div>
    </div>
  );
};

const Chip = ({ variant }: { variant: 'live' | 'draft' | 'pro' | 'free' }) => {
  if (variant === 'live') {
    return (
      <span
        className="font-display font-semibold text-[9.5px] uppercase tracking-wider px-2 py-0.5 rounded-full inline-flex items-center gap-1"
        style={{ background: 'hsl(152 60% 42%)', color: 'white' }}
      >
        <span className="w-1 h-1 rounded-full bg-white" />
        Live
      </span>
    );
  }
  if (variant === 'draft') {
    return (
      <span
        className="font-display font-semibold text-[9.5px] uppercase tracking-wider px-2 py-0.5 rounded-full"
        style={{ background: 'hsl(210 15% 93%)', color: 'hsl(215 20% 45%)' }}
      >
        Draft
      </span>
    );
  }
  if (variant === 'pro') {
    return (
      <span
        className="font-display font-semibold text-[9.5px] uppercase tracking-wider px-2 py-0.5 rounded-full"
        style={{
          background: 'hsl(217 91% 50% / 0.1)',
          color: 'hsl(217 91% 40%)',
          border: '1px solid hsl(217 91% 50% / 0.2)',
        }}
      >
        Pro
      </span>
    );
  }
  return (
    <span
      className="font-display font-semibold text-[9.5px] uppercase tracking-wider px-2 py-0.5 rounded-full"
      style={{ background: 'hsl(45 93% 94%)', color: 'hsl(32 65% 35%)' }}
    >
      Free plan
    </span>
  );
};

// ────────────────────────────────────────────────────────────────────
// Purchase history panel
// ────────────────────────────────────────────────────────────────────
const PurchaseHistoryPanel = ({
  charges,
  onDownload,
}: {
  charges: ChargeRow[] | null;
  onDownload: (id: string) => void;
}) => {
  return (
    <Card
      className="rounded-[14px] overflow-hidden p-0"
      style={{ border: '1px solid hsl(var(--border))', boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}
    >
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border">
        <h2 className="font-display font-semibold text-[15px] tracking-tight m-0 text-foreground">
          Purchase history
        </h2>
        <span className="text-[12px] text-muted-foreground font-display">
          {charges === null ? '…' : `${charges.length} transaction${charges.length === 1 ? '' : 's'}`}
        </span>
      </div>

      {charges === null ? (
        <div className="px-5 py-6"><Skeleton className="h-10 w-full" /></div>
      ) : charges.length === 0 ? (
        <div className="px-5 py-6 text-[13px] text-muted-foreground">
          No purchases yet — your first event is on the house.
        </div>
      ) : (
        <div>
          {charges.map((c) => {
            const original = c.amount + (c.percent_off ? Math.round((c.amount / (100 - c.percent_off)) * c.percent_off) : 0);
            const net = c.amount - c.amount_refunded;
            return (
              <div
                key={c.id}
                className="grid grid-cols-[1fr_auto_auto_auto] gap-4 items-center px-5 py-3 text-[13px] border-b border-border last:border-b-0"
              >
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="font-medium text-foreground whitespace-nowrap overflow-hidden text-ellipsis flex items-center gap-2">
                    {c.event_name ?? 'Pro unlock'}
                    {c.promo_code && (
                      <span
                        className="font-mono text-[10.5px] font-semibold px-1.5 py-0.5 rounded tracking-wider inline-flex items-center gap-1"
                        style={{
                          background: 'hsl(152 60% 42% / 0.12)',
                          color: 'hsl(152 60% 28%)',
                        }}
                      >
                        {c.promo_code}
                      </span>
                    )}
                  </span>
                  <span className="text-[11.5px] text-muted-foreground font-display">
                    {formatDate(new Date(c.created * 1000).toISOString())}
                    {c.card_brand
                      ? ` · ${c.card_brand.charAt(0).toUpperCase()}${c.card_brand.slice(1)} •••• ${c.card_last4}`
                      : ''}
                    {c.percent_off ? ` · ${c.percent_off}% off applied` : ''}
                    {c.refunded ? ' · Refunded' : ''}
                  </span>
                </div>
                <div
                  className="font-display font-semibold text-foreground"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {c.refunded ? (
                    <span className="text-muted-foreground line-through">{formatMoney(c.amount, c.currency)}</span>
                  ) : c.percent_off && original > c.amount ? (
                    <>
                      <span
                        className="text-muted-foreground line-through font-normal text-[11.5px] mr-1"
                      >
                        {formatMoney(original, c.currency)}
                      </span>
                      {formatMoney(net, c.currency)}
                    </>
                  ) : (
                    formatMoney(net, c.currency)
                  )}
                </div>
                <div
                  className="text-[11px] uppercase tracking-wider font-display font-semibold"
                  style={{ color: c.refunded ? 'hsl(215 15% 50%)' : 'hsl(152 60% 32%)' }}
                >
                  {c.refunded ? 'Refunded' : 'Paid'}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[12px] gap-1 px-2.5"
                  onClick={() => onDownload(c.id)}
                >
                  <Download className="h-[11px] w-[11px] text-muted-foreground" />
                  PDF
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
};
