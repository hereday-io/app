// POST /detach-payment-method — detaches the caller's default card.
//
// Leaves the Stripe customer in place (history + receipts still live
// there) but removes the payment source. The Billing page will render
// the "Add payment method" affordance on the next load.

import { authenticate, corsHeaders, getStripe, json } from "../_shared/billing.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(req) });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const auth = await authenticate(req);
  if (!auth.ok) return auth.response;

  if (!auth.profile.stripe_customer_id) {
    return json({ ok: true }); // nothing to detach
  }

  const stripe = getStripe();
  const customer = await stripe.customers.retrieve(auth.profile.stripe_customer_id);
  if (customer.deleted) return json({ ok: true });

  const defaultPmId = customer.invoice_settings?.default_payment_method as string | null | undefined;
  if (defaultPmId) {
    await stripe.paymentMethods.detach(defaultPmId);
  }

  return json({ ok: true });
});
