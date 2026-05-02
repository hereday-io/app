// GET /list-charges — returns the caller's Stripe Charges, desc by date.
//
// Shape mirrors what the Billing page needs for the Purchase history
// table: event name (via metadata), amount, currency, card brand / last4,
// promo code if applied, status, and the hosted receipt URL.
//
// No pagination yet — typical Hereday customer has <20 charges total.

import { authenticate, corsHeaders, getStripe, json } from "../_shared/billing.ts";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(req) });
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const auth = await authenticate(req);
  if (!auth.ok) return auth.response;

  if (!auth.profile.stripe_customer_id) {
    return json({ charges: [] as ChargeRow[] });
  }

  const stripe = getStripe();
  const charges = await stripe.charges.list({
    customer: auth.profile.stripe_customer_id,
    limit: 100,
  });

  const rows: ChargeRow[] = charges.data.map((c) => {
    const pm = (c.payment_method_details?.card ?? null) as { brand?: string; last4?: string } | null;
    const meta = (c.metadata ?? {}) as Record<string, string>;
    const percentOffStr = meta.hereday_promo_percent_off;
    return {
      id: c.id,
      amount: c.amount,
      amount_refunded: c.amount_refunded,
      currency: c.currency,
      created: c.created,
      status: c.status,
      receipt_url: c.receipt_url,
      card_brand: pm?.brand ?? null,
      card_last4: pm?.last4 ?? null,
      event_id: meta.hereday_event_id ?? null,
      event_name: meta.hereday_event_name ?? null,
      promo_code: meta.hereday_promo_code ?? null,
      percent_off: percentOffStr ? Number(percentOffStr) : null,
      refunded: c.refunded || c.amount_refunded >= c.amount,
    };
  });

  return json({ charges: rows });
});
